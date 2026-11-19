// Reasons for a refused Socket.IO connection, sent by the backend as message
// of the connect error. Keep in sync with backend/chainlit/socket_errors.py;
// a backend test compares both files.
export const SocketConnectError = {
  // The access token is missing, expired or invalid: sign in again.
  AUTHENTICATION_FAILED: 'authentication failed',
  // The thread to resume does not exist: drop the stored thread.
  THREAD_NOT_FOUND: 'thread not found',
  // The thread belongs to another user: drop the stored thread.
  AUTHORIZATION_FAILED: 'authorization failed'
} as const;
