import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState
} from 'react';
import { Camera, CameraOff, LoaderCircle, RotateCcw, X } from 'lucide-react';

import { useChatInteract, useConfig } from '@chainlit/react-client';

import { IAttachment } from '@/state/chat';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';

export interface WebcamButtonMethods {
  captureAndUpload: () => Promise<IAttachment | null>;
}

interface Props {
  disabled?: boolean;
  onError: (error: string) => void;
  onBusyChange?: (busy: boolean) => void;
  onEnabledChange?: (enabled: boolean) => void;
}

interface PreviewPosition {
  x: number;
  y: number;
}

const DEFAULT_PREVIEW_WIDTH = 140;
const DEFAULT_PREVIEW_HEIGHT = 105;
const PREVIEW_MARGIN = 16;

let persistedStream: MediaStream | null = null;
let persistedPreviewPosition: PreviewPosition | null = null;

const WebcamButton = forwardRef<WebcamButtonMethods, Props>(
  ({ disabled, onError, onBusyChange, onEnabledChange }, ref) => {
    const { config } = useConfig();
    const { uploadFile } = useChatInteract();
    const videoRef = useRef<HTMLVideoElement>(null);
    const previewRef = useRef<HTMLDivElement>(null);
    const buttonAnchorRef = useRef<HTMLDivElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const dragStateRef = useRef<{
      pointerId: number;
      offsetX: number;
      offsetY: number;
    } | null>(null);

    const [isEnabled, setIsEnabled] = useState(!!persistedStream);
    const [isRequesting, setIsRequesting] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [previewPosition, setPreviewPosition] = useState<PreviewPosition | null>(
      persistedPreviewPosition
    );

    const isFeatureEnabled = !!config?.features?.webcam?.enabled;
    const isBusy = isRequesting || isUploading;

    useEffect(() => {
      onBusyChange?.(isBusy);
    }, [isBusy, onBusyChange]);

    useEffect(() => {
      onEnabledChange?.(isEnabled);
    }, [isEnabled, onEnabledChange]);

    const clampPosition = useCallback(
      (position: PreviewPosition, width: number, height: number) => {
        const maxX = Math.max(PREVIEW_MARGIN, window.innerWidth - width - PREVIEW_MARGIN);
        const maxY = Math.max(PREVIEW_MARGIN, window.innerHeight - height - PREVIEW_MARGIN);

        return {
          x: Math.min(Math.max(position.x, PREVIEW_MARGIN), maxX),
          y: Math.min(Math.max(position.y, PREVIEW_MARGIN), maxY)
        };
      },
      []
    );

    const getPreviewSize = useCallback(() => {
      const rect = previewRef.current?.getBoundingClientRect();

      return {
        width: rect?.width ?? DEFAULT_PREVIEW_WIDTH,
        height: rect?.height ?? DEFAULT_PREVIEW_HEIGHT
      };
    }, []);

    const getDefaultPreviewPosition = useCallback(() => {
      const { width, height } = getPreviewSize();
      const anchorRect = buttonAnchorRef.current?.getBoundingClientRect();
      const composerRect = document
        .getElementById('message-composer')
        ?.getBoundingClientRect();
      const fallbackX = window.innerWidth - width - PREVIEW_MARGIN;
      const fallbackY = window.innerHeight - height - 96;

      return clampPosition(
        {
          x: composerRect
            ? composerRect.right - width
            : anchorRect
              ? anchorRect.right - width
              : fallbackX,
          y: anchorRect ? anchorRect.top - height - 12 : fallbackY
        },
        width,
        height
      );
    }, [clampPosition, getPreviewSize]);

    const positionPreviewNearButton = useCallback(() => {
      if (persistedPreviewPosition) {
        setPreviewPosition(persistedPreviewPosition);
        return;
      }

      const nextPosition = getDefaultPreviewPosition();

      persistedPreviewPosition = nextPosition;
      setPreviewPosition(nextPosition);
    }, [getDefaultPreviewPosition]);

    const resetPreviewPosition = useCallback(() => {
      const nextPosition = getDefaultPreviewPosition();
      persistedPreviewPosition = nextPosition;
      setPreviewPosition(nextPosition);
    }, [getDefaultPreviewPosition]);

    const syncVideoPreview = useCallback(async () => {
      const video = videoRef.current;
      const stream = streamRef.current;

      if (!video || !stream) {
        return;
      }

      if (video.srcObject !== stream) {
        video.srcObject = stream;
      }

      await video.play().catch(() => undefined);
    }, []);

    const stopStream = useCallback(() => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      persistedStream = null;
      setIsEnabled(false);

      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    }, []);

    const startStream = useCallback(async () => {
      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        onError('Webcam is not supported in this browser.');
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

      if (!previewPosition) {
        positionPreviewNearButton();
      }

      void syncVideoPreview();
    }, [isEnabled, positionPreviewNearButton, previewPosition, syncVideoPreview]);

    useLayoutEffect(() => {
      if (!isEnabled || !previewPosition) {
        return;
      }

      const { width, height } = getPreviewSize();
      const nextPosition = clampPosition(previewPosition, width, height);

      if (
        nextPosition.x !== previewPosition.x ||
        nextPosition.y !== previewPosition.y
      ) {
        persistedPreviewPosition = nextPosition;
        setPreviewPosition(nextPosition);
      }
    }, [clampPosition, getPreviewSize, isEnabled, previewPosition]);

    useEffect(() => {
      const handleWindowResize = () => {
        if (!persistedPreviewPosition) {
          return;
        }

        const { width, height } = getPreviewSize();
        const nextPosition = clampPosition(
          persistedPreviewPosition,
          width,
          height
        );

        persistedPreviewPosition = nextPosition;
        setPreviewPosition(nextPosition);
      };

      window.addEventListener('resize', handleWindowResize);

      return () => {
        window.removeEventListener('resize', handleWindowResize);
      };
    }, [clampPosition, getPreviewSize]);

    const toggleStream = useCallback(() => {
      if (streamRef.current) {
        stopStream();
        return;
      }

      void startStream();
    }, [startStream, stopStream]);

    const handleDragStart = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        const rect = previewRef.current?.getBoundingClientRect();

        if (!rect) {
          return;
        }

        dragStateRef.current = {
          pointerId: event.pointerId,
          offsetX: event.clientX - rect.left,
          offsetY: event.clientY - rect.top
        };

        event.currentTarget.setPointerCapture(event.pointerId);
      },
      []
    );

    const handleDragMove = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        const dragState = dragStateRef.current;

        if (!dragState || dragState.pointerId !== event.pointerId) {
          return;
        }

        const { width, height } = getPreviewSize();
        const nextPosition = clampPosition(
          {
            x: event.clientX - dragState.offsetX,
            y: event.clientY - dragState.offsetY
          },
          width,
          height
        );

        persistedPreviewPosition = nextPosition;
        setPreviewPosition(nextPosition);
      },
      [clampPosition, getPreviewSize]
    );

    const handleDragEnd = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        if (dragStateRef.current?.pointerId === event.pointerId) {
          dragStateRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      },
      []
    );

    const waitForFrame = useCallback(async () => {
      const video = videoRef.current;

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
    }, []);

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

    useEffect(() => {
      const handleBeforeUnload = () => {
        persistedStream?.getTracks().forEach((track) => track.stop());
        persistedStream = null;
      };

      window.addEventListener('beforeunload', handleBeforeUnload);

      return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);

        if (videoRef.current) {
          videoRef.current.srcObject = null;
        }
      };
    }, []);

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
        }
      }),
      [captureBlob, isFeatureEnabled, onError, uploadFile]
    );

    if (!isFeatureEnabled) {
      return null;
    }

    return (
      <TooltipProvider>
        <div className="relative flex items-center">
          {isEnabled && previewPosition ? (
            <div
              ref={previewRef}
              className="fixed z-50"
              style={{
                left: previewPosition.x,
                top: previewPosition.y
              }}
            >
              <div className="relative h-[83px] w-[110px] min-h-[75px] min-w-[100px] max-h-[160px] max-w-[210px] resize overflow-hidden rounded-2xl border border-border bg-background shadow-xl sm:h-[105px] sm:w-[140px]">
                <div
                  className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/55 to-transparent px-3 py-2 text-xs font-medium text-white"
                >
                  <div
                    className="flex min-w-0 flex-1 cursor-move items-center"
                    onPointerDown={handleDragStart}
                    onPointerMove={handleDragMove}
                    onPointerUp={handleDragEnd}
                    onPointerCancel={handleDragEnd}
                  >
                    <span>Webcam</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className="h-8 w-8 rounded-full bg-background/90 text-foreground shadow-sm backdrop-blur hover:bg-background"
                      onClick={(event) => {
                        event.stopPropagation();
                        resetPreviewPosition();
                      }}
                    >
                      <RotateCcw className="!size-4" />
                    </Button>
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
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="h-full w-full bg-black object-cover"
                />
              </div>
            </div>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                ref={buttonAnchorRef}
                className="relative flex items-center"
              >
                <Button
                  type="button"
                  disabled={disabled || isBusy}
                  variant="ghost"
                  size="icon"
                  className="hover:bg-muted"
                  onClick={toggleStream}
                >
                  {isBusy ? <LoaderCircle className="!size-5 animate-spin" /> : null}
                  {!isBusy && isEnabled ? <CameraOff className="!size-5" /> : null}
                  {!isBusy && !isEnabled ? <Camera className="!size-5" /> : null}
                </Button>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isEnabled ? 'Disable webcam' : 'Enable webcam'}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    );
  }
);

WebcamButton.displayName = 'WebcamButton';

export default WebcamButton;
