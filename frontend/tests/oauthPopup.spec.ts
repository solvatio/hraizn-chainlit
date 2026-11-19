import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OAUTH_POPUP_NAME,
  finishOAuthPopup,
  isOAuthPopup,
  openOAuthPopup
} from '../src/lib/oauthPopup';

const ORIGIN = window.location.origin;
const MESSAGE_TYPE = 'hraizn:oauthLogin';

const dispatch = (data: unknown, origin: string, source: unknown) =>
  window.dispatchEvent(
    new MessageEvent('message', {
      data,
      origin,
      source: source as MessageEventSource
    })
  );

describe('oauth login popup', () => {
  let popup: { closed: boolean };

  beforeEach(() => {
    vi.useFakeTimers();
    popup = { closed: false };
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens a named popup and resolves with the token it posts', async () => {
    const result = openOAuthPopup('https://chat.example/auth/oauth/azure');

    expect(window.open).toHaveBeenCalledWith(
      'https://chat.example/auth/oauth/azure',
      OAUTH_POPUP_NAME,
      expect.stringContaining('popup')
    );

    dispatch({ type: MESSAGE_TYPE, token: 'token-1' }, ORIGIN, popup);

    expect(await result).toEqual({ token: 'token-1' });
  });

  it('ignores messages from other origins and other windows', async () => {
    const result = openOAuthPopup('https://chat.example/auth/oauth/azure');

    dispatch({ type: MESSAGE_TYPE, token: 'evil' }, 'https://host.example', popup);
    dispatch({ type: MESSAGE_TYPE, token: 'evil' }, ORIGIN, {});
    dispatch({ type: 'other', token: 'evil' }, ORIGIN, popup);
    dispatch({ type: MESSAGE_TYPE, token: 'token-1' }, ORIGIN, popup);

    expect(await result).toEqual({ token: 'token-1' });
  });

  it('reports a failed login', async () => {
    const result = openOAuthPopup('https://chat.example/auth/oauth/azure');

    dispatch({ type: MESSAGE_TYPE, error: 'access_denied' }, ORIGIN, popup);

    expect(await result).toEqual({ error: 'access_denied' });
  });

  it('resolves with undefined when the popup is closed without a result', async () => {
    const result = openOAuthPopup('https://chat.example/auth/oauth/azure');

    popup.closed = true;
    vi.advanceTimersByTime(500);

    expect(await result).toBeUndefined();
  });

  it('resolves with undefined when the popup is blocked', async () => {
    vi.mocked(window.open).mockReturnValue(null);

    expect(
      await openOAuthPopup('https://chat.example/auth/oauth/azure')
    ).toBeUndefined();
  });

  it('posts the result to the opener with the exact chat origin and closes', () => {
    const opener = { postMessage: vi.fn() };
    const popupWindow = {
      name: OAUTH_POPUP_NAME,
      opener,
      location: { origin: 'https://chat.example' },
      close: vi.fn()
    } as unknown as Window;

    expect(isOAuthPopup(popupWindow)).toBe(true);
    finishOAuthPopup({ token: 'token-1' }, popupWindow);

    expect(opener.postMessage).toHaveBeenCalledWith(
      { type: MESSAGE_TYPE, token: 'token-1' },
      'https://chat.example'
    );
    expect(popupWindow.close).toHaveBeenCalled();
  });

  it('does not treat a normal window as login popup', () => {
    expect(isOAuthPopup({ name: '', opener: {} } as unknown as Window)).toBe(
      false
    );
    expect(
      isOAuthPopup({ name: OAUTH_POPUP_NAME, opener: null } as unknown as Window)
    ).toBe(false);
  });
});
