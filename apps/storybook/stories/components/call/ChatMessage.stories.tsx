import type { CallChatMessage } from '@alcove/api';
import { CallChatMessageView } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, did } from '../../../src/component';
import { PRIYA } from '../../../src/world/people';

const message: CallChatMessage = { id: 'chat-demo-message', from: 'priya', isMe: false, place: 'main', text: 'The status page is ready for review.', at: 75, thread: null, mentions: [], reactions: [], sending: false, failed: false };
const meta = { title: 'Components/In a call/Chat message', component: CallChatMessageView,
  args: { message, person: PRIYA, name: 'Priya', text: message.text, me: 'me', unreadMention: false, canReply: true, canRetry: true,
    canReact: true, reactions: [], threadSelected: false, replyCount: 3, unreadReplies: 2, privateMessage: false,
    onRetry: did('retry'), onReply: did('reply'), onOpenThread: did('open thread'), onReact: did('react') },
  render: (args) => <Box width="min(360px, 100%)" height="auto"><CallChatMessageView {...args} /></Box>
} satisfies Meta<typeof CallChatMessageView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Replies: Story = {};
export const SpecificReply: Story = { args: { threadSelected: true, parent: { name: 'Kofi', text: 'Can we ship it this week?' } } };
export const Sending: Story = { args: { message: { ...message, from: 'me', isMe: true, sending: true }, canReply: false } };
export const Failed: Story = { args: { message: { ...message, from: 'me', isMe: true, failed: true }, canReply: false, replyCount: 0 } };
export const FailedPrivateReply: Story = { args: { ...Failed.args, privateMessage: true, canReact: false, threadSelected: true } };
export const DeliveredPrivately: Story = { args: { message: { ...message, from: 'me', isMe: true }, delivery: 'Delivered', privateMessage: true, canReact: false } };
