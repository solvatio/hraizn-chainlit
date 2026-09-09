import { visit } from 'unist-util-visit';

import { Card } from '@/components/ui/card';

interface ProductAction {
  label: string;
  href: string;
}

interface ProductData {
  productNumber?: string;
  image?: string;
  title: string;
  description?: string;
  actions: ProductAction[];
}

interface ProductCardProps {
  product?: string;
}

const productBlockPattern = /^\s*:::product\s+(\{[\s\S]*\})\s*:::\s*$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSafeHref = (href: string) => {
  const normalizedHref = href.trim();

  if (normalizedHref.startsWith('#')) return true;
  if (normalizedHref.startsWith('/') && !normalizedHref.startsWith('//')) {
    return true;
  }

  try {
    const url = new URL(normalizedHref);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol);
  } catch {
    return false;
  }
};

const getImageUrl = (image: unknown) => {
  if (typeof image !== 'string') return undefined;

  const url = image.trim();
  if (!url) return undefined;

  if (url.startsWith('/') && !url.startsWith('//')) return url;

  try {
    return ['http:', 'https:'].includes(new URL(url).protocol)
      ? url
      : undefined;
  } catch {
    return undefined;
  }
};

const parseProduct = (payload: string): ProductData | undefined => {
  try {
    // Also accept the common typo `"actions: [...]` used in older prompts.
    const normalizedPayload = payload.replace(/"actions\s*:/, '"actions":');
    const parsed: unknown = JSON.parse(normalizedPayload);

    if (!isRecord(parsed) || typeof parsed.title !== 'string') {
      return undefined;
    }

    const actions = Array.isArray(parsed.actions)
      ? parsed.actions.flatMap((action): ProductAction[] => {
          if (
            !isRecord(action) ||
            typeof action.label !== 'string' ||
            typeof action.href !== 'string' ||
            !isSafeHref(action.href)
          ) {
            return [];
          }

          return [{ label: action.label, href: action.href }];
        })
      : [];

    return {
      productNumber:
        typeof parsed.productNumber === 'string' ||
        typeof parsed.productNumber === 'number'
          ? String(parsed.productNumber)
          : undefined,
      image: getImageUrl(parsed.image),
      title: parsed.title,
      description:
        typeof parsed.description === 'string' ? parsed.description : undefined,
      actions
    };
  } catch {
    return undefined;
  }
};

const ProductCard = ({ product }: ProductCardProps) => {
  if (!product) return null;

  const data = parseProduct(product);
  if (!data) return null;

  return (
    <Card
      className="my-4 flex min-h-36 w-full overflow-hidden bg-transparent text-inherit"
      data-product-number={data.productNumber}
    >
      {data.image ? (
        <div className="flex w-32 shrink-0 items-center justify-center p-3 sm:w-44">
          <img
            src={data.image}
            alt={data.title}
            loading="lazy"
            className="m-0 max-h-40 w-full object-contain"
          />
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col p-4">
        <div className="font-bold leading-6">{data.title}</div>

        {data.description ? (
          <div className="mt-2 text-sm leading-5 text-inherit">
            {data.description}
          </div>
        ) : null}

        {data.actions.length > 0 ? (
          <div className="mt-auto flex flex-wrap gap-x-4 gap-y-2 pt-4">
            {data.actions.map((action, index) => {
              const external = /^https?:\/\//i.test(action.href);

              return (
                <a
                  key={`${action.href}-${index}`}
                  href={action.href}
                  className="text-sm font-medium text-inherit underline-offset-4 hover:underline"
                  target={external ? '_blank' : undefined}
                  rel={external ? 'noopener noreferrer' : undefined}
                >
                  {action.label}
                </a>
              );
            })}
          </div>
        ) : null}
      </div>
    </Card>
  );
};

export const MarkdownProductCard = () => {
  return (tree: any, file: any) => {
    const source = String(file.value ?? '');

    visit(tree, 'containerDirective', (node: any) => {
      if (node.name !== 'product') return;

      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (typeof start !== 'number' || typeof end !== 'number') return;

      const match = source.slice(start, end).match(productBlockPattern);
      if (!match) return;

      const product = parseProduct(match[1]);
      if (!product) return;

      node.type = 'element';
      node.data = {
        hName: 'productCard',
        hProperties: { product: JSON.stringify(product) }
      };
      node.children = [];
    });
  };
};

export const productCardComponents = {
  productCard: ProductCard
};
