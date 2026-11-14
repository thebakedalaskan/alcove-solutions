/*
 * SharePointer: someone's pointer on a shared screen, on the call stage. An arrow whose tip is the spot they point at,
 * with their tag beside it. The tip is at the top left of its box, so `left` and `top` put it on the spot. Here it's on
 * Kofi's launch checklist, as the standup's notes kept it.
 */
import { SharePointer } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { screenImage } from '../../../../src/api/media';
import { onStage } from '../../../../src/component';
import { LAUNCH_CHECKLIST } from '../../../../src/world/notes';
import { ART, KOFI, PRIYA } from '../../../../src/world/people';

const SLIDE = screenImage(LAUNCH_CHECKLIST);

/** Kofi's shared screen, at its own shape, with whatever points at it on top. */
function SharedScreen({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: 'relative', width: 'min(760px, 100%)', aspectRatio: `${LAUNCH_CHECKLIST.width} / ${LAUNCH_CHECKLIST.height}` }}>
      <img src={SLIDE} alt="Kofi’s launch checklist, shared" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', borderRadius: 'var(--radius-md)' }} />
      {children}
    </div>
  );
}

const meta = {
  title: 'Components/In a call/Sharing/SharePointer',
  component: SharePointer,
  ...onStage,
  args: { person: PRIYA, name: 'Priya', style: { left: '31%', top: '49%' } },
  argTypes: { person: { control: false }, name: { control: 'text' }, style: { control: 'object' }, className: { control: false } },
  render: (args) => <SharedScreen><SharePointer {...args} /></SharedScreen>
} satisfies Meta<typeof SharePointer>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Priya points at the empty state on the team page, one of the two items still open. */
export const Pointing: Story = {};
/** Several people at once, each with their own tag: Kofi at the heading, you at the help article, Priya at the team page. */
export const Several: Story = {
  render: () => (
    <SharedScreen>
      <SharePointer person={KOFI} name="Kofi" style={{ left: '33%', top: '19%' }} />
      <SharePointer person={ART} name="You" style={{ left: '26%', top: '35%' }} />
      <SharePointer person={PRIYA} name="Priya" style={{ left: '31%', top: '49%' }} />
    </SharedScreen>
  )
};
