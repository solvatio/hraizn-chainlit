import { cn } from '@/lib/utils';
import { MutableRefObject } from 'react';

import { FileSpec } from '@chainlit/react-client';

import WaterMark from '@/components/WaterMark';

import MessageComposer from './MessageComposer';

interface Props {
  fileSpec: FileSpec;
  onFileUpload: (payload: File[]) => void;
  onFileUploadError: (error: string) => void;
  autoScrollRef: MutableRefObject<boolean>;
  hasChatStarted: boolean;
}

export default function ChatFooter({ hasChatStarted, ...props }: Props) {
  if (!hasChatStarted) return null;

  return (
    <div className={cn('relative flex flex-col items-center gap-2 w-full')}>
      <MessageComposer {...props} />
      <WaterMark />
    </div>
  );
}
