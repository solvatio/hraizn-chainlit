import getRouterBasename from '@/lib/router';
import {
  clearStoredWidgetThread,
  isNewWidgetThreadRequested,
  isResumeRejection,
  readStoredWidgetThread,
  storeWidgetThread
} from '@/lib/widgetThread';
import { useEffect, useRef, useState } from 'react';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';

import {
  currentThreadIdState,
  resumeThreadErrorState,
  threadIdToResumeState,
  useChatSession,
  useConfig
} from '@chainlit/react-client';

/**
 * Resumes the last conversation of an embedded widget after the host page
 * reloaded the chat iframe (e.g. a full navigation between two areas of the same
 * host site). Returns false until the resume decision is made, so the first
 * socket connection already carries the thread id.
 */
export const useWidgetThreadResume = (): boolean => {
  const { config } = useConfig();
  const { session } = useChatSession();
  const [idToResume, setIdToResume] = useRecoilState(threadIdToResumeState);
  const currentThreadId = useRecoilValue(currentThreadIdState);
  const setResumeThreadError = useSetRecoilState(resumeThreadErrorState);
  const resumeThreadError = useRecoilValue(resumeThreadErrorState);
  const [ready, setReady] = useState(false);
  const previousThreadId = useRef<string | undefined>(undefined);
  const basename = getRouterBasename();

  const enabled = Boolean(
    config?.widget && config?.threadResumable && config?.dataPersistence
  );

  // Decide once, as soon as the configuration is known.
  useEffect(() => {
    if (!config || ready) return;
    if (enabled) {
      if (isNewWidgetThreadRequested(window.location.search)) {
        clearStoredWidgetThread(basename);
      } else {
        const storedThreadId = readStoredWidgetThread(basename);
        if (storedThreadId) setIdToResume(storedThreadId);
      }
    }
    setReady(true);
  }, [config, enabled, ready, basename, setIdToResume]);

  // Follow the active thread: new or resumed threads are stored, an explicit
  // new chat (which resets the current thread) removes the entry.
  useEffect(() => {
    if (!enabled || !ready) return;
    if (currentThreadId) {
      storeWidgetThread(basename, currentThreadId);
    } else if (previousThreadId.current) {
      clearStoredWidgetThread(basename);
    }
    previousThreadId.current = currentThreadId;
  }, [enabled, ready, currentThreadId, basename]);

  // A thread that no longer exists or belongs to another identity: forget it
  // and connect once more without a thread. Network errors keep the entry.
  useEffect(() => {
    const socket = session?.socket;
    if (!enabled || !socket || !idToResume) return;
    const onConnectError = (error: unknown) => {
      if (!isResumeRejection(error)) return;
      clearStoredWidgetThread(basename);
      setIdToResume(undefined);
    };
    socket.on('connect_error', onConnectError);
    return () => {
      socket.off('connect_error', onConnectError);
    };
  }, [enabled, session, idToResume, basename, setIdToResume]);

  useEffect(() => {
    if (!enabled || !resumeThreadError) return;
    clearStoredWidgetThread(basename);
    setResumeThreadError(undefined);
  }, [enabled, resumeThreadError, basename, setResumeThreadError]);

  return ready;
};
