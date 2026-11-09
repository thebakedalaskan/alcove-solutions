import { type DirectMessage } from '@alcove/api';
import { PrivateChatComposer, PrivateMessage } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Box, did } from '../../../src/component';
import { PRIYA } from '../../../src/world/people';

const message: DirectMessage = { id: 'private-demo-message', from: 'me', to: 'priya', place: 'main', generation: 0, text: 'Two minutes left for your section.', at: 75, order: 1, state: 'delivered', error: null };
const meta = { title: 'Components/In a call/Private chat', component: PrivateMessage,
  args: { message, person: PRIYA, mine: true, time: '01:15', onRetry: did('retry privately') },
  render: (args) => <Box width="min(360px, 100%)" height="auto"><PrivateMessage {...args} /></Box>
} satisfies Meta<typeof PrivateMessage>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Delivered: Story = {};
export const Received: Story = { args: { mine: false, message: { ...message, from: 'priya', to: 'me', text: 'Could you keep an eye on the time?' } } };
export const Sending: Story = { args: { message: { ...message, state: 'sending' } } };
export const Sent: Story = { args: { message: { ...message, state: 'sent' } } };
export const Failed: Story = { args: { message: { ...message, state: 'failed', error: 'This message wasn’t confirmed. Retry sends it only to the same person.' } } };
function ComposerDemo({ available }: { available: boolean }) {
  const [text, setText] = useState('Two minutes left for your section.');
  return <Box width="min(360px, 100%)" height="auto"><PrivateChatComposer name={PRIYA.name} value={text} available={available} onChange={setText} onSend={() => setText('')} /></Box>;
}
export const Composer: Story = { render: () => <ComposerDemo available /> };
export const Unavailable: Story = { render: () => <ComposerDemo available={false} /> };
