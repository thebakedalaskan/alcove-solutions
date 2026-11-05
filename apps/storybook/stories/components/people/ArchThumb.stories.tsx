/*
 * ArchThumb: the alcove motif, a small arched window with the sun coming up, for a note or a call in a list. There are
 * six skies (`COVERS`), and `coverFor(id)` gives an ID the same one every time. `room`: a recording made in the room,
 * its sun a pale disc. `width` is in px; without it the stylesheet makes it 34px, unless a screen sets `--w`.
 */
import { ArchThumb, COVERS, coverFor } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Row, Stack } from '../../../src/component';
import { busyNotes } from '../../../src/world/notes';

const meta = {
  title: 'Components/People/ArchThumb',
  component: ArchThumb,
  parameters: { layout: 'centered' },
  args: { cover: 'dawn', width: 48, room: false },
  argTypes: {
    cover: { control: 'inline-radio', options: COVERS },
    width: { control: { type: 'range', min: 15, max: 120, step: 1 } }
  }
} satisfies Meta<typeof ArchThumb>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
/** The six skies, in order. */
export const EveryCover: Story = {
  name: 'Every cover',
  render: (args) => (
    <Row>
      {COVERS.map((cover) => (
        <figure key={cover} className="grid justify-items-center gap-2">
          <ArchThumb {...args} cover={cover} />
          <figcaption className="ac-eyebrow">{cover}</figcaption>
        </figure>
      ))}
    </Row>
  )
};
/** The busy day's notes, each with the sky `coverFor` gives its ID, as the palette lists them: a note keeps its sky. */
export const CoverForAnId: Story = {
  name: 'Cover for an ID',
  render: () => (
    <Stack>
      {busyNotes().slice(0, 6).map((n) => (
        <span key={n.id} className="flex items-center gap-3">
          <ArchThumb cover={coverFor(n.id)} room={n.kind === 'room'} width={26} />
          <span className="ac-body-s">{n.title}</span>
          <code className="text-xs text-ink-3">{n.id}</code>
        </span>
      ))}
    </Stack>
  )
};
/** A recording made in the room. */
export const Room: Story = { args: { room: true } };
/** 15 in the side panel's list of notes, 26 in rows and the palette, 34 by default, then 48 and 72. */
export const Sizes: Story = {
  render: (args) => (
    <Row>
      {[15, 26, 34, 48, 72].map((width) => <ArchThumb key={width} {...args} width={width} />)}
    </Row>
  )
};
