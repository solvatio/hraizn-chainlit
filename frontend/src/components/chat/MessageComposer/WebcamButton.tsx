import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react';
import { Camera, CameraOff, LoaderCircle } from 'lucide-react';

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

const WebcamButton = forwardRef<WebcamButtonMethods, Props>(
  ({ disabled, onError, onBusyChange, onEnabledChange }, ref) => {
    const { config } = useConfig();
    const { uploadFile } = useChatInteract();
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const [isEnabled, setIsEnabled] = useState(false);
    const [isRequesting, setIsRequesting] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    const isFeatureEnabled = !!config?.features?.webcam?.enabled;
    const isBusy = isRequesting || isUploading;

    useEffect(() => {
      onBusyChange?.(isBusy);
    }, [isBusy, onBusyChange]);

    useEffect(() => {
      onEnabledChange?.(isEnabled);
    }, [isEnabled, onEnabledChange]);

    const stopStream = useCallback(() => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setIsEnabled(false);

      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    }, []);

    useEffect(() => stopStream, [stopStream]);

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
        setIsEnabled(true);

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
      } catch (error) {
        onError(
          error instanceof Error
            ? error.message
            : 'Unable to access the webcam.'
        );
      } finally {
        setIsRequesting(false);
      }
    }, [onError]);

    const toggleStream = useCallback(() => {
      if (streamRef.current) {
        stopStream();
        return;
      }

      void startStream();
    }, [startStream, stopStream]);

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
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2">
              {isEnabled ? (
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="h-8 w-10 rounded-md object-cover bg-black"
                />
              ) : (
                <video ref={videoRef} muted playsInline className="hidden" />
              )}
              <Button
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
      </TooltipProvider>
    );
  }
);

WebcamButton.displayName = 'WebcamButton';

export default WebcamButton;
