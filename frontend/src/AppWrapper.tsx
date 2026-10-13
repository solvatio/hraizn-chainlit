import { storeChatParametersForAuth } from '@/lib/chatParameters';
import getRouterBasename from '@/lib/router';
import App from 'App';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useApi,
  useAuth,
  useChatInteract,
  useConfig
} from '@chainlit/react-client';
import { installHostActions, isOwnWindowMessage } from '@chainlit/react-client';

export default function AppWrapper() {
  const [translationLoaded, setTranslationLoaded] = useState(false);
  const { data: authConfig, isAuthenticated, isReady } = useAuth();
  const { language: languageInUse, config } = useConfig();
  const { i18n } = useTranslation();
  const { windowMessage } = useChatInteract();
  const sendRef = useRef(windowMessage);
  sendRef.current = windowMessage;
  const basename = getRouterBasename();
  const loginPath = basename + '/login';
  const anonymousLoginPath = basename + '/login-anon';
  const loginCallbackPath = basename + '/login/callback';
  const requireLogin = authConfig?.requireLogin;
  const anonymousAuth = authConfig?.anonymousAuth;
  const isRootPath =
    window.location.pathname === basename ||
    window.location.pathname === basename + '/';

  function handleChangeLanguage(languageBundle: any): void {
    if (!languageInUse) return;
    i18n.addResourceBundle(languageInUse, 'translation', languageBundle);
    i18n.changeLanguage(languageInUse);
  }

  const { data: translations } = useApi<any>(
    languageInUse ? `/project/translations?language=${languageInUse}` : null
  );

  useEffect(() => {
    if (!translations) return;
    handleChangeLanguage(translations.translation);
    setTranslationLoaded(true);
  }, [translations]);

  useEffect(() => {
    const handleWindowMessage = (event: MessageEvent) => {
      // Host messages are handled locally by the origin-bound controller.
      // Existing login, consent and voice scripts use the own-window path.
      if (isOwnWindowMessage(event, window)) windowMessage(event.data);
    };
    window.addEventListener('message', handleWindowMessage);
    return () => window.removeEventListener('message', handleWindowMessage);
  }, [windowMessage]);

  const originsKey = JSON.stringify(
    config?.features.allowed_host_origins || []
  );
  useEffect(() => {
    const origins: string[] = JSON.parse(originsKey);
    if (!config?.widget || !origins.length) return;
    return installHostActions(window, document, origins, basename, (data) =>
      sendRef.current(data)
    );
  }, [originsKey, config?.widget, basename]);

  if (!translationLoaded) return null;

  if (
    isReady &&
    !isAuthenticated &&
    window.location.pathname !== loginPath &&
    window.location.pathname !== anonymousLoginPath &&
    window.location.pathname !== loginCallbackPath
  ) {
    storeChatParametersForAuth(window.location.search);
    window.location.href =
      requireLogin && anonymousAuth && isRootPath
        ? anonymousLoginPath
        : loginPath;
  }
  return <App />;
}
