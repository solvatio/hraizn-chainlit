import { cn } from '@/lib/utils';
import { omit } from 'lodash';
import { useContext, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { PluggableList } from 'react-markdown/lib';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { visit } from 'unist-util-visit';

import {
  ChainlitContext,
  type IMessageElement,
  useConfig
} from '@chainlit/react-client';

import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';

import BlinkingCursor from './BlinkingCursor';
import CodeSnippet from './CodeSnippet';
import { ElementRef } from './Elements/ElementRef';
import { MarkdownImage } from './MarkdownImage';
import {
  type AlertProps,
  MarkdownAlert,
  alertComponents,
  normalizeAlertType
} from './MarkdownAlert';
import {
  MarkdownProductCard,
  productCardComponents
} from './MarkdownProductCard';

interface Props {
  allowHtml?: boolean;
  latex?: boolean;
  refElements?: IMessageElement[];
  children: string;
  className?: string;
}

const cursorPlugin = () => {
  return (tree: any) => {
    visit(tree, 'text', (node: any, index, parent) => {
      const placeholderPattern = /\u200B/g;
      const matches = [...(node.value?.matchAll(placeholderPattern) || [])];

      if (matches.length > 0) {
        const newNodes: any[] = [];
        let lastIndex = 0;

        matches.forEach((match) => {
          const [fullMatch] = match;
          const startIndex = match.index!;
          const endIndex = startIndex + fullMatch.length;

          if (startIndex > lastIndex) {
            newNodes.push({
              type: 'text',
              value: node.value!.slice(lastIndex, startIndex)
            });
          }

          newNodes.push({
            type: 'blinkingCursor',
            data: {
              hName: 'blinkingCursor',
              hProperties: { text: 'Blinking Cursor' }
            }
          });

          lastIndex = endIndex;
        });

        if (lastIndex < node.value!.length) {
          newNodes.push({
            type: 'text',
            value: node.value!.slice(lastIndex)
          });
        }

        parent!.children.splice(index, 1, ...newNodes);
      }
    });
  };
};

const Markdown = ({
  allowHtml,
  latex,
  refElements,
  className,
  children
}: Props) => {
  const apiClient = useContext(ChainlitContext);
  const { config } = useConfig();
  const isWidget = config?.widget === true;

  const rehypePlugins = useMemo(() => {
    let rehypePlugins: PluggableList = [];
    if (allowHtml) {
      rehypePlugins = [rehypeRaw as any, ...rehypePlugins];
    }
    if (latex) {
      rehypePlugins = [rehypeKatex as any, ...rehypePlugins];
    }
    return rehypePlugins;
  }, [allowHtml, latex]);

  const remarkPlugins = useMemo(() => {
    let remarkPlugins: PluggableList = [
      cursorPlugin,
      remarkGfm as any,
      remarkDirective as any,
      MarkdownProductCard,
      MarkdownAlert
    ];

    if (latex) {
      remarkPlugins = [...remarkPlugins, remarkMath as any];
    }
    return remarkPlugins;
  }, [latex]);

  return (
    <ReactMarkdown
      className={cn(
        'prose text-inherit',
        isWidget
          ? 'prose-sm md:prose max-w-none leading-5'
          : 'prose-sm max-w-none',
        className
      )}
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={{
        ...alertComponents, // add alert components
        ...productCardComponents,
        code(props) {
          return (
            <code
              {...omit(props, ['node'])}
              className="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold"
            />
          );
        },
        pre({ children, ...props }: any) {
          return <CodeSnippet {...props} />;
        },
        a({ children, ...props }) {
          const name = children as string;
          const element = refElements?.find((e) => e.name === name);
          if (element) {
            return <ElementRef element={element} />;
          } else {
            return (
              <a
                {...props}
                className="text-primary hover:underline"
                target="_blank"
              >
                {children}
              </a>
            );
          }
        },
        img: (image: any) => {
          if (!image.src) return null;

          const src = image.src.startsWith('/public')
            ? apiClient.buildEndpoint(image.src)
            : image.src;

          return (
            <MarkdownImage
              src={src}
              alt={image.alt}
              title={image.title}
            />
          );
        },
        blockquote(props) {
          return (
            <blockquote
              {...omit(props, ['node'])}
              className="mt-6 border-l-2 pl-6 italic"
            />
          );
        },
        em(props) {
          return <span {...omit(props, ['node'])} className="italic" />;
        },
        strong(props) {
          return <span {...omit(props, ['node'])} className="font-bold" />;
        },
        hr() {
          return <Separator />;
        },
        ul(props) {
          return (
            <ul
              {...omit(props, ['node'])}
              className={cn(
                'my-3 ml-3 list-disc pl-2 [&>li::marker]:text-inherit',
                isWidget
                  ? '[&>li]:my-0 [&>li]:leading-5'
                  : '[&>li]:mt-1'
              )}
            />
          );
        },
        ol(props) {
          return (
            <ol
              {...omit(props, ['node'])}
              className={cn(
                'my-3 ml-3 list-decimal pl-2 [&>li::marker]:text-inherit',
                isWidget
                  ? '[&>li]:my-0 [&>li]:leading-5'
                  : '[&>li]:mt-1'
              )}
            />
          );
        },
        h1(props) {
          return (
            <h1
              {...omit(props, ['node'])}
              className="scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl mt-8 first:mt-0"
            />
          );
        },
        h2(props) {
          return (
            <h2
              {...omit(props, ['node'])}
              className="scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight mt-8 first:mt-0"
            />
          );
        },
        h3(props) {
          return (
            <h3
              {...omit(props, ['node'])}
              className="scroll-m-20 text-2xl font-semibold tracking-tight mt-6 first:mt-0"
            />
          );
        },
        h4(props) {
          return (
            <h4
              {...omit(props, ['node'])}
              className="scroll-m-20 text-xl font-semibold tracking-tight mt-6 first:mt-0"
            />
          );
        },
        p(props) {
          return (
            <div
              {...omit(props, ['node'])}
              className={cn(
                '[&:not(:first-child)]:mt-4 break-words',
                isWidget ? 'leading-5' : 'leading-7'
              )}
              role="article"
            />
          );
        },
        table({ children, ...props }) {
          return (
            <Card className="[&:not(:first-child)]:mt-2 [&:not(:last-child)]:mb-2">
              <Table {...(props as any)}>{children}</Table>
            </Card>
          );
        },
        thead({ children, ...props }) {
          return <TableHeader {...(props as any)}>{children}</TableHeader>;
        },
        tr({ children, ...props }) {
          return <TableRow {...(props as any)}>{children}</TableRow>;
        },
        th({ children, ...props }) {
          return <TableHead {...(props as any)}>{children}</TableHead>;
        },
        td({ children, ...props }) {
          return <TableCell {...(props as any)}>{children}</TableCell>;
        },
        tbody({ children, ...props }) {
          return <TableBody {...(props as any)}>{children}</TableBody>;
        },
        // @ts-expect-error custom plugin
        blinkingCursor: () => <BlinkingCursor whitespace />,
        alert: ({
          type,
          children,
          ...props
        }: AlertProps & { type?: string }) => {
          const alertType = normalizeAlertType(type || props.variant || 'info');
          return alertComponents.Alert({ variant: alertType, children });
        }
      }}
    >
      {children}
    </ReactMarkdown>
  );
};

export { Markdown };
