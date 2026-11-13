/*
 * Avatar: a person in the arch, never a circle. Their photo from their sign-in provider comes first; without one, their
 * illustrated portrait on their own colour; without that, the first letter of their name (or address). A photo that
 * doesn't load (gone, blocked, offline) falls back the same way. A photo someone cut to a circle before giving it to their
 * provider is drawn larger, so it fills the arch as any photo does. The arch's title is the whole name, for where it's cut.
 */
import { Avatar } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Row, Stack } from '../../../src/component';
import { ANA, ELENA, INES, JONAS, PRIYA } from '../../../src/world/people';
import { PHOTO, ROUND_PHOTO } from '../../../src/world/photos';

const SIZES = [22, 28, 32, 44, 64, 96];

const meta = {
  title: 'Components/People/Avatar',
  component: Avatar,
  parameters: { layout: 'centered' },
  args: { person: PRIYA, size: 64 },
  argTypes: {
    person: { control: 'object' },
    size: { control: { type: 'range', min: 16, max: 160, step: 2 } },
    className: { control: false }, style: { control: false }
  }
} satisfies Meta<typeof Avatar>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Their portrait, on their own colour. */
export const Portrait: Story = {};
/** Someone without a portrait: the first letter of their name, in a pale arch (`arch-fill`, `arch-ink`). */
export const Initial: Story = { args: { person: INES } };
/** At night the arch stays pale, as portraits are, so they read as a person among the others, never as a gap. */
export const InitialNight: Story = { ...Initial, name: 'Initial, night', globals: { theme: 'dark' } };
/** A photo from their sign-in provider comes first. */
export const Photo: Story = { args: { person: { ...JONAS, photoUrl: PHOTO } } };
/**
 * A photo cut to a circle before it reached their provider: a square whose corners are see-through. It's drawn larger from
 * the top of the arch, so the circle fills the arch as any photo does, never standing in it on the arch's fill.
 */
export const RoundPhoto: Story = { name: 'Round photo', args: { person: { ...JONAS, photoUrl: ROUND_PHOTO } } };
/** At night, where the arch's fill is pale, a round photo still fills the arch. */
export const RoundPhotoNight: Story = { ...RoundPhoto, name: 'Round photo, night', globals: { theme: 'dark' } };
/**
 * A photo that doesn't load: their portrait takes its place, as their initial would for someone without one. Here the
 * file is broken; one that's gone (a 404) falls back the same way, but the browser logs it.
 */
export const PhotoThatFails: Story = { name: 'Photo that fails', args: { person: { ...JONAS, photoUrl: 'data:image/jpeg;base64,' } } };
/** Known only by their address: its first letter, and the address as the arch's title. */
export const KnownByTheirAddress: Story = { name: 'Known by their address', args: { person: { name: '', email: ANA.email } } };
/** Where the name beside it is cut short, the arch's title still has it whole: hover the arch. */
export const ALongName: Story = {
  name: 'A long name',
  args: { person: ELENA, size: 32 },
  render: (args) => (
    <div className="flex w-[120px] items-center gap-2.5">
      <Avatar {...args} />
      <span className="ac-clamp-1 text-[14px] font-semibold">{args.person.name}</span>
    </div>
  )
};
/** From 22px in a dense row to 96px, portraits, initials and round photos alike. */
export const Sizes: Story = {
  render: (args) => (
    <Stack>
      {[args.person, INES, { ...JONAS, photoUrl: ROUND_PHOTO }].map((person) => (
        <Row key={person.name}>
          {SIZES.map((size) => (
            <figure key={size} className="m-0 grid justify-items-center gap-2">
              <Avatar {...args} person={person} size={size} />
              <figcaption className="text-[12px] text-ink-3 tabular-nums">{size}</figcaption>
            </figure>
          ))}
        </Row>
      ))}
    </Stack>
  )
};
