const CHAT_PARAMETERS_STORAGE_KEY = 'chainlit:chatParameters';
const MAX_CHAT_PARAMETERS = 8;
const MAX_CHAT_PARAMETER_VALUE_LENGTH = 50;

type ChatParameters = Record<string, string>;

const sanitizeEntries = (entries: Iterable<[string, string]>): ChatParameters =>
  Object.fromEntries(
    Array.from(entries)
      .slice(0, MAX_CHAT_PARAMETERS)
      .map(([key, value]) => [
        key,
        value.slice(0, MAX_CHAT_PARAMETER_VALUE_LENGTH)
      ])
  );

export const getChatParametersFromSearch = (search: string): ChatParameters =>
  sanitizeEntries(new URLSearchParams(search).entries());

export const storeChatParametersForAuth = (search: string) => {
  try {
    const chatParameters = getChatParametersFromSearch(search);
    if (Object.keys(chatParameters).length) {
      sessionStorage.setItem(
        CHAT_PARAMETERS_STORAGE_KEY,
        JSON.stringify(chatParameters)
      );
    } else {
      sessionStorage.removeItem(CHAT_PARAMETERS_STORAGE_KEY);
    }
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
};

export const getChatParameters = (search: string): ChatParameters => {
  const chatParameters = getChatParametersFromSearch(search);
  if (Object.keys(chatParameters).length) return chatParameters;

  try {
    const stored = JSON.parse(
      sessionStorage.getItem(CHAT_PARAMETERS_STORAGE_KEY) || '{}'
    );
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};

    return sanitizeEntries(
      Object.entries(stored).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    );
  } catch {
    return {};
  }
};

export const clearStoredChatParameters = () => {
  try {
    sessionStorage.removeItem(CHAT_PARAMETERS_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
};
