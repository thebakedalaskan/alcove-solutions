import { LicensesLeft } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AIKO, ART, INES, KOFI, MAYA, PRIYA } from '../../../../src/world/people';
import { Step } from '../parts';

/**
 * The team licenses are for, in a line: its people's arches, and buying more, how many licenses are left of those running and
 * not yet taken, and who's waiting for one; upgrading, that it's on Free and how many are on it. How long a license runs is
 * said once, beside its price, not here. On a phone the words go under the arches.
 */
const meta = {
  title: 'Components/Checkout/Choose/LicensesLeft', component: LicensesLeft, parameters: { layout: 'centered' },
  args: {
    people: [ART, PRIYA, KOFI, AIKO, INES, MAYA], title: 'All 5 licenses taken', sub: 'Maya is waiting for one.'
  },
  argTypes: { title: { control: 'text' }, sub: { control: 'text' }, people: { control: false } },
  decorators: [(Story) => <Step><Story /></Step>]
} satisfies Meta<typeof LicensesLeft>;
export default meta;
type Story = StoryObj<typeof meta>;

/** None left, and Maya waiting for one. */
export const SomeoneWaiting: Story = {};
export const SomeoneWaitingNight: Story = { globals: { theme: 'dark' } };
/** Some left, and nobody waiting: the count alone. */
export const SomeLeft: Story = { args: { title: '2 of 7 licenses left', sub: undefined } };
/** A team with nothing bought yet. */
export const NoneYet: Story = { args: { people: [ART], title: 'No licenses yet', sub: undefined } };
/** Upgrading a free team: it's on Free, and how many are on it, none with a license yet. */
export const OnFree: Story = { name: 'On Free', args: { people: [ART, PRIYA, KOFI], title: 'Vandelay Industries, on Free', sub: '3 people on it, none with a license yet.' } };
export const OnFreeNight: Story = { ...OnFree, name: 'On Free, night', globals: { theme: 'dark' } };
export const Phone: Story = { globals: { viewport: { value: 'phone' } } };
