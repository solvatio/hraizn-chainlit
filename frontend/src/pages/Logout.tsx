import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from 'client-types/*';

export default function Logout() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const logoutStarted = useRef(false);

  useEffect(() => {
    if (logoutStarted.current) {
      return;
    }
    logoutStarted.current = true;

    const runLogout = async () => {
      try {
        await logout();
      } finally {
        navigate('/login', { replace: true });
      }
    };

    void runLogout();
  }, [logout, navigate]);

  return null;
}
