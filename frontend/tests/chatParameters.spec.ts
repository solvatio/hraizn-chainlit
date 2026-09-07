import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearStoredChatParameters,
  getChatParameters,
  getChatParametersFromSearch,
  storeChatParametersForAuth
} from 'lib/chatParameters';

describe('chat parameters', () => {
  beforeEach(() => sessionStorage.clear());

  it('limits parameter count and value length', () => {
    const search =
      '?' +
      Array.from(
        { length: 10 },
        (_, index) => `parameter_${index}=${'x'.repeat(60)}`
      ).join('&');

    const result = getChatParametersFromSearch(search);

    expect(Object.keys(result)).toEqual(
      Array.from({ length: 8 }, (_, index) => `parameter_${index}`)
    );
    expect(Object.values(result).every((value) => value.length === 50)).toBe(
      true
    );
  });

  it('restores parameters after the login query string is lost', () => {
    storeChatParametersForAuth('?customer=123&source=email');

    expect(getChatParameters('')).toEqual({
      customer: '123',
      source: 'email'
    });
  });

  it('prefers parameters from the current URL', () => {
    storeChatParametersForAuth('?customer=stored');

    expect(getChatParameters('?customer=current')).toEqual({
      customer: 'current'
    });
  });

  it('clears stored parameters after connecting', () => {
    storeChatParametersForAuth('?customer=123');
    clearStoredChatParameters();

    expect(getChatParameters('')).toEqual({});
  });
});
