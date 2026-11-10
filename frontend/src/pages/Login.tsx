import { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { LoginForm } from '@/components/LoginForm';
import { Logo } from '@/components/Logo';
import { useTheme } from '@/components/ThemeProvider';
import {
  finishOAuthPopup,
  isEmbedded,
  isOAuthPopup,
  openOAuthPopup
} from '@/lib/oauthPopup';

import { useQuery } from 'hooks/query';

import { ClientError } from '@chainlit/react-client';

import { ChainlitContext, useAuth } from 'client-types/*';

export const LoginError = new Error(
  'Error logging in. Please try again later.'
);

export default function Login() {
  const query = useQuery();
  const { data: config, user, setUserFromAPI } = useAuth();
  const [error, setError] = useState('');
  const apiClient = useContext(ChainlitContext);
  const navigate = useNavigate();
  const { variant } = useTheme();
  const isDarkMode = variant === 'dark';

  const handleTokenAuth = (json: any): void => {
    if (json?.success != true) throw LoginError;

    // The API client stored the access token. Load the user data.
    setUserFromAPI();
  };

  const handleAuth = async (
    jsonPromise: Promise<any>,
    redirectURL?: string
  ) => {
    try {
      const json = await jsonPromise;

      handleTokenAuth(json);

      if (redirectURL) {
        navigate(redirectURL);
      }
    } catch (error: any) {
        if (error instanceof ClientError && error.detail) {
          setError(error.detail);
        } else if (error instanceof Error) {
          setError(error.message);
        }
    }
  };

  const handleHeaderAuth = async () => {
    const jsonPromise = apiClient.headerAuth();

    // Why does apiClient redirect to '/' but handlePasswordLogin to callbackUrl?
    await handleAuth(jsonPromise, '/');
  };

  const handlePasswordLogin = async (email: string, password: string) => {
    const formData = new FormData();
    formData.append('username', email);
    formData.append('password', password);

    const jsonPromise = apiClient.passwordAuth(formData);
    await handleAuth(jsonPromise);
  };

  // Embedded chat: the identity provider cannot be framed, so the login runs
  // in a popup which hands the access token back to this window.
  const handleOAuthPopupLogin = async (provider: string) => {
    const result = await openOAuthPopup(apiClient.getOAuthEndpoint(provider));
    if (!result) return;

    if ('token' in result) {
      apiClient.setToken(result.token);
      setError('');
      await setUserFromAPI();
    } else {
      setError(LoginError.message);
    }
  };

  useEffect(() => {
    const oauthError = query.get('error') || '';
    // A failed login inside the popup is reported to the embedded chat.
    if (oauthError && isOAuthPopup()) {
      finishOAuthPopup({ error: oauthError });
      return;
    }
    setError(oauthError);
  }, [query]);

  useEffect(() => {
    if (!config) {
      return;
    }
    if (!config.requireLogin) {
      navigate('/');
      return;
    }
    if (config.headerAuth) {
      handleHeaderAuth();
    }
    if (config.anonymousAuth && user?.identifier === 'anon') {
      navigate('/logout');
      return;
    }
    if (user) {
      navigate('/');
    }
  }, [config, user]);

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <Logo className="w-[150px]" />
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">
            <LoginForm
              error={error}
              callbackUrl="/"
              providers={config?.oauthProviders || []}
              onPasswordSignIn={
                config?.passwordAuth ? handlePasswordLogin : undefined
              }
              onOAuthSignIn={async (provider: string) => {
                if (isEmbedded()) {
                  await handleOAuthPopupLogin(provider);
                } else {
                  window.location.href = apiClient.getOAuthEndpoint(provider);
                }
              }}
            />
          </div>
        </div>
      </div>
      {!config?.headerAuth ? (
        <div className="relative hidden bg-muted lg:block overflow-hidden">
          <img
            src={
              config?.ui?.login_page_image ||
              apiClient.buildEndpoint('/favicon')
            }
            alt="Image"
            className={`absolute inset-0 h-full w-full object-cover ${
              isDarkMode
                ? config?.ui?.login_page_image_dark_filter ||
                  'brightness-[0.2] grayscale'
                : config?.ui?.login_page_image_filter || ''
            }`}
          />
        </div>
      ) : null}
    </div>
  );
}
