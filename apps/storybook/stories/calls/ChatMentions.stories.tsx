import type { Person } from '@alcove/api';
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { at, leaves, type CallScript } from '../../src/api/script';
import { inCall, light, phone, reach } from '../../src/call';
import { pages, type PageArgs, type PageStory } from '../../src/page';
import { choosePrivateAudience } from './plays';
import { KOFI, PRIYA, REVIEW } from './talk';

const meta = { title: 'Calls/Chat mentions', ...pages } satisfies Meta<PageArgs>;
export default meta;
type Context = Parameters<NonNullable<PageStory['play']>>[0];
const openChat = reach('Chat');
const privateChat = async (c: Context) => { await openChat(c); await choosePrivateAudience(c, new RegExp(`^${PRIYA.name} · Private`)); };
const here = [{ who: PRIYA }, { who: KOFI }];
const privateScript: CallScript = { here, notes: 'off', privateMessages: [
  { from: PRIYA, text: 'Could you review the checklist?', after: .2 },
  { from: PRIYA, text: '@Art Vandelay, the last section needs your review.', after: 1, tagged: ['me'], replyTo: 'Could you review the checklist?' }
] };

export const PrivatePicker = inCall({ scenario: 'call-soon', call: REVIEW, script: { here, notes: 'off' } }, { play: async (c) => {
  await privateChat(c); await c.userEvent.type(await screen.findByRole('combobox', { name: `Message only ${PRIYA.name}` }), '@');
} });
export const PrivatePickerLight = light(PrivatePicker);
export const PrivatePickerPhone = phone(PrivatePicker);
export const PrivatePickerPhoneLight = light(PrivatePickerPhone);
export const SelectedPrivateMention = inCall({ scenario: 'call-soon', call: REVIEW, script: { here, notes: 'off' } }, { play: async (c) => {
  await privateChat(c); await c.userEvent.type(await screen.findByRole('combobox', { name: `Message only ${PRIYA.name}` }), '@Pri');
  await c.userEvent.keyboard('{Enter}'); await c.userEvent.type(await screen.findByRole('combobox', { name: `Message only ${PRIYA.name}` }), 'can you review this?');
} });
export const SelectedPrivateMentionLight = light(SelectedPrivateMention);
export const SelectedPrivateMentionPhone = phone(SelectedPrivateMention);
export const PrivateThreadMention = inCall({ scenario: 'call-soon', call: REVIEW, script: privateScript }, { play: async (c) => {
  await privateChat(c); await c.userEvent.click(await screen.findByRole('button', { name: /^1 reply/ }, { timeout: 10000 }));
  await screen.findByText('@Art Vandelay', { selector: 'mark' });
} });
export const PrivateThreadMentionLight = light(PrivateThreadMention);
export const PrivateThreadMentionPhone = phone(PrivateThreadMention);
export const PrivateThreadMentionPhoneLight = light(PrivateThreadMentionPhone);
export const PrivateMentionAlert = inCall({ scenario: 'call-soon', call: REVIEW, script: { ...privateScript, privateMessages: [
  { from: PRIYA, text: 'Could you review the checklist?', after: .2 },
  { from: PRIYA, text: '@Art Vandelay, the last section needs your review.', after: 4, tagged: ['me'], replyTo: 'Could you review the checklist?' }
] } }, { play: async () => { await screen.findByRole('button', { name: 'Open mention' }, { timeout: 10000 }); } });
export const PrivateMentionAlertPhone = phone(PrivateMentionAlert);
export const FailedPrivateMention = inCall({ scenario: 'call-soon', call: REVIEW, script: { here, notes: 'off', privateSendFails: true } }, { play: async (c) => {
  await privateChat(c); await c.userEvent.type(await screen.findByRole('combobox', { name: `Message only ${PRIYA.name}` }), '@Pri'); await c.userEvent.keyboard('{Enter}');
  await c.userEvent.type(await screen.findByRole('combobox', { name: `Message only ${PRIYA.name}` }), 'please keep this conversation private.');
  await c.userEvent.click(await screen.findByRole('button', { name: `Send only to ${PRIYA.name}` })); await screen.findByRole('button', { name: 'Retry privately' });
} });
export const FailedPrivateMentionLight = light(FailedPrivateMention);
export const FailedPrivateMentionPhone = phone(FailedPrivateMention);
export const DepartedPrivateMention = inCall({ scenario: 'call-soon', call: REVIEW, script: { here, notes: 'off',
  privateMessages: [{ from: PRIYA, text: '@Art Vandelay, the checklist is ready.', tagged: ['me'], after: 1 }], cues: at(3, leaves(PRIYA))
} }, { play: async (c) => { await screen.findByText('Someone mentioned you in your call.', {}, { timeout: 10000 }); await privateChat(c); await screen.findByText('Unavailable in this room. Your draft stays here.', {}, { timeout: 10000 }); } });
export const DepartedPrivateMentionPhone = phone(DepartedPrivateMention);

const SAM_ONE: Person = { id: 'demo-sam-one', name: 'Sam Reed', email: 'sam.reed@vandelay.example' };
const SAM_TWO: Person = { id: 'demo-sam-two', name: 'Sam Reed', email: 'sam.reed.design@vandelay.example' };
const matching = { here: [{ who: SAM_ONE }, { who: SAM_TWO }], notes: 'off' as const };
export const MatchingNames = inCall({ scenario: 'call-soon', call: REVIEW, script: matching }, { play: async (c) => {
  await openChat(c); await c.userEvent.type(await screen.findByRole('combobox', { name: 'Message everyone' }), '@Sam');
} });
export const MatchingNamesLight = light(MatchingNames);
export const MatchingNamesPhone = phone(MatchingNames);
export const MatchingPrivateAudience = inCall({ scenario: 'call-soon', call: REVIEW, script: matching }, { play: async (c) => {
  await openChat(c); await choosePrivateAudience(c, /Sam Reed \(sam\.reed@vandelay\.example\)/);
  await c.userEvent.type(await screen.findByRole('combobox', { name: 'Message only Sam Reed (sam.reed@vandelay.example)' }), '@Sam');
} });
export const MatchingPrivateAudienceLight = light(MatchingPrivateAudience);
export const MatchingPrivateAudiencePhone = phone(MatchingPrivateAudience);
export const MatchingPrivateAudiencePhoneLight = light(MatchingPrivateAudiencePhone);
