/*
 * ScreenShot: a frame of a shared screen at its own shape, as a note keeps it. `focus` outlines the part something
 * points at, with its label, and dims the rest; `parts` outlines every part the notes found, quietly. The label goes
 * above its part; under it when the part starts near the frame's top, which clips what's outside it; inside it when it
 * runs from top to bottom; and from its right edge when it sits on the frame's right, so a long label stays on the frame.
 */
import type { ScreenMoment } from '@alcove/api';
import { ScreenShot } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { screenImage } from '../../../../src/api/media';
import { Box } from '../../../../src/component';
import { LAUNCH_CHECKLIST } from '../../../../src/world/notes';

/** Kofi's launch checklist, with the parts of it something could point at: one for each place a label can go. */
const CHECKLIST: ScreenMoment = {
  ...LAUNCH_CHECKLIST,
  text: 'Launch checklist\nHelp article for support, before the flag goes on\nFlag in the rollout plan, named as in the release notes\nEmpty state on the team page, with one line and the arch',
  regions: [
    { label: 'The open items', x: 0.05, y: 0.385, w: 0.57, h: 0.145 },
    { label: 'The heading', x: 0.05, y: 0.14, w: 0.315, h: 0.105 },
    { label: 'The whole checklist', x: 0.04, y: 0.07, w: 0.6, h: 0.8 },
    { label: 'The empty arch', x: 0.52, y: 0.462, w: 0.095, h: 0.066 }
  ]
};
/** A phone's screen, shared upright. */
const PHONE: ScreenMoment = { ...LAUNCH_CHECKLIST, width: 1179, height: 2556, title: 'Rollout', text: 'Rollout\nTen percent\nThen everyone', regions: [] };
/** A very wide monitor. */
const WIDE: ScreenMoment = { ...LAUNCH_CHECKLIST, width: 3440, height: 1440, regions: [] };

const meta = {
  title: 'Components/In a call/Sharing/ScreenShot',
  component: ScreenShot,
  args: { src: screenImage(CHECKLIST), alt: 'Kofi’s launch checklist, as shared', width: CHECKLIST.width, height: CHECKLIST.height, regions: CHECKLIST.regions, parts: false },
  argTypes: { src: { control: false }, regions: { control: false }, focus: { control: { type: 'number', min: 0, max: 3 } }, className: { control: false } },
  render: (args) => <Box width="min(720px, 100%)" height="auto"><ScreenShot {...args} /></Box>
} satisfies Meta<typeof ScreenShot>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The frame as it was shared, with nothing pointed at. */
export const Frame: Story = {};
/** A part in the middle of the frame: its label goes above it. */
export const FocusAbove: Story = { name: 'Focus, label above', args: { focus: 0 } };
/** A part near the frame's top: there's no room above, so its label goes under it. */
export const FocusBelow: Story = { name: 'Focus, label below', args: { focus: 1 } };
/** A part that runs from top to bottom: its label goes inside it. */
export const FocusInside: Story = { name: 'Focus, label inside', args: { focus: 2 } };
/** A part on the frame's right: its label runs from the part's right edge. */
export const FocusOnTheRight: Story = { name: 'Focus on the right', args: { focus: 3 } };
/** Every part the notes found, outlined quietly. */
export const AllParts: Story = { name: 'All parts', args: { parts: true } };
/** A phone's screen keeps its own shape. */
export const Tall: Story = {
  args: { src: screenImage(PHONE), alt: 'Kofi’s phone, as shared', width: PHONE.width, height: PHONE.height, regions: [] },
  render: (args) => <Box width={220} height="auto"><ScreenShot {...args} /></Box>
};
/** So does a very wide monitor. */
export const Wide: Story = { args: { src: screenImage(WIDE), width: WIDE.width, height: WIDE.height, regions: [] } };
