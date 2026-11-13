/*
 * Avatar: a person in the arch, never a circle. Their photo from their sign-in provider comes first; without one, their
 * illustrated portrait on their own colour; without that, the first letter of their name (or address). A photo that
 * doesn't load (gone, blocked, offline) falls back the same way. The arch's title is the whole name, for where it's cut.
 */
import { Avatar } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Row, Stack } from '../../../src/component';
import { ANA, ELENA, INES, JONAS, PRIYA } from '../../../src/world/people';

/** A drawn picture standing in for Jonas's photo from his sign-in provider: the demo world has no photographs. */
const PHOTO = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 130">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9DB8DE"/><stop offset="1" stop-color="#E9D3C2"/></linearGradient>
<radialGradient id="window" cx=".78" cy=".18" r=".62"><stop offset="0" stop-color="#FFF4DD" stop-opacity=".9"/><stop offset="1" stop-color="#FFF4DD" stop-opacity="0"/></radialGradient>
</defs>
<rect width="120" height="130" fill="url(#sky)"/><rect width="120" height="130" fill="url(#window)"/>
<path d="M6 130C9 102 30 90 60 90C90 90 111 102 114 130Z" fill="#2A2845"/>
<path d="M50 76H70V93C66 99 54 99 50 93Z" fill="#E2BB9C"/>
<ellipse cx="60" cy="57" rx="21" ry="25" fill="#F3D8C1"/>
<path d="M38 55C37 35 48 27 61 27C75 27 84 36 82 54C78 44 71 40 61 40C51 40 44 45 38 55Z" fill="#C7A066"/>
<g fill="none" stroke="#2A201B" stroke-width="2"><rect x="44" y="52" width="14" height="10" rx="4"/><rect x="62" y="52" width="14" height="10" rx="4"/><path d="M58 57H62"/></g>
<path d="M53 71Q60 75 67 71" stroke="#9A5A48" stroke-width="2" fill="none" stroke-linecap="round"/>
</svg>`)}`;

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
/** From 22px in a dense row to 96px, portraits and initials alike. */
export const Sizes: Story = {
  render: (args) => (
    <Stack>
      {[args.person, INES].map((person) => (
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
