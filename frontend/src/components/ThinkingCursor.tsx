import { cn } from '@/lib/utils';

interface Props {
  src: string;
  whitespace?: boolean;
}

export default function ThinkingCursor({ src, whitespace }: Props) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn(
        'h-5 w-5 shrink-0 object-contain animate-pulse',
        whitespace && 'ml-2'
      )}
    />
  );
}
