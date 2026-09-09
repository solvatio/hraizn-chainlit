import { render, screen } from '@testing-library/react';
import ReactMarkdown from 'react-markdown';
import remarkDirective from 'remark-directive';
import { expect, it } from 'vitest';

import {
  MarkdownProductCard,
  productCardComponents
} from 'components/MarkdownProductCard';

const ProductMarkdown = ({ children }: { children: string }) => (
  <ReactMarkdown
    remarkPlugins={[remarkDirective, MarkdownProductCard]}
    components={productCardComponents as any}
  >
    {children}
  </ReactMarkdown>
);

it('renders a product directive as a product card', () => {
  const markdown =
    ':::product\n{ "productNumber": "123", "image": "https://example.com/sneaker.jpg", "title": "Super Sneaker 3000", "description": "Leichter Alltagssneaker mit atmungsaktivem Obermaterial.", "actions": [{"label": "open product", "href":"#navigation.goto?foo=bar"}] }\n:::';

  const { container } = render(<ProductMarkdown>{markdown}</ProductMarkdown>);

  expect(screen.getByText('Super Sneaker 3000')).toBeInTheDocument();
  expect(
    screen.getByText('Leichter Alltagssneaker mit atmungsaktivem Obermaterial.')
  ).toBeInTheDocument();
  expect(
    screen.getByRole('img', { name: 'Super Sneaker 3000' })
  ).toHaveAttribute('src', 'https://example.com/sneaker.jpg');
  expect(screen.getByRole('link', { name: 'open product' })).toHaveAttribute(
    'href',
    '#navigation.goto?foo=bar'
  );
  expect(
    container.querySelector('[data-product-number="123"]')
  ).toBeInTheDocument();
});

it('accepts the missing quote in the example actions property', () => {
  const markdown =
    ':::product\n{ "productNumber": "123", "title": "Sneaker", "actions: [{"label": "open product", "href":"#product"}] }\n:::';

  render(<ProductMarkdown>{markdown}</ProductMarkdown>);

  expect(screen.getByRole('link', { name: 'open product' })).toHaveAttribute(
    'href',
    '#product'
  );
});

it('does not render unsafe product links', () => {
  const markdown =
    ':::product\n{ "title": "Sneaker", "image": "javascript:alert(1)", "actions": [{"label": "unsafe", "href":"javascript:alert(1)"}] }\n:::';

  render(<ProductMarkdown>{markdown}</ProductMarkdown>);

  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('link', { name: 'unsafe' })
  ).not.toBeInTheDocument();
});

it.each([null, ''])('does not reserve image space for image %s', (image) => {
  const markdown = `:::product\n${JSON.stringify({
    productNumber: 'without-image',
    title: 'Sneaker',
    image
  })}\n:::`;

  const { container } = render(<ProductMarkdown>{markdown}</ProductMarkdown>);
  const card = container.querySelector('[data-product-number="without-image"]');

  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(card?.children).toHaveLength(1);
});
