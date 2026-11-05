/*
 * Faces: a few people as overlapping arches, each 6px over the last and ringed in the surface's colour so the edges
 * read, with "+n" for everyone past `max`. Who's in a call, who's invited, who gets the notes.
 */
import type { Person } from '@alcove/api';
import { Faces } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Stack } from '../../../src/component';
import { AIKO, INES, KOFI, LENA, MAYA, PRIYA, SAM, byEmail } from '../../../src/world/people';

const isPerson = (p: Person | undefined): p is Person => p !== undefined;
/** Two of the company drawn without a portrait, from the world's directory. */
const RUTH = byEmail('ruth@vandelay.industries');
const MILO = byEmail('milo@vandelay.industries');

const meta = {
  title: 'Components/People/Faces',
  component: Faces,
  parameters: { layout: 'centered' },
  args: { people: [PRIYA, KOFI], size: 28, max: 4 },
  argTypes: {
    size: { control: { type: 'range', min: 16, max: 64, step: 2 } },
    max: { control: { type: 'number', min: 1, max: 8 } },
    people: { control: false }, className: { control: false }
  }
} satisfies Meta<typeof Faces>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Two people. */
export const Two: Story = {};
/** Seven people and room for four: the rest are "+3". */
export const MoreThanMax: Story = { name: 'More than max', args: { people: [PRIYA, KOFI, AIKO, MAYA, INES, LENA, SAM] } };
/** Portraits beside initials, for people drawn without one. */
export const PortraitsAndInitials: Story = { name: 'Portraits and initials', args: { people: [PRIYA, INES, KOFI, RUTH, AIKO, MILO].filter(isPerson), max: 6 } };
/** The sizes the app uses them at, from a dense row to a card's head. */
export const Sizes: Story = {
  args: { people: [PRIYA, KOFI, AIKO, MAYA] },
  render: (args) => (
    <Stack>
      {[22, 26, 28, 36, 44].map((size) => <Faces key={size} {...args} size={size} />)}
    </Stack>
  )
};
