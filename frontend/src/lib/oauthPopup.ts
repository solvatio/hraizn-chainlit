// OAuth login of an embedded (iframe) chat.
//
// An identity provider cannot be shown inside an iframe, and the login handoff
// cookie is a third-party cookie there, which browsers block. The login
// therefore runs in a popup: as a top-level window it is first-party, completes
// the redirect flow, exchanges the handoff for the access token and passes the
// token to the chat iframe that opened it.
//
// The token is only ever posted to a window of the chat's own origin
// (`targetOrigin`), never to the host page, and never appears in a URL.

export const OAUTH_POPUP_NAME = 'hraizn-oauth-login';
const MESSAGE_TYPE = 'hraizn:oauthLogin';
const POPUP_FEATURES = 'popup=yes,width=520,height=680';

export type OAuthPopupResult = { token: string } | { error: string };

interface OAuthPopupMessage {
  type: typeof MESSAGE_TYPE;
  token?: string;
  error?: string;
}

export const isEmbedded = (win: Window = window): boolean => {
  try {
    return win.self !== win.top;
  } catch {
    // Accessing a cross-origin top window can throw: that is an iframe.
    return true;
  }
};

/** True inside the login popup opened by an embedded chat. */
export const isOAuthPopup = (win: Window = window): boolean =>
  win.name === OAUTH_POPUP_NAME && !!win.opener;

/** Popup side: hand the result to the chat that opened the popup and close. */
export const finishOAuthPopup = (
  result: OAuthPopupResult,
  win: Window = window
) => {
  const message: OAuthPopupMessage = { type: MESSAGE_TYPE, ...result };
  try {
    // Exact target origin: only a window of the chat origin receives it.
    win.opener?.postMessage(message, win.location.origin);
  } finally {
    win.close();
  }
};

const parseResult = (data: unknown): OAuthPopupResult | undefined => {
  if (typeof data !== 'object' || data === null) return undefined;
  const message = data as Partial<OAuthPopupMessage>;
  if (message.type !== MESSAGE_TYPE) return undefined;
  if (typeof message.token === 'string' && message.token) {
    return { token: message.token };
  }
  return {
    error: typeof message.error === 'string' ? message.error : 'unknown'
  };
};

/**
 * Chat side: opens the login popup and resolves with its result. Resolves
 * with undefined if the popup was blocked or closed without logging in.
 */
export const openOAuthPopup = (
  url: string,
  win: Window = window
): Promise<OAuthPopupResult | undefined> => {
  const popup = win.open(url, OAUTH_POPUP_NAME, POPUP_FEATURES);
  if (!popup) return Promise.resolve(undefined);

  return new Promise((resolve) => {
    const finish = (result: OAuthPopupResult | undefined) => {
      win.removeEventListener('message', onMessage);
      win.clearInterval(closedPoll);
      resolve(result);
    };

    const onMessage = (event: MessageEvent) => {
      // Only the popup opened here, and only from the chat's own origin.
      if (event.source !== popup || event.origin !== win.location.origin) {
        return;
      }
      const result = parseResult(event.data);
      if (result) finish(result);
    };

    const closedPoll = win.setInterval(() => {
      if (popup.closed) finish(undefined);
    }, 500);

    win.addEventListener('message', onMessage);
  });
};
