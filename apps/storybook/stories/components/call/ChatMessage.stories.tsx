/*
 * A message in a call's chat, as Slack shows one: no box, the arch, name and time over the first of a run, the words under
 * it, reactions as pills and the thread's line. Pointing at it brings a small bar over its top right corner with three
 * reactions, the rest, Reply in thread and Message privately; on a phone a ⋯ does. Your side of a call takes your theme.
 */
import { ChatMessage, type ChatMessageActions } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, did } from '../../../src/component';
import { AIKO, KOFI, PRIYA } from '../../../src/world/people';

const acts: ChatMessageActions = { onReact: did('react'), onReply: did('reply in thread'), onPrivate: did('message privately') };
const meta = {
  title: 'Components/In a call/ChatMessage', component: ChatMessage,
  args: { id: 'chat-demo-message', person: PRIYA, name: 'Priya', time: '14:28', first: true, text: 'Can someone drop last month’s sign-ups here?', reactions: [], actions: acts },
  render: (args) => <Box width="min(360px, 100%)" height="auto"><div className="ch-list"><ChatMessage {...args} /></div></Box>
} satisfies Meta<typeof ChatMessage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const OneMessage: Story = {};
/** Pointing at it: three reactions at once, the rest from the smiley, Reply in thread and Message privately. */
export const Pointing: Story = { play: async ({ canvas, userEvent }) => { await userEvent.hover(await canvas.findByText('Can someone drop last month’s sign-ups here?')); } };
export const WithReactions: Story = { args: { reactions: [{ name: 'thumbs-up', names: ['You', 'Kofi', 'Aiko'], mine: true }, { name: 'party', names: ['Diego'], mine: false }] } };
export const WithThread: Story = { args: { thread: { count: 2, last: '14:29', people: [KOFI, AIKO], fresh: 0, onOpen: did('open thread') } } };
export const NewReplies: Story = { args: { thread: { count: 3, last: '14:31', people: [KOFI, AIKO, PRIYA], fresh: 2, onOpen: did('open thread') } } };
export const MentionsYou: Story = { args: { unreadMention: true, text: <><mark className="ic-mention is-me">@Art Vandelay</mark>, can you check the numbers?</> } };
/** A reply in a thread that was sent to everyone too says what it answered. */
export const ReplySentToEveryone: Story = { args: { person: KOFI, name: 'Kofi', text: 'Sign-ups by week, from the dashboard.', context: <button type="button" className="ch-from">Replied to Priya: Can someone drop last month’s sign-ups here?</button> } };
export const Sending: Story = { args: { name: 'Art (you)', sending: true, time: 'Now', actions: {} } };
export const Failed: Story = { args: { name: 'Art (you)', failed: { onRetry: did('retry'), canRetry: true, label: 'Retry' }, actions: {} } };
export const FailedPrivately: Story = { args: { ...Failed.args, failed: { onRetry: did('retry'), canRetry: true, label: 'Retry privately' } } };
export const DeliveredPrivately: Story = { args: { name: 'Art (you)', delivery: 'Delivered', actions: { onReact: did('react'), onReply: did('reply in thread') } } };
/** A run from one person sits under one name; the times of the rest show in the margin as you point at them. */
export const ARun: Story = {
  render: () => (
    <Box width="min(360px, 100%)" height="auto">
      <div className="ch-list">
        <ChatMessage id="run-1" person={PRIYA} name="Priya" time="14:28" first text="Can someone drop last month’s sign-ups here?" reactions={[]} actions={acts} />
        <ChatMessage id="run-2" person={PRIYA} name="Priya" time="14:28" first={false} text="By week, if the dashboard has it." reactions={[]} actions={acts} />
        <ChatMessage id="run-3" person={KOFI} name="Kofi" time="14:30" first text="Sales can announce it the week of the 18th." reactions={[{ name: 'thumbs-up', names: ['You', 'Aiko'], mine: true }]} actions={acts} />
        <ChatMessage id="run-4" person={KOFI} name="Kofi" time="14:30" first={false} text="And support gets the FAQ on the 16th." reactions={[]} actions={acts} />
      </div>
    </Box>
  )
};
