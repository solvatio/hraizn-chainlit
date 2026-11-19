import { type IPdfElement } from 'client-types/';

import { useSessionFileUrl } from '@/hooks/useSessionFileUrl';

interface Props {
  element: IPdfElement;
}

const PDFElement = ({ element }: Props) => {
  const fileUrl = useSessionFileUrl(element.url);

  if (!fileUrl) {
    return null;
  }
  const url = element.page ? `${fileUrl}#page=${element.page}` : fileUrl;
  return (
    <iframe
      className={`${element.display}-pdf h-full w-full border-none`}
      src={url}
    ></iframe>
  );
};

export { PDFElement };
