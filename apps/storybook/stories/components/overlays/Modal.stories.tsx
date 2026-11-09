/*
 * Modal: a window over the page, which waits behind a veil. Centred for a choice that needs room, or rising from the
 * bottom for a quick decision (leaving a call). Several questions are asked one at a time inside the one modal: no window
 * ever opens over another. The answer that loses nothing is the filled button. Focus starts on the first thing to press,
 * or with `focusSelf` on the modal itself, for one that's mostly to read; closing puts it back where it was.
 */
import { Button, CallDock, DockButton, DockLeave, IconButton, Modal } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did, onStage } from '../../../src/component';

const meta = {
  title: 'Components/Overlays/Modal',
  component: Modal,
  args: { open: true, label: 'Delete these notes', placement: 'center', focusSelf: false, children: null, onOpenChange: did('onOpenChange') },
  argTypes: {
    placement: { control: 'inline-radio', options: ['center', 'bottom'] },
    className: { control: 'text' },
    children: { control: false }, onCloseFocus: { control: false }
  }
} satisfies Meta<typeof Modal>;
export default meta;
type Story = StoryObj<typeof meta>;

/** One question with two answers. Keeping the notes loses nothing, so it's the filled button. */
export const AQuestion: Story = {
  name: 'A question',
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    const answer = (said: string) => () => { did(said)(); args.onOpenChange(false); update({ open: false }); };
    return (
      <>
        <Button icon="trash" onClick={() => update({ open: true })}>Delete notes</Button>
        <Modal {...args} onOpenChange={(open) => { args.onOpenChange(open); update({ open }); }}>
          <div style={{ padding: '28px 28px 24px' }}>
            <div className="ac-eyebrow">Design review · Yesterday</div>
            <h2 className="ac-display-s" style={{ marginTop: 8 }}>Delete these notes for everyone?</h2>
            <p style={{ marginTop: 8, color: 'var(--ink-2)' }}>The summary, the decisions and the follow-ups go for good. Priya, Kofi and Aiko lose them too.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 22 }}>
              <Button variant="primary" onClick={answer('Keep them')}>Keep them</Button>
              <Button onClick={answer('Delete for everyone')}>Delete for everyone</Button>
            </div>
          </div>
        </Modal>
      </>
    );
  }
};

/** The host leaving a call: it rises from the bottom, over the night stage. Leave in the dock opens it again. */
export const LeavingACall: Story = {
  name: 'Leaving a call',
  ...onStage,
  args: { label: 'Leave the call', placement: 'bottom', className: 'ic-leave' },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    const close = () => { args.onOpenChange(false); update({ open: false }); };
    return (
      <>
        <CallDock>
          <DockButton icon="mic" label="Mute" onClick={did('Mute')} />
          <DockButton icon="video" label="Turn camera off" onClick={did('Turn camera off')} />
          <DockLeave onClick={() => update({ open: true })} />
        </CallDock>
        <Modal {...args} onOpenChange={(open) => { args.onOpenChange(open); update({ open }); }}>
          <div className="in">
            <div className="ac-eyebrow">Design review · 23 min</div>
            <h2 className="ac-display-s">Leave the call?</h2>
            <p>You organized this call. Ending it leaves everyone’s notes saved.</p>
            <div className="acts">
              <Button variant="primary" onClick={() => { did('End call for everyone')(); close(); }}>End call for everyone</Button>
              <Button variant="quiet" onClick={close}>Stay in the call</Button>
            </div>
          </div>
        </Modal>
      </>
    );
  }
};

/** Mostly to read: with `focusSelf` focus starts on the modal, not on its close button. */
export const MostlyToRead: Story = {
  name: 'Mostly to read',
  args: { label: 'Written in confidential compute', focusSelf: true },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return (
      <>
        <Button icon="sealed" onClick={() => update({ open: true })}>What was checked</Button>
        <Modal {...args} onOpenChange={(open) => { args.onOpenChange(open); update({ open }); }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 20px 4px 28px' }}>
            <h2 className="ac-title" style={{ flex: 1 }}>Written in confidential compute</h2>
            <IconButton icon="x" label="Close" onClick={() => { args.onOpenChange(false); update({ open: false }); }} />
          </div>
          <div style={{ display: 'grid', gap: 16, padding: '8px 28px 28px' }}>
            <p style={{ color: 'var(--ink-2)' }}>A confidential AI model wrote the notes for Design review. Alcove encrypts them in storage and shares them with the invited people.</p>
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '10px 24px', padding: '14px 16px', borderRadius: 'var(--radius-md)', background: 'var(--sunk)', fontSize: 13.5 }}>
              <dt style={{ color: 'var(--ink-3)' }}>Hardware checked</dt><dd style={{ fontVariantNumeric: 'tabular-nums' }}>Yesterday 11:45</dd>
              <dt style={{ color: 'var(--ink-3)' }}>Sealed</dt><dd>Audio, transcript, notes</dd>
              <dt style={{ color: 'var(--ink-3)' }}>Who can read them</dt><dd>Priya, Kofi, Aiko and you</dd>
            </dl>
          </div>
        </Modal>
      </>
    );
  }
};
