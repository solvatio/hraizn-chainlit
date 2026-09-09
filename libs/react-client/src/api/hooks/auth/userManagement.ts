import { useEffect } from 'react';
import { IUser } from 'src/types';

import { useApi } from '../api';
import { isUnauthorizedError } from './errors';
import { useAuthState } from './state';

export const useUserManagement = () => {
  const { user, setUser } = useAuthState();

  const {
    data: userData,
    error,
    mutate: setUserFromAPI
  } = useApi<IUser>('/user');

  useEffect(() => {
    if (userData) {
      setUser(userData);
    }
  }, [userData, setUser]);

  useEffect(() => {
    // A temporary network or server failure does not invalidate the session.
    // Only clear the user when the backend explicitly rejects the credentials.
    if (isUnauthorizedError(error)) {
      setUser(null);
    }
  }, [error]);

  return { user, setUserFromAPI };
};
