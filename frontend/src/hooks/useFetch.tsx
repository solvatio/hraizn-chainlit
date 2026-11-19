import { useContext } from 'react';
import useSWR, { SWRResponse } from 'swr';

import { ChainlitContext } from '@chainlit/react-client';

const fetcher =
  (isChainlitRequest: boolean, authHeaders: { Authorization?: string }) =>
  async (url: string): Promise<any> => {
    // The access token is only ever sent to the chat backend.
    const fetchOptions: RequestInit = {
      ...(isChainlitRequest && { credentials: 'include', headers: authHeaders })
    };

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      throw new Error('Network response was not ok');
    }

    const contentType = response.headers.get('content-type');
    return contentType?.includes('application/json')
      ? response.json()
      : response.text();
  };

const useFetch = (endpoint: string | null): SWRResponse<any, Error> => {
  const apiClient = useContext(ChainlitContext);
  const isChainlitRequest = endpoint?.startsWith(apiClient.httpEndpoint);

  return useSWR<any, Error>(
    endpoint,
    fetcher(!!isChainlitRequest, apiClient.authHeaders())
  );
};

export { useFetch };
