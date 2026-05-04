import React from 'react';
import { DefaultExtensionType, FileIcon, defaultStyles } from 'react-file-icon';

import { Card } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';

interface AttachmentProps {
  name: string;
  mime: string;
  previewUrl?: string;
  children?: React.ReactNode;
}

const Attachment: React.FC<AttachmentProps> = ({
  name,
  mime,
  previewUrl,
  children
}) => {
  let extension: DefaultExtensionType;
  if (name.includes('.')) {
    extension = name.split('.').pop()!.toLowerCase() as DefaultExtensionType;
  } else {
    extension = mime
      ? ((mime.split('/').pop() || 'txt') as DefaultExtensionType)
      : ('txt' as DefaultExtensionType);
  }
  const isImage = mime.startsWith('image/');

  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative h-[58px]">
            {children}
            <Card className="h-full p-2 flex flex-row items-center gap-3 rounded-lg w-full max-w-[200px] border">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                {isImage && previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <FileIcon
                    {...defaultStyles[extension]}
                    extension={extension}
                  />
                )}
              </div>
              <span className="w-[80%] truncate text-sm font-medium">
                {name}
              </span>
            </Card>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{name}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export { Attachment };
