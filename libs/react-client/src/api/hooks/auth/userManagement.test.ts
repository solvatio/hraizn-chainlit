import { describe, expect, it } from 'vitest';

import { isUnauthorizedError } from './errors';

describe('isUnauthorizedError', () => {
  it('recognizes an unauthorized API response', () => {
    const error = Object.assign(new Error('Unauthorized'), { status: 401 });

    expect(isUnauthorizedError(error)).toBe(true);
  });

  it('does not treat a network failure as an authentication failure', () => {
    expect(isUnauthorizedError(new TypeError('Failed to fetch'))).toBe(false);
  });

  it('does not treat a server failure as an authentication failure', () => {
    const error = Object.assign(new Error('Server Error'), { status: 503 });

    expect(isUnauthorizedError(error)).toBe(false);
  });
});
