/*
 * A scheduled call's card: one card, opened from its row in Home's Coming up, for the organizer and for anyone invited.
 * Who's coming, notes, documents, the link and Join; for the organizer every row opens to change it, and Cancel this call
 * asks once, in place (user-flows 4).
 */
import type { Meta } from '@storybook/react-vite';
import { screen } from 'storybook/test';
import { phone } from '../../src/call';
import { changing, page, pages, type PageArgs, type PageStory } from '../../src/page';
import { invited, troubled } from './changes';

const meta = { title: 'Pages/A scheduled call', ...pages } satisfies Meta<PageArgs>;
export default meta;

/** Opens a call's card from its row in Coming up, then presses whatever comes next in it. */
const opening = (row: RegExp, said: string, then: readonly [string | RegExp, string][] = []): NonNullable<PageStory['play']> => async ({ canvas, userEvent, step }) => {
  await step(said, async () => {
    await userEvent.click(await canvas.findByRole('button', { name: row }, { timeout: 8000 }));
    await screen.findByRole('dialog', {}, { timeout: 8000 });
  });
  for (const [name, next] of then) {
    await step(next, async () => {
      await userEvent.click(await screen.findByRole('button', { name }, { timeout: 8000 }));
    });
  }
};

/** Art's design sync at 17:30: who's coming and how they answered, notes, documents, the link, and Join. */
export const Yours = page('/home', 'busy', { play: opening(/Design sync/, 'Open the design sync from Coming up') });
export const YoursPhone = phone(Yours);
/** In a series: What carries over opens the series, and a change asks whether it's for this call or this and later ones. */
export const InASeries = page('/home', 'busy', { play: opening(/Team standup/, 'Open next week’s standup, which repeats every Wednesday') });
/** Change the time: the times that work, and the week. */
export const ChangeTheTime = page('/home', 'busy', { play: opening(/Design sync/, 'Open the design sync', [[/^Change the time/, 'Press Change the time']]) });
/** Cancel this call asks once, in place: it comes off the calendar and everyone invited is told. */
export const CancelAsks = page('/home', 'busy', { play: opening(/Design sync/, 'Open the design sync', [['Cancel this call', 'Press Cancel this call. It asks first']]) });
/** Priya's roadmap review, which Art is invited to and hasn't answered: Yes, Maybe or No. */
export const Invited = page('/home', 'busy', { beforeEach: changing(invited), play: opening(/Roadmap review/, 'Open Priya’s roadmap review, which waits for an answer') });
export const AnswerSaving = page('/home', 'busy', { beforeEach: changing(invited, troubled({ 'meetings.answer': 'hold' })), play: opening(/Roadmap review/, '4. Answer an invitation while it is syncing', [['Yes', 'Choose Yes. The answer shows immediately, with Saving']]) });
export const AnswerSavingNight = { ...AnswerSaving, globals: { theme: 'dark' } };
export const AnswerSavingPhone = phone(AnswerSaving);
export const AnswerSavingPhoneNight = { ...phone(AnswerSaving), globals: { viewport: { value: 'phone' }, theme: 'dark' } };
export const AnswerRefused = page('/home', 'busy', { beforeEach: changing(invited, troubled({ 'meetings.answer': 'failed' })), play: opening(/Roadmap review/, '4. A refused answer leaves the invitation usable', [['Yes', 'Choose Yes, and read why it could not be confirmed']]) });
/** Art offered Jonas three times: it waits for him to pick, with its link and Cancel this call. */
export const WaitingForAGuest = page('/home', 'busy', { beforeEach: changing(invited), play: opening(/Portfolio follow-up/, 'Open the portfolio follow-up, waiting for Jonas to pick a time') });
/** Ana offered Art three times: a time is being picked, and Pick a time goes to its link. */
export const ATimeToPick = page('/home', 'busy', { beforeEach: changing(invited), play: opening(/Contract walkthrough/, 'Open Ana’s contract walkthrough, where Art picks a time') });
