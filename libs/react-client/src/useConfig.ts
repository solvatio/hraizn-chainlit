import { useEffect, useRef } from 'react';
import { useRecoilState, useRecoilValue } from 'recoil';

import { useApi, useAuth } from './api';
import { configState, chatProfileState } from './state';
import { IChainlitConfig } from './types';

interface ILanguageConfig {
  primary_language: string | null;
}

const useConfig = () => {
  const [config, setConfig] = useRecoilState(configState);
  const { isAuthenticated } = useAuth();
  const chatProfile = useRecoilValue(chatProfileState);
  const browserLanguage = navigator.language || 'en-US';
  const prevChatProfileRef = useRef(chatProfile);

  const {
    data: languageConfig,
    error: languageError,
    isLoading: isLanguageLoading
  } = useApi<ILanguageConfig>('/project/language');

  // Wait for the server response before loading language-dependent resources.
  // If the endpoint fails, retain the previous browser-based behavior.
  const language =
    languageConfig || languageError
      ? languageConfig?.primary_language?.trim() || browserLanguage
      : undefined;

  // Build the API URL with optional chat profile parameter
  const apiUrl = isAuthenticated && language
    ? `/project/settings?language=${language}${chatProfile ? `&chat_profile=${encodeURIComponent(chatProfile)}` : ''}`
    : null;

  // Always fetch if we don't have config and we're authenticated
  const shouldFetch = isAuthenticated && !config;

  const { data, error, isLoading: isConfigLoading } = useApi<IChainlitConfig>(
    shouldFetch ? apiUrl : null
  );

  useEffect(() => {
    if (!data) return;
    setConfig(data);
  }, [data, setConfig]);

  // Clear config when chat profile changes to force re-fetch
  useEffect(() => {
    if (prevChatProfileRef.current !== chatProfile) {
      setConfig(undefined);
      prevChatProfileRef.current = chatProfile;
    }
  }, [chatProfile, setConfig]);

  return {
    config,
    error: languageError || error,
    isLoading: isLanguageLoading || isConfigLoading,
    language
  };
};

export { useConfig };
