/*
 * PlanCards: the plans side by side on the water, as many columns as there are plans, each a third of the page's width at
 * most. Their parts share rows (CSS subgrid), so the names, prices, bill lines, buttons and every fact line up across the
 * cards, and they compare row by row: a bill line that wraps on one card moves every card's button down with it. On a phone,
 * and for three plans on a narrow window, they stand one under another.
 */
import { Button, Faces, PlanCard, PlanCards, PlanHere } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';
import { AIKO, KOFI, MAYA, PRIYA } from '../../../src/world/people';
import { FREE_FACTS, LICENSES_TAKEN, MORE_NOTES, PRO_FACTS, TEAM_FACTS, onTheWater } from './parts';

/** Which plan you're on, and how the prices are shown. */
interface Shown { on: 'free' | 'pro' | 'ending'; yearly: boolean; team: boolean; waiting: boolean }

function Plans({ on, yearly, team, waiting }: Shown) {
  if (waiting) {
    return (
      <PlanCards>
        <PlanCard waiting kind="free" name="Free" sub="For a few calls a month" />
        <PlanCard waiting kind="pro" name="Pro" sub="For one person" lifted />
        {team && <PlanCard waiting kind="team" name="Team" sub="For a company" facts={4} />}
      </PlanCards>
    );
  }
  const onPro = on !== 'free';
  return (
    <PlanCards>
      <PlanCard kind="free" name="Free" sub="For a few calls a month" price="$0" bill="Nothing to pay."
        action={onPro ? <PlanHere quiet>Where you’re back to if a plan ends</PlanHere> : <PlanHere />} facts={FREE_FACTS} more={MORE_NOTES} />
      <PlanCard kind="pro" name="Pro" sub="For one person" lifted chip={on === 'ending' ? 'Ends in 3 days' : onPro ? 'Your plan' : undefined}
        price={yearly ? '$16' : '$20'} per="a month"
        bill={yearly ? '$192 for 12 months.' : 'For as many months as you choose.'} save={yearly ? 'You save $48.' : 'Or $16 for a year or more.'}
        action={<Button variant={on === 'pro' ? 'secondary' : 'primary'} onClick={did(onPro ? 'onExtend' : 'onGetPro')}>{onPro ? 'Extend' : 'Get Pro'}</Button>}
        facts={PRO_FACTS} />
      {team && (
        <PlanCard kind="team" name="Team" sub="For a company" price="$40" per="a person a month" bill="Each license is one person for 30 days."
          people={<Faces people={[PRIYA, KOFI, AIKO, MAYA]} size={22} max={4} />}
          action={<Button variant="secondary" onClick={did('onStartATeam')}>Start a team</Button>} facts={TEAM_FACTS} more={LICENSES_TAKEN} />
      )}
    </PlanCards>
  );
}

const meta = {
  title: 'Components/Plans/PlanCards',
  component: Plans,
  decorators: [onTheWater],
  parameters: { layout: 'fullscreen' },
  args: { on: 'free', yearly: true, team: false, waiting: false },
  argTypes: { on: { control: 'inline-radio', options: ['free', 'pro', 'ending'] }, yearly: { control: 'boolean' }, team: { control: 'boolean' }, waiting: { control: 'boolean' } }
} satisfies Meta<typeof Plans>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Free and Pro, as Plans shows them on Free, priced for a year: every row lines up. */
export const FreeAndPro: Story = { name: 'Free and Pro' };
/** Month by month: Pro's bill line wraps, and Free's button moves down with Pro's, so they stay in line. */
export const MonthByMonth: Story = { name: 'Month by month', args: { yearly: false } };
/** On Pro: nothing filled, Free a quiet line. */
export const OnPro: Story = { name: 'On Pro', args: { on: 'pro' } };
/** Pro ending: Extend filled. */
export const ProEnding: Story = { name: 'Pro ending', args: { on: 'ending' } };
/**
 * With Team, a third card, with its people's arches: licenses, the same price month by month or yearly. Its four facts and
 * Free's last line share rows. Narrower than 1180px, three stand one under another.
 */
export const WithTeam: Story = { name: 'With Team', args: { team: true } };
/** The prices on their way: the cards hold their places. */
export const Waiting: Story = { args: { waiting: true } };
/** The three on their way. */
export const WaitingWithTeam: Story = { name: 'Waiting, with Team', args: { waiting: true, team: true } };
