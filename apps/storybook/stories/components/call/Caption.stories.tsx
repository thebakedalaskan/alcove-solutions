/*
 * Caption: the newest line of the live transcript, at the bottom of the stage while captions are on, always at night.
 * Who's speaking, then what they said. A line translated into the language you picked carries its tag (`lang`) and
 * keeps what was said underneath (`original`). Before anyone has said anything, it says where the lines will appear.
 */
import { Avatar, Caption, Icon } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, onStage } from '../../../src/component';
import { KOFI, PRIYA } from '../../../src/world/people';

const meta = {
  title: 'Components/In a call/Caption',
  component: Caption,
  ...onStage,
  args: {
    who: <><Avatar person={PRIYA} size={18} />Priya</>,
    children: 'Shall we start with the empty states? They’re the last thing blocking the launch.'
  },
  argTypes: { who: { control: false }, children: { control: 'text' }, lang: { control: 'text' }, original: { control: 'text' }, className: { control: false } },
  render: (args) => <Box width="min(720px, 100%)" height="auto"><Caption {...args} /></Box>
} satisfies Meta<typeof Caption>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Line: Story = {};
/** Translated into Spanish for you: the tag says so, and what Priya said in English stays underneath. */
export const Translated: Story = {
  args: {
    lang: '→ ES',
    children: '¿Empezamos por los estados vacíos? Son lo último que bloquea el lanzamiento.',
    original: 'Shall we start with the empty states? They’re the last thing blocking the launch.'
  }
};
/** A long line wraps, and the caption grows to hold it. */
export const Long: Story = {
  args: {
    who: <><Avatar person={KOFI} size={18} />Kofi</>,
    children: 'Here’s why I’d do the team page first. It’s the first page a new team sees, and right now they see a blank column and nothing to press. With one line and the arch, they know who’s missing and how to ask them.'
  }
};
/** Captions on, before anyone has spoken. */
export const Waiting: Story = {
  args: {
    who: <><Icon name="captions" size={15} />Captions</>,
    children: <span className="ic-cap-wait">What’s said appears here as people talk.</span>
  }
};
