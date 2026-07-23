import type { IMessageElement, IStep } from '@chainlit/react-client';

import { Loader } from '@/components/Loader';

import { MessageContent } from './Content';

interface Props {
  message: IStep;
  elements: IMessageElement[];
  allowHtml?: boolean;
  latex?: boolean;
}

const ProgressMessage = ({ message, elements, allowHtml, latex }: Props) => {
  return (
    <div
      className="flex min-w-[150px] flex-grow items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3"
      role="status"
      aria-live="polite"
      data-progress-message
    >
      <Loader className="size-4 shrink-0" />

      <div className="min-w-0 flex-1">
        <MessageContent
          elements={elements}
          message={message}
          allowHtml={allowHtml}
          latex={latex}
        />
      </div>
    </div>
  );
};

export { ProgressMessage };
