from __future__ import annotations

import asyncio
import base64
import logging
import os
import struct
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
import torch
import uvicorn

LOGGER = logging.getLogger('bonzi.local_embeddings')
DEFAULT_SAFE_FALLBACK_MODEL = 'Qwen/Qwen3-Embedding-0.6B'
DEFAULT_PREFERRED_MODEL = 'Qwen/Qwen3-Embedding-4B'
DEFAULT_HOST = '127.0.0.1'
DEFAULT_PORT = 8999
DEFAULT_BATCH_SIZE = 8


class EmbeddingsRequest(BaseModel):
    model: str
    input: Any
    dimensions: int | None = None
    encoding_format: Literal['float', 'base64'] | None = 'float'
    user: str | None = None


@dataclass(slots=True)
class Settings:
    host: str
    port: int
    model_id: str
    model_aliases: tuple[str, ...]
    device_preference: str
    batch_size: int
    normalize_embeddings: bool
    default_dimensions: int | None
    trust_remote_code: bool
    torch_dtype: str
    log_level: str
    allow_cpu_fallback: bool

    @classmethod
    def from_env(cls) -> 'Settings':
        model_id = env_str(
            'BONZI_LOCAL_EMBEDDINGS_MODEL', DEFAULT_SAFE_FALLBACK_MODEL
        )
        aliases = tuple(
            unique_preserve_order(
                [
                    model_id,
                    env_str('BONZI_LOCAL_EMBEDDINGS_PUBLIC_MODEL', model_id),
                    *split_csv(os.getenv('BONZI_LOCAL_EMBEDDINGS_MODEL_ALIASES')),
                ]
            )
        )
        return cls(
            host=env_str('BONZI_LOCAL_EMBEDDINGS_HOST', DEFAULT_HOST),
            port=env_int('BONZI_LOCAL_EMBEDDINGS_PORT', DEFAULT_PORT, minimum=1),
            model_id=model_id,
            model_aliases=aliases,
            device_preference=env_str('BONZI_LOCAL_EMBEDDINGS_DEVICE', 'auto'),
            batch_size=env_int(
                'BONZI_LOCAL_EMBEDDINGS_BATCH_SIZE', DEFAULT_BATCH_SIZE, minimum=1
            ),
            normalize_embeddings=env_bool(
                'BONZI_LOCAL_EMBEDDINGS_NORMALIZE', True
            ),
            default_dimensions=env_optional_int(
                'BONZI_LOCAL_EMBEDDINGS_DIMENSIONS', minimum=1
            ),
            trust_remote_code=env_bool(
                'BONZI_LOCAL_EMBEDDINGS_TRUST_REMOTE_CODE', True
            ),
            torch_dtype=env_str('BONZI_LOCAL_EMBEDDINGS_TORCH_DTYPE', 'auto'),
            log_level=env_str('BONZI_LOCAL_EMBEDDINGS_LOG_LEVEL', 'info'),
            allow_cpu_fallback=env_bool(
                'BONZI_LOCAL_EMBEDDINGS_ALLOW_CPU_FALLBACK', True
            ),
        )


class EmbeddingService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._model: SentenceTransformer | None = None
        self._device: str | None = None
        self._raw_dimensions: int | None = None
        self._created_at = int(time.time())
        self._lock = threading.Lock()

    @property
    def public_model_id(self) -> str:
        return self.settings.model_aliases[0]

    @property
    def model(self) -> SentenceTransformer:
        if self._model is None:
            raise RuntimeError('Embedding model is not loaded yet.')
        return self._model

    @property
    def device(self) -> str:
        if self._device is None:
            raise RuntimeError('Embedding device is not resolved yet.')
        return self._device

    @property
    def raw_dimensions(self) -> int:
        if self._raw_dimensions is None:
            raise RuntimeError('Embedding dimensions are not known yet.')
        return self._raw_dimensions

    def load(self) -> None:
        if self._model is not None:
            return

        candidates = resolve_device_candidates(
            self.settings.device_preference,
            allow_cpu_fallback=self.settings.allow_cpu_fallback,
        )
        last_error: Exception | None = None

        for device in candidates:
            try:
                LOGGER.info(
                    'Loading embeddings model %s on %s', self.settings.model_id, device
                )
                model = SentenceTransformer(
                    self.settings.model_id,
                    device=device,
                    trust_remote_code=self.settings.trust_remote_code,
                    model_kwargs=build_model_kwargs(self.settings.torch_dtype, device),
                )
                get_dimension = getattr(
                    model,
                    'get_embedding_dimension',
                    model.get_sentence_embedding_dimension,
                )
                raw_dimensions = get_dimension()
                if raw_dimensions is None:
                    raise RuntimeError(
                        'Loaded embedding model did not report an output dimension.'
                    )

                self._model = model
                self._device = device
                self._raw_dimensions = int(raw_dimensions)
                LOGGER.info(
                    'Embeddings model ready: model=%s device=%s raw_dimensions=%s default_dimensions=%s aliases=%s preferred_profile=%s',
                    self.settings.model_id,
                    self._device,
                    self._raw_dimensions,
                    self.settings.default_dimensions,
                    ', '.join(self.settings.model_aliases),
                    DEFAULT_PREFERRED_MODEL,
                )
                return
            except Exception as error:  # pragma: no cover - exercised in live setup
                last_error = error
                LOGGER.warning(
                    'Failed to load embeddings model on %s: %s', device, error
                )

        raise RuntimeError(
            'Unable to load the local embeddings model on any candidate device.'
        ) from last_error

    def list_models(self) -> list[dict[str, Any]]:
        return [
            {
                'id': alias,
                'object': 'model',
                'created': self._created_at,
                'owned_by': 'bonzi-local',
            }
            for alias in self.settings.model_aliases
        ]

    def embed(
        self,
        payload: EmbeddingsRequest,
    ) -> dict[str, Any]:
        self.ensure_model_name(payload.model)
        texts = normalize_inputs(payload.input)
        dimensions = self.resolve_dimensions(payload.dimensions)
        encoding_format = payload.encoding_format or 'float'

        with self._lock:
            embeddings = self.model.encode(
                texts,
                batch_size=self.settings.batch_size,
                show_progress_bar=False,
                convert_to_numpy=True,
                normalize_embeddings=self.settings.normalize_embeddings,
                truncate_dim=dimensions,
                device=self.device,
            )
            prompt_tokens = self.count_prompt_tokens(texts)

        embeddings_2d = np.atleast_2d(np.asarray(embeddings, dtype=np.float32))
        data = [
            {
                'object': 'embedding',
                'index': index,
                'embedding': format_embedding(vector, encoding_format),
            }
            for index, vector in enumerate(embeddings_2d)
        ]

        return {
            'object': 'list',
            'data': data,
            'model': self.public_model_id,
            'usage': {
                'prompt_tokens': prompt_tokens,
                'total_tokens': prompt_tokens,
            },
            'bonzi': {
                'device': self.device,
                'raw_dimensions': self.raw_dimensions,
                'dimensions': dimensions,
                'normalize_embeddings': self.settings.normalize_embeddings,
            },
        }

    def resolve_dimensions(self, requested_dimensions: int | None) -> int:
        dimensions = requested_dimensions or self.settings.default_dimensions or self.raw_dimensions
        if dimensions <= 0:
            raise http_bad_request('dimensions must be a positive integer.')
        if dimensions > self.raw_dimensions:
            raise http_bad_request(
                f'dimensions={dimensions} exceeds this model\'s maximum output size of {self.raw_dimensions}.'
            )
        return dimensions

    def ensure_model_name(self, requested_model: str) -> None:
        if requested_model in self.settings.model_aliases:
            return
        raise http_bad_request(
            f'Unknown model {requested_model!r}. Available models: {", ".join(self.settings.model_aliases)}.'
        )

    def count_prompt_tokens(self, texts: list[str]) -> int:
        tokenizer = getattr(self.model, 'tokenizer', None)
        if tokenizer is None:
            return 0

        tokenized = tokenizer(
            texts,
            add_special_tokens=True,
            padding=False,
            truncation=False,
            return_attention_mask=True,
        )
        attention_mask = tokenized.get('attention_mask')
        if attention_mask is None:
            input_ids = tokenized.get('input_ids') or []
            return sum(len(ids) for ids in input_ids)
        return sum(sum(mask) for mask in attention_mask)


def build_app(service: EmbeddingService) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI):
        await asyncio.to_thread(service.load)
        yield

    app = FastAPI(
        title='Bonzi Local Embeddings Server',
        version='0.1.0',
        lifespan=lifespan,
    )

    @app.exception_handler(HTTPException)
    async def handle_http_exception(_: Request, exc: HTTPException) -> JSONResponse:
        return openai_error_response(
            exc.status_code,
            extract_error_message(exc.detail),
            code='invalid_request_error',
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return openai_error_response(
            400,
            f'Invalid embeddings request payload: {exc.errors()}',
            code='invalid_request_error',
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(_: Request, exc: Exception) -> JSONResponse:
        LOGGER.exception('Unhandled local embeddings server error: %s', exc)
        return openai_error_response(500, 'Internal embeddings server error.', code='server_error')

    @app.get('/healthz')
    def healthz() -> dict[str, Any]:
        return {
            'status': 'ok',
            'model': service.public_model_id,
            'device': service.device,
            'raw_dimensions': service.raw_dimensions,
            'default_dimensions': service.settings.default_dimensions,
        }

    @app.get('/v1/models')
    def list_models() -> dict[str, Any]:
        return {
            'object': 'list',
            'data': service.list_models(),
        }

    @app.post('/v1/embeddings')
    def create_embeddings(payload: EmbeddingsRequest) -> dict[str, Any]:
        return service.embed(payload)

    return app


def normalize_inputs(value: Any) -> list[str]:
    if isinstance(value, str):
        if not value:
            raise http_bad_request('input must not be empty.')
        return [value]

    if not isinstance(value, list) or not value:
        raise http_bad_request('input must be a string or a non-empty list of strings.')

    if all(isinstance(item, str) for item in value):
        texts = [item for item in value if item]
        if len(texts) != len(value):
            raise http_bad_request('input strings must not be empty.')
        return texts

    raise http_bad_request(
        'This local server currently supports string inputs only (string or list[string]).'
    )


def format_embedding(vector: np.ndarray, encoding_format: str) -> list[float] | str:
    if encoding_format == 'base64':
        packed = struct.pack(f'<{len(vector)}f', *vector.tolist())
        return base64.b64encode(packed).decode('ascii')

    if encoding_format != 'float':
        raise http_bad_request(
            "encoding_format must be either 'float' or 'base64'."
        )

    return vector.astype(float).tolist()


def build_model_kwargs(torch_dtype: str, device: str) -> dict[str, Any]:
    resolved_dtype = resolve_torch_dtype(torch_dtype, device)
    if resolved_dtype is None:
        return {}
    return {'torch_dtype': resolved_dtype}


def resolve_torch_dtype(torch_dtype: str, device: str) -> Any | None:
    normalized = torch_dtype.strip().lower()
    if normalized == 'auto':
        return torch.float16 if device in {'mps', 'cuda'} else None
    if normalized == 'float16':
        return torch.float16
    if normalized == 'float32':
        return torch.float32
    if normalized == 'bfloat16':
        return torch.bfloat16
    if normalized in {'none', 'default'}:
        return None
    raise RuntimeError(
        'BONZI_LOCAL_EMBEDDINGS_TORCH_DTYPE must be one of auto, float16, float32, bfloat16, none, default.'
    )


def resolve_device_candidates(preference: str, allow_cpu_fallback: bool) -> list[str]:
    normalized = preference.strip().lower()
    if normalized == 'auto':
        candidates: list[str] = []
        if torch.backends.mps.is_available():
            candidates.append('mps')
        if torch.cuda.is_available():
            candidates.append('cuda')
        candidates.append('cpu')
        return unique_preserve_order(candidates)

    if normalized in {'mps', 'cuda', 'cpu'}:
        candidates = [normalized]
        if normalized != 'cpu' and allow_cpu_fallback:
            candidates.append('cpu')
        return unique_preserve_order(candidates)

    raise RuntimeError(
        'BONZI_LOCAL_EMBEDDINGS_DEVICE must be one of auto, mps, cuda, or cpu.'
    )


def http_bad_request(message: str) -> HTTPException:
    return HTTPException(status_code=400, detail=message)


def openai_error_response(status: int, message: str, code: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            'error': {
                'message': message,
                'type': 'invalid_request_error',
                'code': code,
            }
        },
    )


def extract_error_message(detail: Any) -> str:
    if isinstance(detail, str):
        return detail
    if isinstance(detail, dict):
        error = detail.get('error')
        if isinstance(error, dict) and isinstance(error.get('message'), str):
            return error['message']
    return str(detail)


def env_str(name: str, default: str) -> str:
    return os.getenv(name, default).strip() or default


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {'1', 'true', 'yes', 'on'}:
        return True
    if normalized in {'0', 'false', 'no', 'off'}:
        return False
    raise RuntimeError(f'{name} must be a boolean-like value.')


def env_int(name: str, default: int, minimum: int | None = None) -> int:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    parsed = int(value)
    if minimum is not None and parsed < minimum:
        raise RuntimeError(f'{name} must be >= {minimum}.')
    return parsed


def env_optional_int(name: str, minimum: int | None = None) -> int | None:
    value = os.getenv(name)
    if value is None or not value.strip():
        return None
    parsed = int(value)
    if minimum is not None and parsed < minimum:
        raise RuntimeError(f'{name} must be >= {minimum}.')
    return parsed


def split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(',') if item.strip()]


def unique_preserve_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


def main() -> None:
    settings = Settings.from_env()
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format='[%(asctime)s] %(levelname)s %(name)s: %(message)s',
    )
    service = EmbeddingService(settings)
    app = build_app(service)
    uvicorn.run(app, host=settings.host, port=settings.port, log_level=settings.log_level)


if __name__ == '__main__':
    main()
