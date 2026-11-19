import { beforeEach, describe, expect, it } from 'vitest';

import { getChatParametersFromSearch } from '../src/lib/chatParameters';
import {
  WIDGET_THREAD_MAX_AGE_MS,
  clearStoredWidgetThread,
  isNewWidgetThreadRequested,
  isResumeRejection,
  readStoredWidgetThread,
  storeWidgetThread
} from '../src/lib/widgetThread';

const THREAD = '3d8630c4-ece2-4f16-b4aa-f31567d52b04';
const BASE = '/divino-prod/m/widget';

describe('widget thread persistence', () => {
  beforeEach(() => localStorage.clear());

  it('stores and reads the thread per basename', () => {
    storeWidgetThread(BASE, THREAD, 1000);

    expect(readStoredWidgetThread(BASE, 2000)).toBe(THREAD);
    expect(readStoredWidgetThread('/other/m/widget', 2000)).toBeUndefined();
  });

  it('expires and removes old entries', () => {
    storeWidgetThread(BASE, THREAD, 1000);

    expect(
      readStoredWidgetThread(BASE, 1000 + WIDGET_THREAD_MAX_AGE_MS)
    ).toBeUndefined();
    expect(localStorage.length).toBe(0);
  });

  it('rejects entries from the future and malformed values', () => {
    storeWidgetThread(BASE, THREAD, 5000);
    expect(readStoredWidgetThread(BASE, 1000)).toBeUndefined();

    localStorage.setItem(`hraizn:widgetThread:${BASE}`, '{not json');
    expect(readStoredWidgetThread(BASE)).toBeUndefined();

    localStorage.setItem(
      `hraizn:widgetThread:${BASE}`,
      JSON.stringify({ id: '../thread', savedAt: Date.now() })
    );
    expect(readStoredWidgetThread(BASE)).toBeUndefined();
  });

  it('never stores ids that are not thread ids', () => {
    storeWidgetThread(BASE, 'javascript:alert(1)');

    expect(localStorage.length).toBe(0);
  });

  it('clears the entry', () => {
    storeWidgetThread(BASE, THREAD);
    clearStoredWidgetThread(BASE);

    expect(readStoredWidgetThread(BASE)).toBeUndefined();
  });

  it('recognises an explicit new conversation', () => {
    expect(isNewWidgetThreadRequested('?hraiznThread=new')).toBe(true);
    expect(isNewWidgetThreadRequested('?hraiznThread=other')).toBe(false);
    expect(isNewWidgetThreadRequested('')).toBe(false);
  });

  it('treats only backend resume rejections as reasons to forget the thread', () => {
    expect(isResumeRejection(new Error('thread not found'))).toBe(true);
    expect(isResumeRejection(new Error('authorization failed'))).toBe(true);
    expect(isResumeRejection(new Error('xhr poll error'))).toBe(false);
    expect(isResumeRejection('thread not found')).toBe(false);
  });

  it('keeps the widget control parameter out of the chat parameters', () => {
    expect(
      getChatParametersFromSearch(
        '?hraiznThread=new&hraiznHostOrigin=https://shop.example'
      )
    ).toEqual({ hraiznHostOrigin: 'https://shop.example' });
  });
});
