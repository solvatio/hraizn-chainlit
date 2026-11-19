import { cn } from '@/lib/utils';

import { IAudioElement } from '@chainlit/react-client';

import { useSessionFileUrl } from '@/hooks/useSessionFileUrl';

const AudioElement = ({ element }: { element: IAudioElement }) => {
  const url = useSessionFileUrl(element.url);

  if (!url) {
    return null;
  }

  return (
    <div className={cn('space-y-2', `${element.display}-audio`)}>
      <p className="text-sm leading-7 text-muted-foreground">{element.name}</p>
      <audio controls src={url} autoPlay={element.autoPlay} />
    </div>
  );
};

export { AudioElement };
