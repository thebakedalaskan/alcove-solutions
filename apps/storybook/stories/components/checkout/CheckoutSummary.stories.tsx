import { CheckoutSummary } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { EXTEND_SUMMARY, FROM_BALANCE_SUMMARY, HOURS_SUMMARY, PRO_YEAR_SUMMARY, Side } from './parts';

/**
 * What you're buying, beside every step: its small evening, its name and who it's for, the price line by line (what's
 * saved in warm text, the balance taken off), the total to send, until when, and how it's priced.
 */
const meta = {
  title: 'Components/Checkout/CheckoutSummary', component: CheckoutSummary, parameters: { layout: 'centered' },
  args: { summary: PRO_YEAR_SUMMARY, rise: 'rest' },
  argTypes: { rise: { control: 'inline-radio', options: ['rest', 'waiting', 'seen', 'done'] } },
  decorators: [(Story) => <Side><Story /></Side>]
} satisfies Meta<typeof CheckoutSummary>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A year of Pro on Free: 192 USDC to send. */
export const AYearOfPro: Story = {};
export const AYearOfProNight: Story = { globals: { theme: 'dark' } };
/** Extending, with $5 off from the balance. */
export const Extending: Story = { args: { summary: EXTEND_SUMMARY } };
/** The balance covers it: no USDC to send. */
export const FromTheBalance: Story = { args: { summary: FROM_BALANCE_SUMMARY }, globals: { theme: 'dark' } };
/** More notes on a network whose least is more than they cost: the rest stays in the balance. */
export const MoreNotes: Story = { args: { summary: HOURS_SUMMARY } };
export const MoreNotesNight: Story = { args: { summary: HOURS_SUMMARY }, globals: { theme: 'dark' } };
/** Bought: the sun has cleared the horizon. */
export const Bought: Story = { args: { rise: 'done' }, globals: { theme: 'dark' } };
