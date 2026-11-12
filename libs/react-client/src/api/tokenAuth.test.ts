import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Loaded first: the package entry order resolves the api <-> context cycle.
import 'src/context';

import { ChainlitAPI } from './index';
import {
  clearToken,
  readToken,
  tokenStorageKey,
  writeToken
} from './tokenStorage';

const ENDPOINT = 'https://chat.example/tenant/m/widget';

const createStorage = () => {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
    entries
  };
};

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

const sentHeaders = (fetchMock: ReturnType<typeof vi.fn>, call = 0) =>
  fetchMock.mock.calls[call][1].headers as Record<string, string>;

describe('token storage', () => {
  let storage: ReturnType<typeof createStorage>;

  beforeEach(() => {
    storage = createStorage();
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    clearToken(tokenStorageKey(ENDPOINT));
    vi.unstubAllGlobals();
  });

  it('uses one key per chat endpoint', () => {
    expect(tokenStorageKey(ENDPOINT)).toBe(
      'hraizn:accessToken:/tenant/m/widget'
    );
    expect(tokenStorageKey(ENDPOINT + '/')).toBe(tokenStorageKey(ENDPOINT));
    expect(tokenStorageKey('https://chat.example/')).toBe(
      'hraizn:accessToken:/'
    );
    expect(tokenStorageKey('https://chat.example/other')).not.toBe(
      tokenStorageKey(ENDPOINT)
    );
  });

  it('persists, reads and clears the token', () => {
    const key = tokenStorageKey(ENDPOINT);

    writeToken(key, 'abc');
    expect(storage.entries.get(key)).toBe('abc');
    expect(readToken(key)).toBe('abc');

    clearToken(key);
    expect(storage.entries.has(key)).toBe(false);
    expect(readToken(key)).toBeUndefined();
  });

  it('falls back to memory when storage is unavailable', () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', {
      getItem: blocked,
      setItem: blocked,
      removeItem: blocked
    });
    const key = tokenStorageKey(ENDPOINT);

    writeToken(key, 'abc');
    expect(readToken(key)).toBe('abc');

    clearToken(key);
    expect(readToken(key)).toBeUndefined();
  });
});

describe('bearer token authentication', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let api: ChainlitAPI;

  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    api = new ChainlitAPI(ENDPOINT, 'webapp');
  });

  afterEach(() => {
    api.clearToken();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stores the token of a login response and keeps it out of the result', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { success: true, access_token: 'token-1' })
    );

    const result = await api.passwordAuth(new FormData());

    expect(result).toEqual({ success: true });
    expect(api.getToken()).toBe('token-1');
  });

  it('sends the stored token as bearer header and never in the URL', async () => {
    api.setToken('token-1');
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await api.get('/user');

    expect(sentHeaders(fetchMock).Authorization).toBe('Bearer token-1');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('token-1');
  });

  it('sends no authorization header without a token', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await api.get('/auth/config');

    expect(sentHeaders(fetchMock).Authorization).toBeUndefined();
  });

  it('drops a token the backend rejects', async () => {
    api.setToken('expired');
    fetchMock.mockResolvedValue(jsonResponse(401, { detail: 'Unauthorized' }));

    await expect(api.get('/user')).rejects.toMatchObject({ status: 401 });

    expect(api.getToken()).toBeUndefined();
  });

  it('keeps the token on errors other than 401', async () => {
    api.setToken('token-1');
    fetchMock.mockResolvedValue(jsonResponse(503, { detail: 'Unavailable' }));

    await expect(api.get('/user')).rejects.toMatchObject({ status: 503 });

    expect(api.getToken()).toBe('token-1');
  });

  it('keeps the stored token when a different token is rejected', async () => {
    api.setToken('token-1');
    fetchMock.mockResolvedValue(jsonResponse(401, { detail: 'Invalid token' }));

    await expect(api.jwtAuth('foreign')).rejects.toMatchObject({ status: 401 });

    expect(sentHeaders(fetchMock).Authorization).toBe('Bearer foreign');
    expect(api.getToken()).toBe('token-1');
  });

  it('exchanges the login handoff for the token', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { success: true, access_token: 'token-2' })
    );

    await api.exchangeToken();

    expect(String(fetchMock.mock.calls[0][0])).toBe(ENDPOINT + '/auth/token');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(api.getToken()).toBe('token-2');
  });

  it('drops the token on logout even if the request fails', async () => {
    api.setToken('token-1');
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(api.logout()).rejects.toThrow('Failed to fetch');

    expect(api.getToken()).toBeUndefined();
  });

  it('recognises session files and loads them with the token', async () => {
    api.setToken('token-1');
    const url = api.getElementUrl('file-1', 'session-1');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x' }));
    fetchMock.mockResolvedValue(new Response('data', { status: 200 }));

    expect(api.isSessionFileUrl(url)).toBe(true);
    expect(api.isSessionFileUrl('https://storage.example/file-1')).toBe(false);
    expect(await api.fetchSessionFileBlobUrl(url)).toBe('blob:x');
    expect(sentHeaders(fetchMock).Authorization).toBe('Bearer token-1');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('token-1');
  });
});
