import { cn } from '@/lib/utils';
import { useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { AspectRatio } from '@/components/ui/aspect-ratio';

interface Props {
  src: string;
  alt?: string;
  title?: string;
}

const MarkdownImage = ({ src, alt = '', title }: Props) => {
  const [open, setOpen] = useState(false);
  const [originalSize, setOriginalSize] = useState(false);
  const dialogTitle = alt || title || 'Image preview';

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);

    if (!nextOpen) {
      setOriginalSize(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="block w-full cursor-zoom-in rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:max-w-sm md:max-w-md"
          aria-label={`Open ${dialogTitle} in full screen`}
        >
          <AspectRatio
            ratio={16 / 9}
            className="overflow-hidden rounded-md bg-muted"
          >
            <img
              src={src}
              alt={alt}
              title={title}
              loading="lazy"
              className="h-full w-full object-contain"
            />
          </AspectRatio>
        </button>
      </DialogTrigger>

      <DialogContent className="block h-screen max-h-none w-screen max-w-none overflow-auto rounded-none border-none bg-black/90 p-0 shadow-none sm:rounded-none [&>button]:fixed [&>button]:right-4 [&>button]:top-4 [&>button]:z-[60] [&>button]:bg-black/60 [&>button]:p-2 [&>button]:text-white [&>button]:opacity-100 [&>button:hover]:bg-black/80">
        <DialogTitle className="sr-only">{dialogTitle}</DialogTitle>
        <div
          className={cn(
            'grid min-h-full min-w-full place-items-center p-8',
            originalSize && 'h-max w-max'
          )}
        >
          <button
            type="button"
            onClick={() => setOriginalSize((current) => !current)}
            className={cn(
              'block border-0 bg-transparent p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-white',
              originalSize ? 'cursor-zoom-out' : 'cursor-zoom-in'
            )}
            aria-label={
              originalSize
                ? 'Fit image to screen'
                : 'Show image at original size'
            }
          >
            <img
              src={src}
              alt={alt}
              title={title}
              className={cn(
                'block h-auto',
                originalSize
                  ? 'max-w-none'
                  : 'max-h-[calc(100vh-4rem)] max-w-[calc(100vw-4rem)] object-contain'
              )}
            />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export { MarkdownImage };
