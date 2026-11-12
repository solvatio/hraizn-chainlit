// Persists the current thread of an embedded widget chat so that a full page
// navigation of the host page (which reloads the chat iframe) can resume the
// conversation. Browsers partition iframe storage by top-level site, so all pages
// of one host site share the entry while other host sites never see it.
//
// The stored id is only a hint: the backend still verifies that the
// authenticated user is the author of the thread before resuming it.

const STORAGE_KEY_PREFIX = 'hraizn:widgetThread:';
export const WIDGET_THREAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Query parameter a host sets on the iframe URL to start a new conversation,
// e.g. for an explicit restart. Only the value "new" is recognised.
export const WIDGET_THREAD_PARAM = 'hraiznThread';

// Socket.IO connect errors raised by the backend when a thread cannot be resumed
// (see backend/chainlit/socket.py). Transport errors are deliberately not listed:
// a temporary network failure must not drop the stored conversation.
const RESUME_REJECTIONS = new Set(['thread not found', 'authorization failed']);

const THREAD_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StoredWidgetThread {
  id: string;
  savedAt: number;
}

const storageKey = (basename: string) => STORAGE_KEY_PREFIX + (basename || '/');

export const clearStoredWidgetThread = (basename: string) => {
  try {
    localStorage.removeItem(storageKey(basename));
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
};

export const readStoredWidgetThread = (
  basename: string,
  now: number = Date.now()
): string | undefined => {
  let stored: Partial<StoredWidgetThread> | null;
  try {
    stored = JSON.parse(localStorage.getItem(storageKey(basename)) || 'null');
  } catch {
    stored = null;
  }
  if (!stored) return undefined;

  const valid =
    typeof stored === 'object' &&
    typeof stored.id === 'string' &&
    THREAD_ID.test(stored.id) &&
    typeof stored.savedAt === 'number' &&
    Number.isFinite(stored.savedAt) &&
    stored.savedAt <= now &&
    now - stored.savedAt < WIDGET_THREAD_MAX_AGE_MS;

  if (!valid) {
    clearStoredWidgetThread(basename);
    return undefined;
  }
  return stored.id;
};

export const storeWidgetThread = (
  basename: string,
  threadId: string,
  now: number = Date.now()
) => {
  if (!THREAD_ID.test(threadId)) return;
  try {
    const entry: StoredWidgetThread = { id: threadId, savedAt: now };
    localStorage.setItem(storageKey(basename), JSON.stringify(entry));
  } catch {
    // Without storage the conversation simply is not resumed after a reload.
  }
};

export const isNewWidgetThreadRequested = (search: string) => {
  try {
    return new URLSearchParams(search).get(WIDGET_THREAD_PARAM) === 'new';
  } catch {
    return false;
  }
};

export const isResumeRejection = (error: unknown) =>
  error instanceof Error && RESUME_REJECTIONS.has(error.message);
