export const isUnauthorizedError = (error: unknown): boolean =>
  error instanceof Error && 'status' in error && error.status === 401;
