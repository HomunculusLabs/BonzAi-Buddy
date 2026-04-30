export interface DiscordDomMessage {
  author?: string
  timestamp?: string
  text: string
  attachments: string[]
}

export type DiscordDomPageState =
  | 'login'
  | 'specific_channel'
  | 'channel_home'
  | 'discord_page'
  | 'unknown_page'

export type DiscordDomReadinessState =
  | 'ready'
  | 'login_required'
  | 'wrong_page'
  | 'empty_messages'
  | 'selector_drift'
  | 'not_ready'

export type DiscordDomDraftFailureCode =
  | 'login_required'
  | 'wrong_page'
  | 'composer_missing'
  | 'composer_not_empty'
  | 'not_ready'

export interface DiscordDomDiagnostics {
  loginPageDetected: boolean
  specificChannelPath: boolean
  messageContainerFound: boolean
  messageNodeCount: number
  extractedMessageCount: number
  composerFound: boolean
  matchedMessageSelectors: string[]
  matchedComposerSelector?: string
}

export interface DiscordDomDraftDiagnostics {
  loginPageDetected: boolean
  specificChannelPath: boolean
  composerFound: boolean
  matchedComposerSelector?: string
}

export interface DiscordDomContextSnapshot {
  authenticated: boolean
  readable: boolean
  pageState: DiscordDomPageState
  readinessState: DiscordDomReadinessState
  url: string
  documentTitle?: string
  serverName?: string
  channelName?: string
  topic?: string
  messages: DiscordDomMessage[]
  composerText?: string
  composerFound: boolean
  diagnostics: DiscordDomDiagnostics
  warnings: string[]
}

export interface DiscordDomDraftResult {
  ok: boolean
  authenticated: boolean
  pageState: DiscordDomPageState
  url: string
  documentTitle?: string
  failureCode?: DiscordDomDraftFailureCode
  reason?: string
  composerText?: string
  diagnostics: DiscordDomDraftDiagnostics
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
  const uniqueNodesForSelectors = (selectors, root = document) => {
    const seen = new Set();
    const nodes = [];
    const matchedSelectors = [];

    for (const selector of selectors) {
      const matches = Array.from(root.querySelectorAll(selector));
      if (matches.length > 0) matchedSelectors.push(selector);
      for (const node of matches) {
        if (seen.has(node)) continue;
        seen.add(node);
        nodes.push(node);
      }
    }

    return { nodes, matchedSelectors };
  };
  const pathParts = location.pathname.split('/').filter(Boolean);
  const loginPageDetected = /\/login(?:$|[/?#])/.test(location.pathname) || Boolean(document.querySelector('input[name="email"], input[name="password"], form [autocomplete="username"], form [autocomplete="current-password"]'));
  const specificChannelPath = pathParts[0] === 'channels' && pathParts.length >= 3 && Boolean(pathParts[1]) && Boolean(pathParts[2]);
  const channelHomePath = pathParts[0] === 'channels' && !specificChannelPath;
  const pageState = loginPageDetected
    ? 'login'
    : specificChannelPath
      ? 'specific_channel'
      : channelHomePath
        ? 'channel_home'
        : location.hostname.includes('discord')
          ? 'discord_page'
          : 'unknown_page';

  const messageContainerSelectors = [
    '[data-list-id="chat-messages"]',
    '[aria-label*="Messages" i]',
    '[role="log"]',
    '[class*="chatContent"]',
    '[class*="messagesWrapper"]',
    '[class*="scrollerInner"]'
  ];
  const messageNodeSelectors = [
    '[role="article"]',
    '[id^="chat-messages-"]',
    '[data-list-id="chat-messages"] [role="listitem"]',
    '[aria-label*="Messages" i] [role="listitem"]',
    '[class*="messageListItem"]',
    '[class*="message_"]',
    '[data-item-id^="chat-messages"]'
  ];
  const messageContentSelectors = [
    '[id^="message-content-"]',
    '[class*="messageContent"]',
    '[class*="markup"]',
    '[data-testid*="message-content"]',
    '[data-slate-node]'
  ];
  const { nodes: messageContainers } = uniqueNodesForSelectors(messageContainerSelectors);
  const { nodes: primaryMessageNodes, matchedSelectors } = uniqueNodesForSelectors(messageNodeSelectors);
  const fallbackContentRoots = messageContainers.length > 0 ? messageContainers : [document];
  const fallbackMessageNodes = [];
  const fallbackMatchedSelectors = [];

  for (const root of fallbackContentRoots) {
    const { nodes: contentNodes, matchedSelectors: contentMatchedSelectors } = uniqueNodesForSelectors(messageContentSelectors, root);
    if (contentMatchedSelectors.length > 0) fallbackMatchedSelectors.push(...contentMatchedSelectors);
    for (const contentNode of contentNodes) {
      const messageNode = contentNode.closest('[role="article"], [id^="chat-messages-"], [data-item-id^="chat-messages"], [class*="messageListItem"], [class*="message_"], li, [role="listitem"]') || contentNode;
      fallbackMessageNodes.push(messageNode);
    }
  }

  const messageNodes = Array.from(new Set([...primaryMessageNodes, ...fallbackMessageNodes]));
  const matchedMessageSelectors = Array.from(new Set([...matchedSelectors, ...fallbackMatchedSelectors]));
  const seen = new Set();
  const messages = [];

  for (const node of messageNodes) {
    const content = firstText(messageContentSelectors, node) || textOf(node);
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
  const composerSelectorGroups = [
    ['[role="textbox"][contenteditable="true"][aria-label^="Message"]', '[role="textbox"][contenteditable="true"][aria-label*="Message @"]', '[role="textbox"][contenteditable="true"][aria-label*="Message #"]'],
    ['[data-slate-editor="true"][contenteditable="true"]'],
    ['[aria-multiline="true"][contenteditable="true"]'],
    ['form [role="textbox"][contenteditable="true"]', '[class*="textArea"] [contenteditable="true"]', '[class*="channelTextArea"] [contenteditable="true"]'],
    ['[role="textbox"][contenteditable="true"]', 'div[contenteditable="true"]']
  ];
  const findComposer = () => {
    for (const selectors of composerSelectorGroups) {
      for (const selector of selectors) {
        const node = Array.from(document.querySelectorAll(selector)).find((candidate) => !isSearchLike(candidate));
        if (node) return { node, selector };
      }
    }
    return { node: null, selector: undefined };
  };
  const composerMatch = findComposer();
  const composer = composerMatch.node;
  const channelName = firstText(['h1', '[aria-label*="Channel" i]', '[data-list-item-id*="channels___" i][aria-selected="true"]']);
  const serverName = firstText(['[aria-label*="server" i] h2', 'nav [aria-current="page"]']);
  const topic = firstText(['[aria-label*="Topic" i]', '[class*="topic"]']);
  const documentTitle = document.title;
  const channelViewEvidence = Boolean(channelName || serverName || document.querySelector('h1, [data-list-item-id*="channels___" i][aria-selected="true"], [aria-label*="Channel" i]'));
  const messageContainerFound = messageContainers.length > 0;
  const composerFound = Boolean(composer);
  const channelDomSettled = composerFound || channelViewEvidence || /\|\s*#|\|\s*@|\|\s*Discord/i.test(documentTitle);
  const authenticated = !loginPageDetected;
  const readable = authenticated && specificChannelPath && messages.length > 0;
  const diagnostics = {
    loginPageDetected,
    specificChannelPath,
    messageContainerFound,
    messageNodeCount: messageNodes.length,
    extractedMessageCount: messages.length,
    composerFound,
    matchedMessageSelectors,
    matchedComposerSelector: composerMatch.selector
  };
  let readinessState = 'not_ready';
  const warnings = [];

  if (loginPageDetected) {
    readinessState = 'login_required';
    warnings.push('Discord Web appears to be on the login screen.');
  } else if (!specificChannelPath) {
    readinessState = 'wrong_page';
    warnings.push('Discord Web is not on a specific server channel or DM URL.');
  } else if (messages.length > 0) {
    readinessState = 'ready';
  } else if (messageContainerFound && channelDomSettled && matchedMessageSelectors.length > 0) {
    readinessState = 'empty_messages';
    warnings.push('Message selectors matched, but no readable message text was extracted from this channel.');
  } else if (messageContainerFound && channelDomSettled) {
    readinessState = 'selector_drift';
    warnings.push('Discord channel loaded, but supported message selectors did not match any visible messages.');
  } else if (messageContainerFound) {
    warnings.push('Discord channel shell is present, but the chat DOM has not finished settling yet.');
  } else if (document.readyState === 'complete' && channelViewEvidence && !composerFound) {
    readinessState = 'selector_drift';
    warnings.push('Discord channel loaded, but supported message/composer selectors did not match the chat DOM.');
  } else {
    warnings.push('Discord Web has not finished loading readable channel DOM yet.');
  }

  if (!composerFound) warnings.push('No Discord message composer was found.');

  return {
    authenticated,
    readable,
    pageState,
    readinessState,
    url: location.href,
    documentTitle,
    serverName,
    channelName,
    topic,
    messages,
    composerText: composer ? textOf(composer) : '',
    composerFound,
    diagnostics,
    warnings
  };
})()`

export const FOCUS_DRAFT_COMPOSER_SCRIPT = String.raw`(() => {
  const textOf = (node) => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const pathParts = location.pathname.split('/').filter(Boolean);
  const loginPageDetected = /\/login(?:$|[/?#])/.test(location.pathname) || Boolean(document.querySelector('input[name="email"], input[name="password"], form [autocomplete="username"], form [autocomplete="current-password"]'));
  const specificChannelPath = pathParts[0] === 'channels' && pathParts.length >= 3 && Boolean(pathParts[1]) && Boolean(pathParts[2]);
  const channelHomePath = pathParts[0] === 'channels' && !specificChannelPath;
  const pageState = loginPageDetected
    ? 'login'
    : specificChannelPath
      ? 'specific_channel'
      : channelHomePath
        ? 'channel_home'
        : location.hostname.includes('discord')
          ? 'discord_page'
          : 'unknown_page';
  const isSearchLike = (node) => {
    const label = [
      node.getAttribute('aria-label'),
      node.getAttribute('placeholder'),
      node.getAttribute('data-placeholder'),
      node.closest('[aria-label]')?.getAttribute('aria-label')
    ].filter(Boolean).join(' ').toLowerCase();
    return /search|find/.test(label);
  };
  const composerSelectorGroups = [
    ['[role="textbox"][contenteditable="true"][aria-label^="Message"]', '[role="textbox"][contenteditable="true"][aria-label*="Message @"]', '[role="textbox"][contenteditable="true"][aria-label*="Message #"]'],
    ['[data-slate-editor="true"][contenteditable="true"]'],
    ['[aria-multiline="true"][contenteditable="true"]'],
    ['form [role="textbox"][contenteditable="true"]', '[class*="textArea"] [contenteditable="true"]', '[class*="channelTextArea"] [contenteditable="true"]'],
    ['[role="textbox"][contenteditable="true"]', 'div[contenteditable="true"]']
  ];
  const findComposer = () => {
    for (const selectors of composerSelectorGroups) {
      for (const selector of selectors) {
        const node = Array.from(document.querySelectorAll(selector)).find((candidate) => !isSearchLike(candidate));
        if (node) return { node, selector };
      }
    }
    return { node: null, selector: undefined };
  };
  const composerMatch = findComposer();
  const composer = composerMatch.node;
  const authenticated = !loginPageDetected;
  const diagnostics = {
    loginPageDetected,
    specificChannelPath,
    composerFound: Boolean(composer),
    matchedComposerSelector: composerMatch.selector
  };

  if (loginPageDetected) {
    return {
      ok: false,
      authenticated: false,
      pageState,
      url: location.href,
      documentTitle: document.title,
      failureCode: 'login_required',
      reason: 'Discord Web appears to be on the login screen.',
      diagnostics
    };
  }

  if (!specificChannelPath) {
    return {
      ok: false,
      authenticated,
      pageState,
      url: location.href,
      documentTitle: document.title,
      failureCode: 'wrong_page',
      reason: 'Discord Web is not on a specific server channel or DM URL.',
      diagnostics
    };
  }

  if (!composer) {
    const channelViewEvidence = Boolean(document.querySelector('h1, [data-list-item-id*="channels___" i][aria-selected="true"], [aria-label*="Channel" i], [data-list-id="chat-messages"], [role="log"]'));
    const composerMissing = document.readyState === 'complete' && channelViewEvidence;
    return {
      ok: false,
      authenticated,
      pageState,
      url: location.href,
      documentTitle: document.title,
      failureCode: composerMissing ? 'composer_missing' : 'not_ready',
      reason: composerMissing
        ? 'No Discord message composer was found.'
        : 'Discord Web has not finished loading the message composer yet.',
      diagnostics
    };
  }

  const existingText = textOf(composer);
  if (existingText) {
    return {
      ok: false,
      authenticated,
      pageState,
      url: location.href,
      documentTitle: document.title,
      failureCode: 'composer_not_empty',
      reason: 'Discord composer already contains text. Bonzi did not overwrite it and did not send anything.',
      composerText: existingText,
      diagnostics
    };
  }

  composer.focus({ preventScroll: true });
  return { ok: true, authenticated, pageState, url: location.href, documentTitle: document.title, composerText: '', diagnostics };
})()`
