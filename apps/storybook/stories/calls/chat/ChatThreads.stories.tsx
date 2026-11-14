import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { at, chats, replies, repliesToEveryone, type CallScript } from '../../../src/api/call/script';
import { inCall, light, phone, reach } from '../../../src/call';
import { pages, type PageArgs, type PageStory } from '../../../src/page';
import { SOON, talkPrivately } from '../plays';
import { AIKO, KOFI, PRIYA, REVIEW } from '../talk';

const meta = { title: 'Calls/Chat/Threads', ...pages } satisfies Meta<PageArgs>;
export default meta;
const original = 'Should we include the status page in the first release?';
const script: CallScript = {
  here: [{ who: PRIYA }, { who: KOFI }, { who: AIKO }], notes: 'off',
  cues: [
    ...at(.2, chats(PRIYA, original)),
    ...at(.4, replies(KOFI, original, 'Yes, with the same support contact.')),
    ...at(.6, replies(AIKO, 'Yes, with the same support contact.', 'I can prepare that page today.'))
  ]
};
const openChat = reach('Chat');
const openThread: NonNullable<PageStory['play']> = async (context) => {
  await openChat(context);
  await context.userEvent.click(await screen.findByRole('button', { name: /^2 replies/ }));
};
export const RepliesInChat = inCall({ scenario: 'call-soon', call: REVIEW, script }, { play: openChat });
export const RepliesInChatLight = light(RepliesInChat);
export const RepliesInChatPhone = phone(RepliesInChat);
export const RepliesInChatPhoneLight = light(RepliesInChatPhone);
export const OpenThread = inCall({ scenario: 'call-soon', call: REVIEW, script }, { play: openThread });
export const OpenThreadLight = light(OpenThread);
export const OpenThreadPhone = phone(OpenThread);
export const OpenThreadPhoneLight = light(OpenThreadPhone);
/** A reply ticked "Also send to Everyone" shows in the conversation too, with what it answered. */
export const ReplySentToEveryone = inCall({ scenario: 'call-soon', call: REVIEW, script: { ...script,
  cues: [...(script.cues ?? []), ...at(.8, repliesToEveryone(PRIYA, original, 'Decided: the status page ships with the release.'))] }
}, { play: openChat });
export const ReplySentToEveryoneLight = light(ReplySentToEveryone);
/** Replying with "Also send to Everyone" ticked: the reply goes to the thread and the conversation. */
export const AlsoSendToEveryone = inCall({ scenario: 'call-soon', call: REVIEW, script }, { play: async (c) => {
  await openThread(c);
  await c.userEvent.type(await screen.findByRole('combobox', { name: 'Reply in this thread' }), 'The release notes mention it too.');
  await c.userEvent.click(await screen.findByRole('checkbox', { name: 'Also send to Everyone' }));
} });
export const AlsoSendToEveryonePhone = phone(AlsoSendToEveryone);
export const FailedReply = inCall({ scenario: 'call-soon', call: REVIEW, script: { ...script, chatFailures: 1 } }, {
  play: async (context) => {
    await openThread(context);
    const composer = await screen.findByRole('combobox', { name: 'Reply in this thread' });
    await context.userEvent.type(composer, 'I will keep the release checklist here.');
    await context.userEvent.keyboard('{Enter}');
    await screen.findByRole('button', { name: 'Retry' });
  }
});
export const FailedReplyLight = light(FailedReply);
export const FailedReplyPhone = phone(FailedReply);
export const FailedReplyPhoneLight = light(FailedReplyPhone);

export const OriginalUnavailable = inCall({ scenario: 'call-soon', call: REVIEW, script: { ...script,
  cues: [...(script.cues ?? []), ...at(.8, { do: 'unavailable-chat', text: original })] }
}, { play: async (c) => { await openChat(c); await screen.findByText('The original message isn’t available to you.'); } });
export const OriginalUnavailableLight = light(OriginalUnavailable);
export const OriginalUnavailablePhone = phone(OriginalUnavailable);
const privateScript: CallScript = { here: [{ who: PRIYA }, { who: KOFI }], notes: 'off', privateMessages: [
  { from: PRIYA, text: 'Could you keep an eye on the time?', after: .2 },
  { from: PRIYA, text: 'I will leave two minutes for questions.', after: .4, replyTo: 'Could you keep an eye on the time?' },
  { from: PRIYA, text: 'Then Kofi can take the next section.', after: .6, replyTo: 'I will leave two minutes for questions.' }
] };
export const PrivateThread = inCall({ scenario: 'call-soon', call: REVIEW, script: privateScript }, { play: async (c) => {
  await openChat(c); await talkPrivately(c, PRIYA);
  await c.userEvent.click(await screen.findByRole('button', { name: /^2 replies/ }, SOON));
} });
export const PrivateThreadLight = light(PrivateThread);
export const PrivateThreadPhone = phone(PrivateThread);
export const PrivateThreadPhoneLight = light(PrivateThreadPhone);

export const ReplyAlert = inCall({ scenario: 'call-soon', call: REVIEW, script: { here: [{ who: KOFI }], notes: 'off',
  cues: at(5, replies(KOFI, 'Can you review the status page?', 'I will review it this afternoon.')) }
}, { play: async (c) => {
  await openChat(c);
  await c.userEvent.type(await screen.findByRole('combobox', { name: 'Message everyone' }), 'Can you review the status page?');
  await c.userEvent.click(await screen.findByRole('button', { name: 'Send to everyone' }));
  await c.userEvent.click(await screen.findByRole('button', { name: 'Close Chat' }));
  await screen.findByRole('button', { name: 'Open reply' }, { timeout: 10000 });
} });
export const ReplyAlertPhone = phone(ReplyAlert);

export const DepartedPrivateHistory = inCall({ scenario: 'call-soon', call: REVIEW, script: {
  here: [{ who: PRIYA }, { who: KOFI }], notes: 'off',
  privateMessages: [{ from: PRIYA, text: 'The checklist is ready for review.', after: .2 }],
  cues: at(.4, { do: 'leave', who: PRIYA })
} }, { play: async (c) => {
  await openChat(c);
  await c.userEvent.click(await screen.findByRole('tab', { name: /, private.*, unavailable$/ }, SOON));
  await screen.findByText('Unavailable in this room. Your draft stays here.');
} });
export const DepartedPrivateHistoryLight = light(DepartedPrivateHistory);
export const DepartedPrivateHistoryPhone = phone(DepartedPrivateHistory);
