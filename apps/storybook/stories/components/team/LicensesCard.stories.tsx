/*
 * LicensesCard: the team's licenses, for its admin, beside the team's people. How many are left of those there are, a line on
 * them (warm while someone waits for one), Buy licenses (filled only while someone waits and nothing else asks), and Buy a
 * license for each person who joins, from the balance whenever one's needed. On a free team with that on, the card says so
 * without Buy licenses: the team's Upgrade is in its Free note.
 */
import { LicensesCard } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../src/component';
import { onTheWater } from './parts';

const meta = {
  title: 'Components/Team/LicensesCard',
  component: LicensesCard,
  decorators: [onTheWater(true)],
  parameters: { layout: 'fullscreen' },
  args: { left: 3, of: 8, line: 'Each is taken as someone next opens Alcove, for 30 days.', onBuy: did('onBuy'), auto: false, onAuto: did('onAuto') },
  argTypes: {
    left: { control: { type: 'number', min: 0 } }, of: { control: { type: 'number', min: 0 } }, line: { control: 'text' },
    warm: { control: 'boolean' }, urgent: { control: 'boolean' }, auto: { control: 'boolean' }, autoBusy: { control: 'boolean' },
    onBuy: { control: false }, onAuto: { control: false }, className: { control: false }
  },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <LicensesCard {...args} onAuto={(on) => { update({ auto: on }); args.onAuto(on); }} />;
  }
} satisfies Meta<typeof LicensesCard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Licenses left, and nobody waiting: Buy licenses is a second choice. */
export const Plenty: Story = {};
/** Someone waiting and none left: who, in warm, and Buy licenses filled. */
export const SomeoneWaiting: Story = {
  name: 'Someone waiting',
  args: { left: 0, of: 5, line: 'Aiko is waiting for one. Each is taken as someone next opens Alcove, for 30 days.', warm: true, urgent: true }
};
/** Someone waiting while something else on the page is asked: Buy licenses isn't filled, so the question's answer is. */
export const WaitingWhileAsked: Story = { name: 'Waiting, while something else is asked', args: { ...SomeoneWaiting.args, urgent: false } };
/** A team with no license yet. */
export const NoneYet: Story = { name: 'None yet', args: { left: 0, of: 0 } };
/** Buying a license for each person who joins, from the balance. */
export const BuyWhenNeeded: Story = { name: 'Buying one for each person who joins', args: { auto: true } };
/** A free team whose admin has that on: it spends from the balance, so it shows, to turn off. Nothing to buy here. */
export const OnFree: Story = {
  name: 'On Free, buying one for each person who joins',
  args: { left: 0, of: 0, auto: true, line: 'None bought now. While this is on, one is bought from your balance for each person who opens Alcove without one.' },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <LicensesCard {...args} onBuy={undefined} onAuto={(on) => { update({ auto: on }); args.onAuto(on); }} />;
  }
};
