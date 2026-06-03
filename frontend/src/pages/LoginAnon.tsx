import { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ClientError } from '@chainlit/react-client';

import { ChainlitContext, useAuth } from 'client-types/*';

export const LoginAnonError = new Error(
  'Error logging in. Please try again later.'
);

export default function LoginAnon() {
  const { data: config, user, setUserFromAPI } = useAuth();
  const [error, setError] = useState('');
  const [anonymousLoginStarted, setAnonymousLoginStarted] = useState(false);
  const apiClient = useContext(ChainlitContext);
  const navigate = useNavigate();

  const handleCookieAuth = (json: any): void => {
    if (json?.success != true) throw LoginAnonError;

    setUserFromAPI();
  };

  const handleAuth = async (jsonPromise: Promise<any>) => {
    try {
      const json = await jsonPromise;

      handleCookieAuth(json);
    } catch (error: any) {
      if (error instanceof ClientError && error.detail) {
        setError(error.detail);
      } else if (error instanceof Error) {
        setError(error.message);
      }
    }
  };

  const handleAnonymousLogin = async () => {
    const formData = new FormData();
    formData.append('username', 'anon');
    formData.append('password', 'anon');

    const jsonPromise = apiClient.passwordAuth(formData);
    await handleAuth(jsonPromise);
  };

  useEffect(() => {
    if (!config) {
      return;
    }

    if (!config.requireLogin) {
      navigate('/');
      return;
    }

    if (!config.anonymousAuth) {
      navigate('/login');
      return;
    }

    if (user) {
      navigate('/');
      return;
    }

    if (!anonymousLoginStarted) {
      setAnonymousLoginStarted(true);
      void handleAnonymousLogin();
    }
  }, [anonymousLoginStarted, config, navigate, user]);

  return (
    <div className="flex min-h-svh items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-xs text-center text-sm text-muted-foreground">
        {error || 'Signing you in...'}
      </div>
    </div>
  );
}
