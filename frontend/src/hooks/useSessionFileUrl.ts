import { useContext, useEffect, useState } from 'react';

import { ChainlitContext } from '@chainlit/react-client';

/**
 * Resolves the URL of an element for use in `src`/`href` attributes.
 *
 * Files of a chat session (`/project/file/...`) need the access token, which
 * can only be sent as a header and must never be part of a URL. Those files
 * are loaded with the token and exposed as a blob URL. Every other URL
 * (storage provider, public asset, external) is returned unchanged.
 *
 * Returns undefined while a session file is loading or if it failed to load.
 */
export const useSessionFileUrl = (url?: string): string | undefined => {
  const apiClient = useContext(ChainlitContext);
  const needsToken =
    !!url && apiClient.isSessionFileUrl(url) && !!apiClient.getToken();
  const [blobUrl, setBlobUrl] = useState<string>();

  useEffect(() => {
    if (!url || !needsToken) return;

    const controller = new AbortController();
    let created: string | undefined;

    apiClient
      .fetchSessionFileBlobUrl(url, controller.signal)
      .then((objectUrl) => {
        if (controller.signal.aborted) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        created = objectUrl;
        setBlobUrl(objectUrl);
      })
      .catch(() => {
        // The element stays hidden, as it would for a missing file.
      });

    return () => {
      controller.abort();
      if (created) URL.revokeObjectURL(created);
      setBlobUrl(undefined);
    };
  }, [apiClient, url, needsToken]);

  return needsToken ? blobUrl : url;
};
