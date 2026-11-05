/*
 * What the busy afternoon's documents say, written the way the canvas writes Vandelay Industries: the launch moves to the
 * 18th, two of the checklist's items are still open, the pricing page keeps one filled button, and Art owes Kofi the
 * pricing draft by Friday. Each page is the editor's own blocks (`BlockJSON`), under the document's title.
 */
import type { BlockJSON } from '~/features/workspace/editor/types';
import type { Page } from '.';

const words = (text: string): BlockJSON[] => [{ type: 'text', text }];
const line = (text: string): BlockJSON => ({ type: 'line', content: words(text) });
const heading = (text: string): BlockJSON => ({ type: 'line', attrs: { kind: 'heading', level: 2 }, content: words(text) });
const bullet = (text: string): BlockJSON => ({ type: 'line', attrs: { kind: 'bullet' }, content: words(text) });
const numbered = (text: string): BlockJSON => ({ type: 'line', attrs: { kind: 'numbered' }, content: words(text) });
const todo = (text: string, done = false): BlockJSON => ({ type: 'line', attrs: done ? { kind: 'todo', done: true } : { kind: 'todo' }, content: words(text) });
const callout = (text: string): BlockJSON => ({ type: 'line', attrs: { kind: 'callout', icon: 'bulb' }, content: words(text) });
const quote = (text: string): BlockJSON => ({ type: 'line', attrs: { kind: 'quote' }, content: words(text) });

/* ---------- Product ---------- */

export const LAUNCH_PLAN: Page = {
  blocks: [
    line('The launch moves to Wednesday 18 November. Sign-ups are back up since the pricing change, so the date holds.'),
    heading('What goes out'),
    bullet('Paying for minutes of notes, with free minutes every month for everyone'),
    bullet('A monthly option on the team plan'),
    bullet('The new onboarding, as the design review leaves it'),
    heading('Who has what'),
    bullet('Priya: the date, and the note to everyone on the 18th'),
    bullet('Maya: the team plan and its monthly price'),
    bullet('Kofi: the launch checklist, before the design review'),
    bullet('Lena: the pricing page copy'),
    heading('Before the 18th'),
    todo('Send Kofi the pricing draft'),
    todo('Cut the pricing page down to one filled button', true),
    todo('Close the last two items on the launch checklist'),
    todo('Tell support about the new refund wording', true),
    callout('Nothing goes out before the design review has seen the onboarding.')
  ]
};

export const LAUNCH_CHECKLIST: Page = {
  blocks: [
    line('Everything that has to be true on the 18th. Two items are still open.'),
    todo('Free minutes show on every plan', true),
    todo('The team plan has a monthly price', true),
    todo('Receipts say minutes, not seats', true),
    todo('The refund wording is the same everywhere', true),
    todo('The status page says what’s launching'),
    todo('Someone has looked at this before the design review'),
    todo('The launch note is written', true)
  ]
};

export const INTERVIEWS: Page = {
  blocks: [
    line('Six people who run their team’s meetings, spoken to in October.'),
    heading('What they said'),
    bullet('Nobody reads a whole transcript. They read the decisions, then search.'),
    bullet('Four of the six already pay for a note taker, two of them per seat.'),
    bullet('Everyone asked who else can read the notes before asking anything else.'),
    quote('If anyone at the vendor can read the notes, legal won’t let us use it.'),
    heading('What we change'),
    numbered('Decisions first, at the top of every note'),
    numbered('Who has the notes, on every note')
  ]
};

export const COMPETITORS: Page = {
  blocks: [
    line('What the other note takers charge for, as of October.'),
    bullet('Per seat, every month, whether anyone records or not'),
    bullet('Per minute, with nothing free'),
    bullet('Free, with the recordings used to train their models'),
    line('Minutes of notes, with free minutes for everyone, is still nobody else’s model.')
  ]
};

export const PRICING_COPY: Page = {
  blocks: [
    heading('Pay for the notes, not the seats'),
    line('Every seat gets free minutes of notes each month. Teams that need more buy minutes, by the month or as they go.'),
    heading('Nobody else reads them'),
    line('Notes are written where nobody else can read them: not us, and not anyone who wasn’t in the call.'),
    line('One filled button: Start free.')
  ]
};

export const OLD_ROADMAP: Page = { blocks: [line('The third quarter’s roadmap, from before the pricing change.')] };
export const FIRST_DRAFT: Page = { blocks: [line('First draft, from when the launch was going to be the 11th.')] };

/* ---------- Design ---------- */

export const EMPTY_STATES: Page = {
  blocks: [
    line('Every list and page says what will be there, and how to put something there. Never a blank space.'),
    heading('The rules'),
    bullet('Say what shows up here, in one sentence'),
    bullet('Offer the one thing that fills it, as the page’s filled button'),
    bullet('An arch, never an empty box'),
    heading('Still to do'),
    todo('Notes, when a search finds nothing'),
    todo('Team, before anyone has joined', true),
    todo('A workspace’s Trash')
  ]
};

/* ---------- Company handbook, which Art can only read ---------- */

export const HOLIDAYS: Page = {
  blocks: [
    line('Everyone has 28 days a year, and the public holidays where they live.'),
    heading('Booking time off'),
    numbered('Put it in the team calendar'),
    numbered('Tell your lead a week ahead for anything over three days'),
    heading('Between Christmas and New Year'),
    line('The office is closed from 24 December to 1 January, and those days don’t count.')
  ]
};

export const EXPENSES: Page = {
  blocks: [
    line('Keep the receipt, and send it in within a month.'),
    bullet('Trains in second class, planes in economy'),
    bullet('Hotels up to 180 euros a night, or 250 in London'),
    bullet('Dinner with a customer: up to 60 euros a head'),
    callout('Ask Nadia before booking anything over 1,000 euros.')
  ]
};

export const WORKING_FROM_HOME: Page = {
  blocks: [
    line('Work from wherever suits the day. Wednesdays are for being in the office together.'),
    bullet('A desk and a chair: up to 400 euros, once'),
    bullet('Internet: 30 euros a month')
  ]
};
