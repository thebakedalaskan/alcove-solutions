/*
 * VolumeControl: how loud one person is for you, in a call, from their tile's menu and from People. A slider and a quick
 * mute, for you alone: only your own playback changes, nobody else's sound, and they aren't told. Unmuting goes back to
 * the level they had. `volumeTag` is how the level reads beside their name: nothing at full volume. The call is always
 * night, so it's shown on the stage, in the tile menu it sits in.
 */
import { Avatar, VolumeControl, volumeTag } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did, onStage } from '../../../src/component';
import { PRIYA } from '../../../src/world/people';

const meta = {
  title: 'Components/In a call/VolumeControl',
  component: VolumeControl,
  ...onStage,
  args: { name: 'Priya', level: 1, onChange: did('onChange'), onToggle: did('onToggle') },
  argTypes: { level: { control: { type: 'range', min: 0, max: 1, step: 0.05 } } },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    /* Unmuting goes back to the level they had; here, half way when it was never set. */
    const toggle = () => { args.onToggle(); update({ level: args.level === 0 ? 0.5 : 0 }); };
    const tag = volumeTag(args.level);
    return (
      <>
        <div className="ac-pop is-stage ic-menu sbc-pop">
          <div className="mh"><Avatar person={PRIYA} size={22} /><b>{PRIYA.name}</b></div>
          <VolumeControl {...args} onChange={(level) => { args.onChange(level); update({ level }); }} onToggle={toggle} />
        </div>
        <p style={{ color: 'var(--stage-ink-2)', fontSize: 13 }}>Beside {args.name}’s name on the stage: {tag ?? 'nothing, at full volume'}</p>
      </>
    );
  }
} satisfies Meta<typeof VolumeControl>;
export default meta;
type Story = StoryObj<typeof meta>;

/** At full volume, as everyone starts: nothing is said beside their name. */
export const FullVolume: Story = { name: 'Full volume' };
/** Turned down for you: the level reads beside their name. */
export const Quieter: Story = { args: { level: 0.4 } };
/** Muted for you alone: the speaker is crossed out and the slider is at the start. */
export const MutedForYou: Story = { name: 'Muted for you', args: { level: 0 } };
