import { useContext, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { finishOAuthPopup, isOAuthPopup } from '@/lib/oauthPopup';

import { ChainlitContext, useAuth } from '@chainlit/react-client';

export default function AuthCallback() {
  const { user, setUserFromAPI } = useAuth();
  const apiClient = useContext(ChainlitContext);
  const navigate = useNavigate();
  const exchangeStarted = useRef(false);

  // Redirect based login (OAuth): the backend hands the access token over in
  // a short-lived cookie. Exchange it once, then load the user.
  useEffect(() => {
    if (user || exchangeStarted.current) return;
    exchangeStarted.current = true;

    // Login popup of an embedded chat: pass the token on to the chat window.
    if (isOAuthPopup()) {
      apiClient
        .exchangeTokenForHandover()
        .then((token) => finishOAuthPopup({ token }))
        .catch(() => finishOAuthPopup({ error: 'exchange_failed' }));
      return;
    }

    apiClient
      .exchangeToken()
      .then(() => setUserFromAPI())
      .catch(() => navigate('/login', { replace: true }));
  }, []);

  useEffect(() => {
    if (user) {
      navigate('/');
    }
  }, [user]);

  return null;
}
