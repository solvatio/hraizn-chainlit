import getRouterBasename from '@/lib/router';
import { storeChatParametersForAuth } from '@/lib/chatParameters';
import App from 'App';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useApi,
  useAuth,
  useChatInteract,
  useConfig
} from '@chainlit/react-client';

export default function AppWrapper() {
  const [translationLoaded, setTranslationLoaded] = useState(false);
  const { data: authConfig, isAuthenticated, isReady } = useAuth();
  const { language: languageInUse } = useConfig();
  const { i18n } = useTranslation();
  const { windowMessage } = useChatInteract();
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
    languageInUse
      ? `/project/translations?language=${languageInUse}`
      : null
  );

  useEffect(() => {
    if (!translations) return;
    handleChangeLanguage(translations.translation);
    setTranslationLoaded(true);
  }, [translations]);

  useEffect(() => {
    const handleWindowMessage = (event: MessageEvent) => {
      windowMessage(event.data);
    };
    window.addEventListener('message', handleWindowMessage);
    return () => window.removeEventListener('message', handleWindowMessage);
  }, [windowMessage]);

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
      requireLogin && anonymousAuth && isRootPath ? anonymousLoginPath : loginPath;
  }
  return <App />;
}
