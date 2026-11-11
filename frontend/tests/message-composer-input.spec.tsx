import { render, screen } from '@testing-library/react';
import { RecoilRoot } from 'recoil';
import { expect, it, vi } from 'vitest';

import Input from '@/components/chat/MessageComposer/Input';

vi.mock('@chainlit/react-client', async () => {
  const { atom } = await import('recoil');

  return {
    commandsState: atom({
      key: 'message-composer-input-test-commands',
      default: []
    })
  };
});

it('applies the configured character limit to the message input', () => {
  render(
    <RecoilRoot>
      <Input
        maxLength={42}
        setSelectedCommand={vi.fn()}
        onChange={vi.fn()}
      />
    </RecoilRoot>
  );

  expect(screen.getByRole('textbox')).toHaveAttribute('maxLength', '42');
});
