import getRouterBasename from '@/lib/router';
import { storeChatParametersForAuth } from '@/lib/chatParameters';
import { toast } from 'sonner';

import { ChainlitAPI, ClientError } from '@chainlit/react-client';

const devServer = 'http://localhost:8000' + getRouterBasename();
const url = import.meta.env.DEV
  ? devServer
  : window.origin + getRouterBasename();
const serverUrl = new URL(url);

const httpEndpoint = serverUrl.toString();

const on401 = () => {
  const basename = getRouterBasename();
  const authPaths = ['/login', '/login-anon', '/login/callback'].map(
    (path) => basename + path
  );
  if (!authPaths.includes(window.location.pathname)) {
    // The API client already dropped the rejected token. Reloading the chat
    // root lets AppWrapper pick the right login: anonymous users are signed
    // in again, all others are sent to the login page.
    storeChatParametersForAuth(window.location.search);
    window.location.href = basename + '/';
  }
};

const onError = (error: ClientError) => {
  toast.error(error.toString());
};

class ExtendedChainlitAPI extends ChainlitAPI {
  async shareThread(
    threadId: string,
    isShared: boolean
  ): Promise<{ success: boolean }> {
    const res = await this.put(`/project/thread/share`, {
      threadId,
      isShared
    });
    return res.json();
  }

  connectStreamableHttpMCP(
    sessionId: string,
    name: string,
    url: string,
    headers?: Record<string, string>
  ) {
    // Assumes the backend expects { clientType, name, url }
    return fetch(new URL("mcp", this.httpEndpoint.endsWith("/") ? this.httpEndpoint : `${this.httpEndpoint}/`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders(),
        ...(sessionId ? { 'x-session-id': sessionId } : {})
      },
      body: JSON.stringify({
        clientType: 'streamable-http',
        name,
        url,
        sessionId,
        ...(headers ? { headers } : {})
      })
    }).then(async (res) => {
      const data = await res.json();
      return { success: res.ok, mcp: data.mcp, error: data.detail };
    });
  }
}

export const apiClient = new ExtendedChainlitAPI(
  httpEndpoint,
  'webapp',
  {}, // Optional - additionalQueryParams property.
  on401,
  onError
);
