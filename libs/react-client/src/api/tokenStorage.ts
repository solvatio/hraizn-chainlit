// Storage of the access token (bearer token).
//
// The token is kept in localStorage of the chat origin instead of a cookie:
// browsers block third-party cookies of embedded (iframe) chats, while
// storage stays available and is partitioned by top-level site there. One
// entry exists per chat endpoint (mode/basename), so chats served from the
// same origin never share a token.
//
// The token must never be put into URLs, logs or messages to a host page.

const STORAGE_KEY_PREFIX = 'hraizn:accessToken:';

// Fallback for contexts in which storage is unavailable (e.g. blocked site
// data). The session then lasts until the page is reloaded.
const memoryTokens = new Map<string, string>();

export const tokenStorageKey = (httpEndpoint: string): string => {
  let path = '/';
  try {
    path = new URL(httpEndpoint).pathname.replace(/\/+$/, '') || '/';
  } catch {
    // Keep the default key for an endpoint that is not an absolute URL.
  }
  return STORAGE_KEY_PREFIX + path;
};

export const readToken = (key: string): string | undefined => {
  try {
    const token = localStorage.getItem(key);
    if (token) return token;
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
  return memoryTokens.get(key);
};

export const writeToken = (key: string, token: string): void => {
  memoryTokens.set(key, token);
  try {
    localStorage.setItem(key, token);
  } catch {
    // The in-memory copy keeps the session alive until the next reload.
  }
};

export const clearToken = (key: string): void => {
  memoryTokens.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing was stored persistently.
  }
};
