export interface DiscordDomMessage {
  author?: string
  timestamp?: string
  text: string
  attachments: string[]
}

export interface DiscordDomContextSnapshot {
  authenticated: boolean
  url: string
  documentTitle?: string
  serverName?: string
  channelName?: string
  topic?: string
  messages: DiscordDomMessage[]
  composerText?: string
  warnings: string[]
}

export interface DiscordDomDraftResult {
  ok: boolean
  authenticated: boolean
  reason?: string
  composerText?: string
}

export const READ_CONTEXT_SCRIPT = String.raw`(() => {
  const textOf = (node) => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const firstText = (selectors, root = document) => {
    for (const selector of selectors) {
      const value = textOf(root.querySelector(selector));
      if (value) return value;
    }
    return '';
  };
  const isLoginPage = /\/login(?:$|[/?#])/.test(location.pathname) || Boolean(document.querySelector('input[name="email"], input[name="password"]'));
  const messageNodes = Array.from(document.querySelectorAll('[role="article"], [id^="chat-messages-"], [data-list-id="chat-messages"] [role="listitem"]'));
  const seen = new Set();
  const messages = [];

  for (const node of messageNodes) {
    const content = firstText(['[id^="message-content-"]', '[class*="markup"]'], node) || textOf(node);
    const author = firstText(['[id^="message-username-"]', 'h3 [class*="username"]', 'h3', '[class*="username"]'], node);
    const time = node.querySelector('time[datetime]');
    const timestamp = time?.getAttribute('datetime') || textOf(time);
    const attachments = Array.from(node.querySelectorAll('a[href], img[alt], [aria-label*="attachment" i]'))
      .map((child) => child.getAttribute('href') || child.getAttribute('alt') || child.getAttribute('aria-label') || '')
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 5);
    const key = [author, timestamp, content].join('\n');

    if (!content || seen.has(key)) continue;
    seen.add(key);
    messages.push({ author, timestamp, text: content, attachments });
  }

  const isSearchLike = (node) => {
    const label = [
      node.getAttribute('aria-label'),
      node.getAttribute('placeholder'),
      node.getAttribute('data-placeholder'),
      node.closest('[aria-label]')?.getAttribute('aria-label')
    ].filter(Boolean).join(' ').toLowerCase();
    return /search|find/.test(label);
  };
  const findComposer = () => {
    const preferred = Array.from(document.querySelectorAll('[role="textbox"][contenteditable="true"][aria-label^="Message"], [role="textbox"][contenteditable="true"][aria-label*="Message @"], [role="textbox"][contenteditable="true"][aria-label*="Message #"]'));
    const slate = Array.from(document.querySelectorAll('[data-slate-editor="true"][contenteditable="true"]'));
    const formTextboxes = Array.from(document.querySelectorAll('form [role="textbox"][contenteditable="true"], [class*="channelTextArea"] [role="textbox"][contenteditable="true"]'));
    const fallback = Array.from(document.querySelectorAll('[role="textbox"][contenteditable="true"], div[contenteditable="true"]'));
    return [...preferred, ...slate, ...formTextboxes, ...fallback].find((node) => !isSearchLike(node)) || null;
  };
  const composer = findComposer();
  const channelName = firstText(['h1', '[aria-label*="Channel" i]', '[data-list-item-id*="channels___" i][aria-selected="true"]']);
  const serverName = firstText(['[aria-label*="server" i] h2', 'nav [aria-current="page"]']);
  const topic = firstText(['[aria-label*="Topic" i]', '[class*="topic"]']);
  const warnings = [];

  if (isLoginPage) warnings.push('Discord Web appears to be on the login screen.');
  if (messages.length === 0) warnings.push('No chat messages were found with DOM selectors.');
  if (!composer) warnings.push('No Discord message composer was found.');

  return {
    authenticated: !isLoginPage && messages.length > 0,
    url: location.href,
    documentTitle: document.title,
    serverName,
    channelName,
    topic,
    messages,
    composerText: composer ? textOf(composer) : '',
    warnings
  };
})()`

export const FOCUS_DRAFT_COMPOSER_SCRIPT = String.raw`(() => {
  const textOf = (node) => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const isLoginPage = /\/login(?:$|[/?#])/.test(location.pathname) || Boolean(document.querySelector('input[name="email"], input[name="password"]'));
  const isSearchLike = (node) => {
    const label = [
      node.getAttribute('aria-label'),
      node.getAttribute('placeholder'),
      node.getAttribute('data-placeholder'),
      node.closest('[aria-label]')?.getAttribute('aria-label')
    ].filter(Boolean).join(' ').toLowerCase();
    return /search|find/.test(label);
  };
  const findComposer = () => {
    const preferred = Array.from(document.querySelectorAll('[role="textbox"][contenteditable="true"][aria-label^="Message"], [role="textbox"][contenteditable="true"][aria-label*="Message @"], [role="textbox"][contenteditable="true"][aria-label*="Message #"]'));
    const slate = Array.from(document.querySelectorAll('[data-slate-editor="true"][contenteditable="true"]'));
    const formTextboxes = Array.from(document.querySelectorAll('form [role="textbox"][contenteditable="true"], [class*="channelTextArea"] [role="textbox"][contenteditable="true"]'));
    const fallback = Array.from(document.querySelectorAll('[role="textbox"][contenteditable="true"], div[contenteditable="true"]'));
    return [...preferred, ...slate, ...formTextboxes, ...fallback].find((node) => !isSearchLike(node)) || null;
  };
  const composer = findComposer();

  if (isLoginPage) {
    return { ok: false, authenticated: false, reason: 'Discord Web appears to be on the login screen.' };
  }

  if (!composer) {
    return { ok: false, authenticated: true, reason: 'No Discord message composer was found.' };
  }

  const existingText = textOf(composer);
  if (existingText) {
    return {
      ok: false,
      authenticated: true,
      reason: 'Discord composer already contains text. Bonzi did not overwrite it and did not send anything.',
      composerText: existingText
    };
  }

  composer.focus({ preventScroll: true });
  return { ok: true, authenticated: true, composerText: '' };
})()`
