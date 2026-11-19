"""Reasons for a refused Socket.IO connection.

The client reacts to these messages (new login, dropping a stored thread), so
they are part of the contract between backend and client. Keep them in sync
with libs/react-client/src/socketErrors.ts; a test compares both files.
"""


class SocketConnectError:
    # The access token is missing, expired or invalid: the client signs in again.
    AUTHENTICATION_FAILED = "authentication failed"
    # The thread to resume does not exist: the client drops the stored thread.
    THREAD_NOT_FOUND = "thread not found"
    # The thread belongs to another user: the client drops the stored thread.
    AUTHORIZATION_FAILED = "authorization failed"
