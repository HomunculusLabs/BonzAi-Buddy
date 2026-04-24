#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REQ_FILE="$ROOT_DIR/python/requirements-embeddings.txt"
VENV_DIR="${BONZI_LOCAL_EMBEDDINGS_VENV:-$ROOT_DIR/.venv-local-embeddings}"

load_env_defaults() {
  local env_file="$1"
  [[ -f "$env_file" ]] || return 0

  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#${line%%[![:space:]]*}}"
    line="${line%${line##*[![:space:]]}}"

    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == export\ * ]] && line="${line#export }"
    [[ "$line" != *=* ]] && continue

    local key="${line%%=*}"
    local value="${line#*=}"
    key="${key//[[:space:]]/}"

    if [[ "$value" == \"*\" && "$value" == *\" ]]; then
      value="${value:1:-1}"
    elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
      value="${value:1:-1}"
    fi

    [[ -n "$key" && -z "${!key+x}" ]] && export "$key=$value"
  done < "$env_file"
}

load_env_defaults "$ROOT_DIR/.env"

resolve_python() {
  if [[ -n "${BONZI_LOCAL_EMBEDDINGS_PYTHON:-}" ]] && command -v "$BONZI_LOCAL_EMBEDDINGS_PYTHON" >/dev/null 2>&1; then
    if "$BONZI_LOCAL_EMBEDDINGS_PYTHON" -V >/dev/null 2>&1; then
      printf '%s\n' "$BONZI_LOCAL_EMBEDDINGS_PYTHON"
      return 0
    fi
  fi

  local candidates=(python3.12 python3.11 python3)
  local candidate
  for candidate in "${candidates[@]}"; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -V >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  echo "No suitable Python interpreter found (tried BONZI_LOCAL_EMBEDDINGS_PYTHON, python3.12, python3.11, python3)." >&2
  return 1
}

PYTHON_BIN="$(resolve_python)"
REQ_HASH="$(shasum -a 256 "$REQ_FILE" | awk '{print $1}')"
STAMP_FILE="$VENV_DIR/.requirements.sha256"

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  echo "[bonzi-embeddings] Creating virtualenv at $VENV_DIR using $PYTHON_BIN"
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

if [[ ! -f "$STAMP_FILE" ]] || [[ "$(cat "$STAMP_FILE")" != "$REQ_HASH" ]]; then
  echo "[bonzi-embeddings] Installing Python dependencies"
  "$VENV_DIR/bin/python" -m pip install --upgrade pip
  "$VENV_DIR/bin/python" -m pip install -r "$REQ_FILE"
  printf '%s' "$REQ_HASH" > "$STAMP_FILE"
fi

HF_HOME_DEFAULT="$ROOT_DIR/.cache/huggingface"
export HF_HOME="${BONZI_LOCAL_EMBEDDINGS_HF_HOME:-$HF_HOME_DEFAULT}"
export HUGGINGFACE_HUB_CACHE="${HUGGINGFACE_HUB_CACHE:-$HF_HOME/hub}"
export TRANSFORMERS_CACHE="${TRANSFORMERS_CACHE:-$HF_HOME/transformers}"
export SENTENCE_TRANSFORMERS_HOME="${SENTENCE_TRANSFORMERS_HOME:-$HF_HOME/sentence-transformers}"
mkdir -p "$HF_HOME" "$HUGGINGFACE_HUB_CACHE" "$TRANSFORMERS_CACHE" "$SENTENCE_TRANSFORMERS_HOME"

export PYTORCH_ENABLE_MPS_FALLBACK="${PYTORCH_ENABLE_MPS_FALLBACK:-1}"
export TOKENIZERS_PARALLELISM="${TOKENIZERS_PARALLELISM:-false}"

echo "[bonzi-embeddings] Starting local embeddings server"
echo "[bonzi-embeddings] model=${BONZI_LOCAL_EMBEDDINGS_MODEL:-Qwen/Qwen3-Embedding-0.6B} device=${BONZI_LOCAL_EMBEDDINGS_DEVICE:-auto} port=${BONZI_LOCAL_EMBEDDINGS_PORT:-8999}"

exec "$VENV_DIR/bin/python" "$ROOT_DIR/python/embeddings_server.py"
