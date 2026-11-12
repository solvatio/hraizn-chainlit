import { act, render } from '@testing-library/react';
import AppWrapper from 'AppWrapper';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, expect, it, vi } from 'vitest';

import german from '../../backend/chainlit/translations/de-DE.json';
import english from '../../backend/chainlit/translations/en-US.json';

const mocks = vi.hoisted(() => ({
  installHostActions: vi.fn(() => vi.fn()),
  send: vi.fn(() => true),
  language: 'de-DE',
  translations: { translation: {} },
  config: {
    widget: true,
    features: { allowed_host_origins: ['https://shop.example'] }
  }
}));

vi.mock('App', () => ({ default: () => null }));
vi.mock('lib/router', () => ({ default: () => '/example/m/widget' }));
vi.mock('@chainlit/react-client', () => ({
  useAuth: () => ({ data: {}, isAuthenticated: true, isReady: true }),
  useConfig: () => ({ language: mocks.language, config: mocks.config }),
  useApi: () => ({ data: mocks.translations }),
  useChatInteract: () => ({ windowMessage: mocks.send }),
  isOwnWindowMessage: () => false,
  installHostActions: mocks.installHostActions
}));

beforeEach(() => {
  mocks.installHostActions.mockClear();
  mocks.send.mockClear();
  mocks.language = 'de-DE';
});

it('uses the current UI language and custom texts without reinstalling the host controller', async () => {
  const i18n = createInstance();
  await i18n.init({
    lng: 'de-DE',
    fallbackLng: 'en-US',
    resources: {
      'de-DE': { translation: german },
      'en-US': { translation: english }
    }
  });

  render(
    <I18nextProvider i18n={i18n}>
      <AppWrapper />
    </I18nextProvider>
  );

  expect(mocks.installHostActions).toHaveBeenCalledTimes(1);
  const translate = (
    mocks.installHostActions.mock.calls[0] as unknown[]
  )[5] as (key: string, fallback: string) => string;

  expect(translate('hostActions.success', english.hostActions.success)).toBe(
    german.hostActions.success
  );

  await act(async () => {
    await i18n.changeLanguage('en-US');
  });

  expect(translate('hostActions.success', english.hostActions.success)).toBe(
    english.hostActions.success
  );
  expect(mocks.installHostActions).toHaveBeenCalledTimes(1);

  i18n.addResourceBundle(
    'en-US',
    'translation',
    { hostActions: { success: 'Your action is complete.' } },
    true,
    true
  );
  expect(translate('hostActions.success', english.hostActions.success)).toBe(
    'Your action is complete.'
  );
  expect(translate('hostActions.missing', 'English fallback')).toBe(
    'English fallback'
  );
  expect(mocks.installHostActions).toHaveBeenCalledTimes(1);
});

it('uses readable English fallbacks for older or untranslated language bundles', async () => {
  mocks.language = 'fr-FR';
  const i18n = createInstance();
  await i18n.init({ lng: 'fr-FR', fallbackLng: 'en-US', resources: {} });

  render(
    <I18nextProvider i18n={i18n}>
      <AppWrapper />
    </I18nextProvider>
  );

  const translate = (
    mocks.installHostActions.mock.calls[0] as unknown[]
  )[5] as (key: string, fallback: string) => string;
  for (const [key, fallback] of Object.entries(english.hostActions)) {
    expect(translate(`hostActions.${key}`, fallback)).toBe(fallback);
  }
});
