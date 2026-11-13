/*
 * PlanCard: one plan, a light card on the water. Its name (with a warm chip on the plan you're on, and for Team its people
 * as small arches), who it's for, its price in the display face and what that bills (what a year saves, warm), the one thing
 * to do the card's width (or PlanHere where you already are), then what it brings, one fact a row, and a quiet last line.
 * `lifted` is Pro's: raised, with a warm edge along its top. `waiting`: the prices are on their way, and quiet bars hold
 * their places, but for what can be done already (the plan choice's way on). Side by side in PlanCards, every row lines up
 * with the other cards'.
 */
import { Button, Faces, PlanCard, PlanHere, type PlanCardShown } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { did } from '../../../src/component';
import { AIKO, KOFI, MAYA, PRIYA } from '../../../src/world/people';
import { FREE_FACTS, LICENSES_TAKEN, MORE_NOTES, PRO_FACTS, TEAM_FACTS, onTheWater } from './parts';

/** A plan as it's shown, or `waiting` for its prices (with `wayOn` in its button's place, if anything): one or the other. */
type CardArgs = Omit<PlanCardShown, 'waiting'> & { waiting?: boolean | undefined; wayOn?: ReactNode };
function Card({ waiting = false, wayOn, ...shown }: CardArgs) {
  return waiting
    ? <PlanCard waiting kind={shown.kind} name={shown.name} sub={shown.sub} people={shown.people} lifted={shown.lifted} facts={shown.facts.length} action={wayOn} />
    : <PlanCard {...shown} />;
}

const meta = {
  title: 'Components/Plans/PlanCard',
  component: Card,
  decorators: [(Story) => <div className="mx-auto max-w-[372px]"><Story /></div>, onTheWater],
  parameters: { layout: 'fullscreen' },
  args: {
    kind: 'pro', name: 'Pro', sub: 'For one person', lifted: true,
    price: '$16', per: 'a month', bill: '$192 for 12 months.', save: 'You save $48.',
    action: <Button variant="primary" onClick={did('onGetPro')}>Get Pro</Button>,
    facts: PRO_FACTS
  },
  argTypes: {
    kind: { control: 'inline-radio', options: ['free', 'pro', 'team'] },
    name: { control: 'text' }, sub: { control: 'text' }, price: { control: 'text' }, per: { control: 'text' },
    bill: { control: 'text' }, save: { control: 'text' }, chip: { control: 'text' }, more: { control: 'text' },
    lifted: { control: 'boolean' }, waiting: { control: 'boolean' },
    action: { control: false }, wayOn: { control: false }, facts: { control: false }, people: { control: false }, className: { control: false }
  }
} satisfies Meta<typeof Card>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Pro, priced for a year: lifted, with its warm edge, and Get Pro the one filled button. */
export const Pro: Story = {};
/** Pro month by month: what a year or more costs instead, said warm after the bill. */
export const ProMonthly: Story = {
  name: 'Pro, month by month',
  args: { price: '$20', bill: 'For as many months as you choose.', save: 'Or $16 for a year or more.' }
};
/** On Pro: it says so beside its name, and Extend is a second choice. */
export const YourPlan: Story = {
  name: 'Your plan',
  args: { chip: 'Your plan', action: <Button variant="secondary" onClick={did('onExtend')}>Extend</Button> }
};
/** Pro ending: when, beside its name, and Extend filled, since something needs doing. */
export const Ending: Story = {
  args: { chip: 'Ends in 3 days', action: <Button variant="primary" onClick={did('onExtend')}>Extend</Button> }
};
/** Free, the plan you're on: its button area says so, with a tick, and nothing to press. Its last line offers more notes. */
export const Free: Story = {
  args: { kind: 'free', name: 'Free', sub: 'For a few calls a month', lifted: false, price: '$0', per: undefined, bill: 'Nothing to pay.', save: undefined, action: <PlanHere />, facts: FREE_FACTS, more: MORE_NOTES }
};
/** Free while you're on another plan: a quiet line says it's where you're back to. */
export const FreeOnPro: Story = {
  name: 'Free, on Pro',
  args: { ...Free.args, action: <PlanHere quiet>Where you’re back to if a plan ends</PlanHere> }
};
/**
 * Team: licenses, one person for 30 days each, whichever way the prices are shown; the people it's for as small arches at the
 * end of its name's row, and Start a team off a team.
 */
export const Team: Story = {
  args: {
    kind: 'team', name: 'Team', sub: 'For a company', lifted: false, price: '$40', per: 'a person a month',
    bill: 'Each license is one person for 30 days.', save: undefined, people: <Faces people={[PRIYA, KOFI, AIKO, MAYA]} size={22} max={4} />,
    action: <Button variant="secondary" onClick={did('onStartATeam')}>Start a team</Button>, facts: TEAM_FACTS, more: LICENSES_TAKEN
  }
};
/** Team, as its admin: it's your plan while you're licensed, and Buy licenses. */
export const TeamAdmin: Story = {
  name: 'Team, its admin',
  args: { ...Team.args, chip: 'Your plan', action: <Button variant="secondary" onClick={did('onBuyLicenses')}>Buy licenses</Button> }
};
/** Team, as a member: who buys its licenses, in a quiet line where the button would be. */
export const TeamMember: Story = {
  name: 'Team, a member',
  args: { ...Team.args, chip: 'Your plan', action: <PlanHere quiet>Priya buys its licenses</PlanHere> }
};
/** Its prices on their way: the name and who it's for, and bars where the rest will be, breathing. */
export const Waiting: Story = { args: { waiting: true } };

/* The plan choice: Plans opened by itself once, where the plan you're on leads straight on. */
/** Free, the plan you're on, in the plan choice: Continue on Free, quiet, where Your plan would be. */
export const FreeChoosing: Story = {
  name: 'Free, in the plan choice',
  args: { ...Free.args, action: <Button variant="quiet" iconRight="right" onClick={did('onContinue')}>Continue on Free</Button> }
};
/** Free in the plan choice while the prices are on their way: the way on is there already, and bars wait for the rest. */
export const FreeChoosingWaiting: Story = {
  name: 'Free, in the plan choice, waiting',
  args: { ...Free.args, waiting: true, wayOn: <Button variant="quiet" iconRight="right" onClick={did('onContinue')}>Continue on Free</Button> }
};
/** Pro on a team license: it isn't sold while the license lasts, said quietly where Get Pro would be. */
export const ProOnATeam: Story = {
  name: 'Pro, on a team',
  args: { action: <PlanHere quiet>Not while you’re on your team’s plan</PlanHere> }
};
