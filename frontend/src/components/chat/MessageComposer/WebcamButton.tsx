import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState
} from 'react';
import { Camera, CameraOff, CameraIcon, LoaderCircle, X } from 'lucide-react';

import { useChatInteract, useConfig } from '@chainlit/react-client';
import { useSetRecoilState } from 'recoil';
import { v4 as uuidv4 } from 'uuid';

import { Translator } from '@/components/i18n';
import { IAttachment, attachmentsState } from '@/state/chat';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';

export interface WebcamButtonMethods {
  captureAndUpload: () => Promise<IAttachment | null>;
  toggleStream: () => void;
  disableStream: () => void;
}

interface WebcamToggleButtonProps {
  disabled?: boolean;
  isBusy?: boolean;
  isEnabled?: boolean;
  onClick?: () => void;
}

interface Props {
  disabled?: boolean;
  hideTrigger?: boolean;
  onError: (error: string) => void;
  onAvailabilityChange?: (available: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  onEnabledChange?: (enabled: boolean) => void;
}

let persistedStream: MediaStream | null = null;

interface DocumentWithFeaturePolicy extends Document {
  featurePolicy?: {
    allowsFeature?: (feature: string) => boolean;
  };
}

const isWebcamAvailable = () => {
  if (
    typeof window === 'undefined' ||
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    return false;
  }

  const featurePolicy = (document as DocumentWithFeaturePolicy).featurePolicy;

  if (featurePolicy?.allowsFeature) {
    return featurePolicy.allowsFeature('camera');
  }

  return true;
};

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('Unable to generate image preview.'));
    };

    reader.onerror = () => {
      reject(reader.error ?? new Error('Unable to generate image preview.'));
    };

    reader.readAsDataURL(file);
  });

export const WebcamToggleButton = ({
  disabled,
  isBusy = false,
  isEnabled = false,
  onClick
}: WebcamToggleButtonProps) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          disabled={disabled || isBusy}
          variant="ghost"
          size="icon"
          className="hover:bg-foreground/10 hover:text-current"
          onClick={onClick}
          aria-label={isEnabled ? 'Disable webcam' : 'Enable webcam'}
        >
          {isBusy ? <LoaderCircle className="!size-5 animate-spin" /> : null}
          {!isBusy && isEnabled ? <CameraOff className="!size-5" /> : null}
          {!isBusy && !isEnabled ? <Camera className="!size-5" /> : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>
          {isEnabled ? (
            <Translator path="chat.input.actions.disableWebcam" />
          ) : (
            <Translator path="chat.input.actions.enableWebcam" />
          )}
        </p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

const WebcamButton = forwardRef<WebcamButtonMethods, Props>(
  (
    {
      disabled,
      hideTrigger = false,
      onError,
      onAvailabilityChange,
      onBusyChange,
      onEnabledChange
    },
    ref
  ) => {
    const { config } = useConfig();
    const { uploadFile } = useChatInteract();
    const setAttachments = useSetRecoilState(attachmentsState);
    const streamRef = useRef<MediaStream | null>(null);

    const [isEnabled, setIsEnabled] = useState(!!persistedStream);
    const [isAvailable, setIsAvailable] = useState(isWebcamAvailable);
    const [isRequesting, setIsRequesting] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [chatWidth, setChatWidth] = useState<number | null>(null);
    const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);

    const isFeatureEnabled = !!config?.features?.webcam?.enabled && isAvailable;
    const isBusy = isRequesting || isUploading;

    useEffect(() => {
      const available = isWebcamAvailable();

      setIsAvailable(available);
      onAvailabilityChange?.(available);
    }, [onAvailabilityChange]);

    useEffect(() => {
      onBusyChange?.(isBusy);
    }, [isBusy, onBusyChange]);

    useEffect(() => {
      onEnabledChange?.(isEnabled);
    }, [isEnabled, onEnabledChange]);

    const attachStreamToVideo = useCallback(
      async (video: HTMLVideoElement | null) => {
        const stream = streamRef.current;

        if (!video || !stream) {
          return;
        }

        if (video.srcObject !== stream) {
          video.srcObject = stream;
        }

        await video.play().catch(() => undefined);
      },
      []
    );

    const syncVideoPreview = useCallback(async () => {
      await attachStreamToVideo(videoElement);
    }, [attachStreamToVideo, videoElement]);

    const handleVideoRef = useCallback(
      (node: HTMLVideoElement | null) => {
        setVideoElement(node);

        if (node) {
          void attachStreamToVideo(node);
        }
      },
      [attachStreamToVideo]
    );

    const stopStream = useCallback(() => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      persistedStream = null;
      setIsEnabled(false);

      if (videoElement) {
        videoElement.srcObject = null;
      }
    }, [videoElement]);

    const startStream = useCallback(async () => {
      if (!isWebcamAvailable()) {
        onError('Webcam is unavailable in this browser or embedding context.');
        return;
      }

      setIsRequesting(true);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true
        });

        streamRef.current = stream;
        persistedStream = stream;
        setIsEnabled(true);
        await syncVideoPreview();
      } catch (error) {
        onError(
          error instanceof Error
            ? error.message
            : 'Unable to access the webcam.'
        );
      } finally {
        setIsRequesting(false);
      }
    }, [onError, syncVideoPreview]);

    useEffect(() => {
      if (persistedStream && !streamRef.current) {
        streamRef.current = persistedStream;
        setIsEnabled(true);
      }
    }, []);

    useEffect(() => {
      if (!isEnabled) {
        return;
      }

      void syncVideoPreview();
    }, [isEnabled, syncVideoPreview]);

    useLayoutEffect(() => {
      if (typeof window === 'undefined') {
        return;
      }

      const composer = document.getElementById('message-composer');

      if (!composer) {
        setChatWidth(null);
        return;
      }

      const syncChatWidth = () => {
        const nextWidth = Math.floor(composer.getBoundingClientRect().width);

        setChatWidth((currentWidth) =>
          currentWidth === nextWidth ? currentWidth : nextWidth
        );
      };

      syncChatWidth();

      if (typeof ResizeObserver === 'undefined') {
        window.addEventListener('resize', syncChatWidth);

        return () => {
          window.removeEventListener('resize', syncChatWidth);
        };
      }

      const observer = new ResizeObserver(() => {
        syncChatWidth();
      });

      observer.observe(composer);

      return () => {
        observer.disconnect();
      };
    }, []);

    const getModalWidth = useCallback(() => {
      if (typeof window === 'undefined') {
        return undefined;
      }

      const viewportWidth = Math.max(window.innerWidth - 32, 280);

      if (!chatWidth) {
        return viewportWidth;
      }

      return Math.min(chatWidth, viewportWidth);
    }, [chatWidth]);

    const handleDialogOpenChange = useCallback(
      (open: boolean) => {
        if (!open && streamRef.current) {
          stopStream();
          return;
        }
      },
      [stopStream]
    );

    const toggleStream = useCallback(() => {
      if (streamRef.current) {
        stopStream();
        return;
      }

      void startStream();
    }, [startStream, stopStream]);

    const waitForFrame = useCallback(async () => {
      const video = videoElement;

      if (!video) {
        throw new Error('Webcam preview is not ready.');
      }

      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth) {
        return video;
      }

      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          cleanup();
          reject(new Error('Webcam did not become ready in time.'));
        }, 2000);

        const cleanup = () => {
          window.clearTimeout(timeout);
          video.removeEventListener('loadeddata', onReady);
          video.removeEventListener('canplay', onReady);
        };

        const onReady = () => {
          cleanup();
          resolve();
        };

        video.addEventListener('loadeddata', onReady);
        video.addEventListener('canplay', onReady);
      });

      return video;
    }, [videoElement]);

    const captureBlob = useCallback(async () => {
      const video = await waitForFrame();
      const canvas = document.createElement('canvas');

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error('Unable to capture webcam frame.');
      }

      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => {
            if (!result) {
              reject(new Error('Unable to convert webcam frame to an image.'));
              return;
            }

            resolve(result);
          },
          'image/jpeg',
          0.92
        );
      });

      return blob;
    }, [waitForFrame]);

    const handleTakeSnapshot = useCallback(async () => {
      if (!streamRef.current || isBusy) {
        return;
      }

      setIsUploading(true);
      let attachmentId: string | null = null;

      try {
        const blob = await captureBlob();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const file = new File([blob], `webcam-${timestamp}.jpg`, {
          type: 'image/jpeg'
        });
        const currentAttachmentId = uuidv4();
        attachmentId = currentAttachmentId;
        const { xhr, promise } = uploadFile(file, (progress) => {
          setAttachments((prev) =>
            prev.map((attachment) =>
              attachment.id === currentAttachmentId
                ? { ...attachment, uploadProgress: progress }
                : attachment
            )
          );
        });

        stopStream();

        const removeAttachment = () => {
          setAttachments((prev) =>
            prev.filter((attachment) => attachment.id !== attachmentId)
          );
        };

        setAttachments((prev) =>
          prev.concat({
            id: currentAttachmentId,
            type: file.type,
            name: file.name,
            size: file.size,
            uploadProgress: 0,
            cancel: () => {
              xhr.abort();
              removeAttachment();
            },
            remove: removeAttachment
          })
        );

        void readFileAsDataUrl(file)
          .then((previewUrl) => {
            setAttachments((prev) =>
              prev.map((attachment) =>
                attachment.id === currentAttachmentId
                  ? { ...attachment, previewUrl }
                  : attachment
              )
            );
          })
          .catch(() => undefined);

        const result = await promise;

        setAttachments((prev) =>
          prev.map((attachment) =>
            attachment.id === currentAttachmentId
              ? {
                  ...attachment,
                  serverId: result.id,
                  uploaded: true,
                  uploadProgress: 100,
                  cancel: undefined
                }
              : attachment
          )
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to capture and upload a webcam screenshot.';

        if (attachmentId) {
          setAttachments((prev) =>
            prev.filter((attachment) => attachment.id !== attachmentId)
          );
        }
        onError(message);
      } finally {
        setIsUploading(false);
      }
    }, [captureBlob, isBusy, onError, setAttachments, stopStream, uploadFile]);

    useEffect(() => {
      const handleBeforeUnload = () => {
        persistedStream?.getTracks().forEach((track) => track.stop());
        persistedStream = null;
      };

      window.addEventListener('beforeunload', handleBeforeUnload);

      return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);

        if (videoElement) {
          videoElement.srcObject = null;
        }
      };
    }, [videoElement]);

    useImperativeHandle(
      ref,
      () => ({
        captureAndUpload: async () => {
          if (!isFeatureEnabled) {
            return null;
          }

          if (!streamRef.current) {
            return null;
          }

          setIsUploading(true);

          try {
            const blob = await captureBlob();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const file = new File([blob], `webcam-${timestamp}.jpg`, {
              type: 'image/jpeg'
            });
            const { promise } = uploadFile(file, () => undefined);
            const result = await promise;

            return {
              id: result.id,
              serverId: result.id,
              name: file.name,
              size: file.size,
              type: file.type,
              uploaded: true,
              uploadProgress: 100
            };
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : 'Unable to capture and upload a webcam screenshot.';

            onError(message);
            throw error;
          } finally {
            setIsUploading(false);
          }
        },
        toggleStream,
        disableStream: stopStream
      }),
      [captureBlob, isFeatureEnabled, onError, stopStream, toggleStream, uploadFile]
    );

    if (!isFeatureEnabled) {
      return null;
    }

    return (
      <TooltipProvider>
        <div className="relative flex items-center">
          <Dialog open={isEnabled} onOpenChange={handleDialogOpenChange}>
            <DialogContent
              className="border border-border bg-background p-0 shadow-xl sm:rounded-2xl [&>button:last-child]:hidden"
              style={{ width: getModalWidth() }}
            >
              <DialogTitle className="sr-only">Webcam</DialogTitle>
              <div className="relative aspect-[4/3] min-h-[240px] overflow-hidden bg-black sm:rounded-2xl">
                <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/55 to-transparent px-3 py-2 text-xs font-medium text-white">
                  <div className="flex min-w-0 flex-1 items-center">
                    <span>Webcam</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon"
                          className="h-8 w-8 rounded-full bg-background/90 text-foreground shadow-sm backdrop-blur hover:bg-background"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleTakeSnapshot();
                          }}
                          aria-label="Take webcam screenshot"
                          disabled={isBusy}
                        >
                          <CameraIcon className="!size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          <Translator path="chat.input.actions.webcamScreenshot" />
                        </p>
                      </TooltipContent>
                    </Tooltip>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className="h-8 w-8 rounded-full bg-background/90 text-foreground shadow-sm backdrop-blur hover:bg-background"
                      onClick={(event) => {
                        event.stopPropagation();
                        stopStream();
                      }}
                    >
                      <X className="!size-4" />
                    </Button>
                  </div>
                </div>
                <video
                  ref={handleVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="h-full w-full bg-black object-cover"
                />
              </div>
            </DialogContent>
          </Dialog>
          <div
            className={hideTrigger ? 'pointer-events-none absolute opacity-0' : 'relative flex items-center'}
          >
            {!hideTrigger ? (
              <WebcamToggleButton
                disabled={disabled}
                isBusy={isBusy}
                isEnabled={isEnabled}
                onClick={toggleStream}
              />
            ) : null}
          </div>
        </div>
      </TooltipProvider>
    );
  }
);

WebcamButton.displayName = 'WebcamButton';

export default WebcamButton;
