import { IElement, IThread, IUser } from 'src/types';

import { IAction } from 'src/types/action';
import { IFeedback } from 'src/types/feedback';

import {
  clearToken,
  readToken,
  tokenStorageKey,
  writeToken
} from './tokenStorage';

export * from './hooks/auth';
export * from './hooks/api';

export interface IThreadFilters {
  search?: string;
  feedback?: number;
}

export interface IPageInfo {
  hasNextPage: boolean;
  endCursor?: string;
}

export interface IPagination {
  first: number;
  cursor?: string | number;
}

export class ClientError extends Error {
  status: number;
  detail?: string;

  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }

  toString() {
    if (this.detail) {
      return `${this.message}: ${this.detail}`;
    } else {
      return this.message;
    }
  }
}

type Payload = FormData | any;

export class APIBase {
  constructor(
    public httpEndpoint: string,
    public type: 'webapp' | 'copilot' | 'teams' | 'slack' | 'discord',
    public additionalQueryParams?: Record<string, string>,
    public on401?: () => void,
    public onError?: (error: ClientError) => void
  ) {}

  /** The access token of this chat endpoint, if the user is logged in. */
  getToken(): string | undefined {
    return readToken(tokenStorageKey(this.httpEndpoint));
  }

  setToken(token: string) {
    writeToken(tokenStorageKey(this.httpEndpoint), token);
  }

  clearToken() {
    clearToken(tokenStorageKey(this.httpEndpoint));
  }

  /** Authorization header for requests that do not go through `fetch`. */
  authHeaders(): { Authorization?: string } {
    const token = this.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  buildEndpoint(path: string) {
    let fullUrl = `${this.httpEndpoint}${path}`;
    if (this.httpEndpoint.endsWith('/')) {
      // remove trailing slash on httpEndpoint
      fullUrl = `${this.httpEndpoint.slice(0, -1)}${path}`;
    }

    const url = new URL(fullUrl);

    // Add additionalQueryParams for all API calls
    if (this.additionalQueryParams) {
      const params = new URLSearchParams(this.additionalQueryParams);
      const separator = url.search ? '&' : '?';
      url.search = url.search + `${separator}${params.toString()}`;
    }

    return url.toString();
  }

  private async getDetailFromErrorResponse(
    res: Response
  ): Promise<string | undefined> {
    try {
      const body = await res.json();
      return body?.detail;
    } catch (error: any) {
      console.error('Unable to parse error response', error);
    }
    return undefined;
  }

  private handleRequestError(error: any) {
    if (error instanceof ClientError) {
      if (error.status === 401 && this.on401) {
        this.on401();
      }
      if (this.onError) {
        this.onError(error);
      }
    }
    console.error(error);
  }

  /**
   * Low-level HTTP request handler for direct API interactions.
   * Provides full control over HTTP methods, request configuration, and error handling.
   *
   * Key features:
   * - Supports all HTTP methods (GET, POST, PUT, PATCH, DELETE)
   * - Handles both FormData and JSON payloads
   * - Manages authentication headers
   * - Custom error handling with ClientError class
   * - Support for request cancellation via AbortSignal
   *
   * @param method - HTTP method to use (GET, POST, etc.)
   * @param path - API endpoint path
   * @param data - Optional request payload (FormData or JSON-serializable data)
   * @param signal - Optional AbortSignal for request cancellation
   * @returns Promise<Response>
   * @throws ClientError for HTTP errors, including 401 unauthorized
   */
  async fetch(
    method: string,
    path: string,
    data?: Payload,
    signal?: AbortSignal,
    headers: { Authorization?: string; 'Content-Type'?: string } = {}
  ): Promise<Response> {
    try {
      let body;

      if (data instanceof FormData) {
        body = data;
      } else {
        headers['Content-Type'] = 'application/json';
        body = data ? JSON.stringify(data) : null;
      }

      // The bearer token is the only credential of the chat. An explicitly
      // passed Authorization header (e.g. jwtAuth) takes precedence.
      const storedToken = this.getToken();
      if (storedToken && !headers.Authorization) {
        headers.Authorization = `Bearer ${storedToken}`;
      }
      const sentStoredToken =
        !!storedToken && headers.Authorization === `Bearer ${storedToken}`;

      const res = await fetch(this.buildEndpoint(path), {
        method,
        // Not used for authentication. Kept for the short-lived login handoff
        // cookie and for load balancer affinity cookies.
        credentials: 'include',
        headers,
        signal,
        body
      });

      if (!res.ok) {
        // The backend rejected the stored token (expired or invalid): drop
        // it so that the next login starts clean.
        if (
          res.status === 401 &&
          sentStoredToken &&
          this.getToken() === storedToken
        ) {
          this.clearToken();
        }

        const detail = await this.getDetailFromErrorResponse(res);

        throw new ClientError(res.statusText, res.status, detail);
      }

      return res;
    } catch (error: any) {
      this.handleRequestError(error);
      throw error;
    }
  }

  async get(endpoint: string) {
    return await this.fetch('GET', endpoint);
  }

  async post(endpoint: string, data: Payload, signal?: AbortSignal) {
    return await this.fetch('POST', endpoint, data, signal);
  }

  async put(endpoint: string, data: Payload) {
    return await this.fetch('PUT', endpoint, data);
  }

  async patch(endpoint: string, data: Payload) {
    return await this.fetch('PATCH', endpoint, data);
  }

  async delete(endpoint: string, data: Payload) {
    return await this.fetch('DELETE', endpoint, data);
  }
}

// A refused socket connection triggers a new login at most this often.
const SOCKET_AUTH_RETRY_MS = 30_000;
let socketAuthFailureHandled = false;

export class ChainlitAPI extends APIBase {
  /** Stores the access token of a login response. */
  private async storeLoginToken(res: Response) {
    const json = await res.json();
    if (typeof json?.access_token === 'string' && json.access_token) {
      this.setToken(json.access_token);
      // The token stays inside the API client.
      delete json.access_token;
    }
    return json;
  }

  async headerAuth() {
    const res = await this.post(`/auth/header`, {});
    return this.storeLoginToken(res);
  }

  async jwtAuth(token: string) {
    const res = await this.fetch('POST', '/auth/jwt', undefined, undefined, {
      Authorization: `Bearer ${token}`
    });
    return this.storeLoginToken(res);
  }

  /**
   * Completes a redirect based login (OAuth): exchanges the short-lived
   * handoff cookie set by the backend callback for the access token.
   */
  async exchangeToken() {
    const res = await this.post(`/auth/token`, {});
    return this.storeLoginToken(res);
  }

  /**
   * Like exchangeToken, but returns the access token without storing it.
   * Used by the login popup of an embedded chat, which passes the token on
   * to the chat window instead of keeping it in its own storage.
   */
  async exchangeTokenForHandover(): Promise<string> {
    const res = await this.post(`/auth/token`, {});
    const json = await res.json();
    if (typeof json?.access_token !== 'string' || !json.access_token) {
      throw new ClientError('Unauthorized', 401);
    }
    return json.access_token;
  }

  async stickyCookie(sessionId: string) {
    const res = await this.fetch('POST', '/set-session-cookie', {
      session_id: sessionId
    });
    return res.json();
  }

  async passwordAuth(data: FormData) {
    const res = await this.post(`/login`, data);
    return this.storeLoginToken(res);
  }

  /**
   * Called when the backend refused the socket connection because of the
   * access token (expired or invalid). The token is dropped and the chat
   * signs in again. Returns false if this just happened, to avoid a loop.
   */
  handleSocketAuthFailure(): boolean {
    const key = 'hraizn:socketAuthFailure';
    try {
      const last = Number(sessionStorage.getItem(key) || 0);
      if (Date.now() - last < SOCKET_AUTH_RETRY_MS) return false;
      sessionStorage.setItem(key, String(Date.now()));
    } catch {
      // Without session storage the login is retried once per page load.
      if (socketAuthFailureHandled) return false;
    }
    socketAuthFailureHandled = true;
    this.clearToken();
    this.on401?.();
    return true;
  }

  async getUser(): Promise<IUser> {
    const res = await this.get(`/user`);
    return res.json();
  }

  async logout() {
    try {
      const res = await this.post(`/logout`, {});
      return await res.json();
    } finally {
      // The token is dropped even if the backend could not be reached.
      this.clearToken();
    }
  }

  async setFeedback(
    feedback: IFeedback,
    sessionId: string
  ): Promise<{ success: boolean; feedbackId: string }> {
    const res = await this.put(`/feedback`, { feedback, sessionId });
    return res.json();
  }

  async deleteFeedback(feedbackId: string): Promise<{ success: boolean }> {
    const res = await this.delete(`/feedback`, { feedbackId });
    return res.json();
  }

  async listThreads(
    pagination: IPagination,
    filter: IThreadFilters
  ): Promise<{
    pageInfo: IPageInfo;
    data: IThread[];
  }> {
    const res = await this.post(`/project/threads`, { pagination, filter });

    return res.json();
  }

  async renameThread(threadId: string, name: string) {
    const res = await this.put(`/project/thread`, { threadId, name });

    return res.json();
  }

  async deleteThread(threadId: string) {
    const res = await this.delete(`/project/thread`, { threadId });

    return res.json();
  }

  uploadFile(
    file: File,
    onProgress: (progress: number) => void,
    sessionId: string,
    parentId?: string
  ) {
    const xhr = new XMLHttpRequest();
    xhr.withCredentials = true;

    const promise = new Promise<{ id: string }>((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);

      const ask_parent_id = parentId ? `&ask_parent_id=${parentId}` : '';
      xhr.open(
        'POST',
        this.buildEndpoint(
          `/project/file?session_id=${sessionId}${ask_parent_id}`
        ),
        true
      );

      const { Authorization } = this.authHeaders();
      if (Authorization) xhr.setRequestHeader('Authorization', Authorization);

      // Track the progress of the upload
      xhr.upload.onprogress = function (event) {
        if (event.lengthComputable) {
          const percentage = (event.loaded / event.total) * 100;
          onProgress(percentage);
        }
      };

      xhr.onload = function () {
        if (xhr.status === 200) {
          const response = JSON.parse(xhr.responseText);
          resolve(response);
          return;
        }
        const contentType = xhr.getResponseHeader('Content-Type');
        if (contentType && contentType.includes('application/json')) {
          const response = JSON.parse(xhr.responseText);
          reject(response.detail);
        } else {
          reject('Upload failed');
        }
      };

      xhr.onerror = function () {
        reject('Upload error');
      };

      xhr.send(formData);
    });

    return { xhr, promise };
  }

  async callAction(action: IAction, sessionId: string) {
    const res = await this.post(`/project/action`, { sessionId, action });

    return res.json();
  }

  async updateElement(element: IElement, sessionId: string) {
    const res = await this.put(`/project/element`, { sessionId, element });

    return res.json();
  }

  async deleteElement(element: IElement, sessionId: string) {
    const res = await this.delete(`/project/element`, { sessionId, element });

    return res.json();
  }

  async connectStdioMCP(sessionId: string, name: string, fullCommand: string) {
    const res = await this.post(`/mcp`, {
      sessionId,
      name,
      fullCommand,
      clientType: 'stdio'
    });
    return res.json();
  }

  async connectSseMCP(
    sessionId: string,
    name: string,
    url: string,
    headers?: Record<string, string>
  ) {
    const res = await this.post(`/mcp`, {
      sessionId,
      name,
      url,
      ...(headers ? { headers } : {}),
      clientType: 'sse'
    });
    return res.json();
  }

  async connectStreamableHttpMCP(
    sessionId: string,
    name: string,
    url: string,
    headers?: Record<string, string>
  ) {
    const res = await this.post(`/mcp`, {
      sessionId,
      name,
      url,
      ...(headers ? { headers } : {}),
      clientType: 'streamable-http'
    });
    return res.json();
  }

  async disconnectMcp(sessionId: string, name: string) {
    const res = await this.delete(`/mcp`, { sessionId, name });
    return res.json();
  }

  getElementUrl(id: string, sessionId: string) {
    const queryParams = `?session_id=${sessionId}`;
    return this.buildEndpoint(`/project/file/${id}${queryParams}`);
  }

  /** True for files of a chat session, which need the access token. */
  isSessionFileUrl(url: string): boolean {
    return url.startsWith(this.buildEndpoint('/project/file/'));
  }

  /**
   * Loads a session file with the access token and returns a blob URL for
   * use in `src`/`href` attributes, which cannot send headers. The token is
   * never added to the URL. The caller revokes the blob URL when done.
   */
  async fetchSessionFileBlobUrl(
    url: string,
    signal?: AbortSignal
  ): Promise<string> {
    const res = await fetch(url, {
      credentials: 'include',
      headers: this.authHeaders(),
      signal
    });
    if (!res.ok) {
      throw new ClientError(res.statusText, res.status);
    }
    return URL.createObjectURL(await res.blob());
  }

  getLogoEndpoint(theme: string, configuredLogoUrl?: string) {
    if (configuredLogoUrl) return configuredLogoUrl;
    return this.buildEndpoint(`/logo?theme=${theme}`);
  }

  getOAuthEndpoint(provider: string) {
    return this.buildEndpoint(`/auth/oauth/${provider}`);
  }
  async shareThread(threadId: string, isShared: boolean): Promise<{ success: boolean }> {
    const res = await this.put(`/project/thread/share`, {
      threadId,
      isShared
    });
    return res.json();
  }
}
