/*
 * PlanTeamStart: starting a team, inside the popover Team's Start a team opens on Plans (and on the plan choice's same card).
 * The team's name in its box, the company's to start with, that it's free and yours to run, why it wasn't started if it
 * wasn't, then Cancel and Start the team (filled). `bare`, it stands in checkout's step, opened on Team with no team, whose
 * foot has its buttons (Components/Checkout/CheckoutWindow › Start a team has the whole window).
 */
import { CheckoutNote, PlanTeamStart } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { PopSurface, did } from '../../../src/component';
import { Step } from '../checkout/parts';

const meta = {
  title: 'Components/Plans/PlanTeamStart',
  component: PlanTeamStart,
  // In its popover; bare, in checkout's step, under the note it follows there.
  decorators: [(Story, { args }) => (args.bare
    ? <Step><CheckoutNote tone="info">Licenses are for a team, and you’re not on one yet.</CheckoutNote><Story /></Step>
    : <PopSurface><Story /></PopSurface>)],
  parameters: { layout: 'centered' },
  args: { value: 'Vandelay Industries', onChange: did('onChange'), onStart: did('onStart'), onCancel: did('onCancel') },
  argTypes: {
    value: { control: 'text' }, busy: { control: 'boolean' }, error: { control: 'text' }, label: { control: 'text' }, bare: { control: 'boolean' },
    id: { control: false }, className: { control: false }
  },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <PlanTeamStart {...args} onChange={(name) => { args.onChange(name); update({ value: name }); }} />;
  }
} satisfies Meta<typeof PlanTeamStart>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The company's name, from its directory, to start with. */
export const Starting: Story = {};
export const StartingNight: Story = { ...Starting, globals: { theme: 'dark' } };
export const StartingPhone: Story = { ...Starting, globals: { viewport: { value: 'phone' } } };
/** At a personal address: the name starts as Art's own team's. */
export const AtAPersonalAddress: Story = { name: 'At a personal address', args: { value: 'Art’s team' } };
/** Being made. */
export const Making: Story = { args: { busy: true } };
/** Emptied: nothing to start yet, so Start the team waits. */
export const Empty: Story = { args: { value: '' } };
/** It wasn't started: why, in the server's words. */
export const Refused: Story = { args: { error: 'You’re on a team already. Leave it before making one.' } };
export const RefusedNight: Story = { ...Refused, globals: { theme: 'dark' } };
/** In checkout, opened on Team with no team: under the window's own title, so its heading is Your team, and no buttons of its own. */
export const InCheckout: Story = { name: 'In checkout', args: { bare: true, label: 'Your team' } };
export const InCheckoutNight: Story = { ...InCheckout, name: 'In checkout, night', globals: { theme: 'dark' } };
