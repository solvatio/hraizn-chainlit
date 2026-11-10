import { type IFileElement } from '@chainlit/react-client';

import { useSessionFileUrl } from '@/hooks/useSessionFileUrl';

import { Attachment } from '@/components/chat/MessageComposer/Attachment';

const FileElement = ({ element }: { element: IFileElement }) => {
  const url = useSessionFileUrl(element.url);

  if (!url) {
    return null;
  }

  return (
    <a
      className={`${element.display}-file no-underline`}
      download={element.name}
      href={url}
      target="_blank"
    >
      <Attachment name={element.name} mime={element.mime!} />
    </a>
  );
};

export { FileElement };
