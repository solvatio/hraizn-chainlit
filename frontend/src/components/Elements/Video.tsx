import ReactPlayer from 'react-player';

import { type IVideoElement } from '@chainlit/react-client';

import { useSessionFileUrl } from '@/hooks/useSessionFileUrl';

const VideoElement = ({ element }: { element: IVideoElement }) => {
  const url = useSessionFileUrl(element.url);

  if (!url) {
    return null;
  }

  return (
    <ReactPlayer
      className={`${element.display}-video`}
      width="100%"
      controls
      url={url}
      config={element.playerConfig || {}}
    />
  );
};

export { VideoElement };
