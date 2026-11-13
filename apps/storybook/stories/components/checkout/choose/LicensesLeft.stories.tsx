import { LicensesLeft } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AIKO, ART, INES, KOFI, MAYA, PRIYA } from '../../../../src/world/people';
import { Step } from '../parts';

/**
 * Buying more licenses: the team they're for, in a line: its people's arches, how many licenses are left of those running and
 * not yet taken, and who's waiting for one (or how long each runs). On a phone the words go under the arches.
 */
const meta = {
  title: 'Components/Checkout/Choose/LicensesLeft', component: LicensesLeft, parameters: { layout: 'centered' },
  args: {
    people: [ART, PRIYA, KOFI, AIKO, INES, MAYA], title: 'All 5 licenses taken',
    sub: 'Maya is waiting for one. Each runs 30 days from when it’s taken.'
  },
  argTypes: { title: { control: 'text' }, sub: { control: 'text' }, people: { control: false } },
  decorators: [(Story) => <Step><Story /></Step>]
} satisfies Meta<typeof LicensesLeft>;
export default meta;
type Story = StoryObj<typeof meta>;

/** None left, and Maya waiting for one. */
export const SomeoneWaiting: Story = {};
export const SomeoneWaitingNight: Story = { globals: { theme: 'dark' } };
/** Some left, and nobody waiting: how long each runs. */
export const SomeLeft: Story = { args: { title: '2 of 7 licenses left', sub: 'Each runs 30 days from when it’s taken.' } };
/** A team with nothing bought yet. */
export const NoneYet: Story = { args: { people: [ART], title: 'No licenses yet', sub: 'Each runs 30 days from when it’s taken.' } };
export const Phone: Story = { globals: { viewport: { value: 'phone' } } };
