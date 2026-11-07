/*
 * Share, from the dock: one popover over Share, always at night, whose steps take each other's place. First what you can
 * present straight away (ShareKinds): your screen, a board or the workspace, with Stop sharing while you share something.
 * Your screen asks a tab, a window or your whole screen, and its sound (ShareScreenStep); a board is the board picker as a
 * step (BoardPicker with `step`). Each later step has Share's step head (ShareStepHead) to go back. On a phone it's a sheet.
 * Press through it: each story starts on a step and goes on from there.
 */
import { BoardMenuThumb, BoardPicker, CallDock, cn, DockButton, DockLeave, DockSeparator, Popover, ShareKinds, ShareScreenStep, ShareStepHead, type BoardMenuAccess, type BoardPickerInCall, type ShareSurfaceKind } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { did, onStage } from '../../../src/component';

/** The team's boards, from more than one workspace: each says whose it is and where. */
const TEAM = {
  workspace: '',
  boards: [
    { id: 'retro', name: 'Launch retro', by: 'Priya · Product', when: 'Today', thumb: <BoardMenuThumb kind="columns" /> },
    { id: 'onboarding', name: 'Onboarding flow', by: 'Aiko · Design', when: 'Mon', thumb: <BoardMenuThumb kind="flow" /> }
  ]
};
const SYSTEM = 'Your computer isn’t letting the browser share its screen. On a Mac, turn your browser on in System Settings › Privacy & Security › Screen & System Audio Recording, then reopen it. A tab can be shared without that.';
const SOUND: Record<ShareSurfaceKind, string | null> = { browser: 'Also share the tab’s sound', window: null, monitor: 'Also share your computer’s sound' };

/** Under 600px the call is a phone's, whatever the story says: as the app does there. */
const onAPhone = (): boolean => typeof window !== 'undefined' && window.matchMedia('(max-width: 599px)').matches;

/** The dock, with Share's popover open over it (a sheet on a phone): pressing Share closes and opens it again. */
function OverDock({ phone: asked, children }: { phone: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const phone = asked || onAPhone();
  return (
    <div style={{ position: 'relative', width: '100%', height: 'calc(100vh - 80px)' }}>
      <footer className="ic-dockbar" style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <CallDock>
          <DockButton icon="mic" label="Mute" />
          <DockButton icon="video" label="Turn camera off" />
          {!phone && <DockSeparator />}
          <Popover open={open} onOpenChange={setOpen} side="top" align="center" stage label="Share with everyone" className={cn('ic-sharepop', phone && 'is-sheet')}
            anchor={<DockButton icon="screen" label="Share" word="Share" on={open} />}>
            {children}
          </Popover>
          {!phone && <DockButton icon="hand" label="Raise your hand" />}
          <DockButton icon="more" label="More" />
          {!phone && <DockSeparator />}
          <DockLeave>Leave</DockLeave>
        </CallDock>
      </footer>
    </div>
  );
}

type Step = 'kinds' | 'screen' | 'board';

/** Share's steps as the call keeps them: what you press moves you on, and back returns to the first. */
function ShareFlow({ kinds, start = 'kinds', phone = false, read = 'on', trouble = null, changing = false, blocked, inCall, access }: {
  kinds: ComponentProps<typeof ShareKinds>; start?: Step | undefined; phone?: boolean | undefined;
  read?: 'on' | 'paused' | null | undefined; trouble?: string | null | undefined; changing?: boolean | undefined;
  blocked?: string | undefined; inCall?: BoardPickerInCall | undefined; access?: BoardMenuAccess | undefined;
}) {
  const [step, setStep] = useState<Step>(start);
  const [surface, setSurface] = useState<ShareSurfaceKind>('browser');
  const [sound, setSound] = useState(true);
  const back = () => { did('Back to Share')(); setStep('kinds'); };
  const b = kinds.board;
  const toBoard = 'onPress' in b ? b.onPress : null;
  const soundSays = SOUND[surface];
  return (
    <OverDock phone={phone}>
      {step === 'screen' ? (
        <ShareScreenStep surface={surface} onSurface={(s) => { did('surface')(s); setSurface(s); }}
          sound={soundSays ? { label: soundSays, on: sound, onChange: (on) => { did('sound')(on); setSound(on); } } : null}
          read={read} trouble={trouble} changing={changing} onBack={back} onShare={did('Share')} />
      ) : step === 'board' ? (
        <BoardPicker step={{ onBack: back }} recents={TEAM} inCall={inCall} blocked={blocked} access={access}
          onTemplate={did('onTemplate')} onRecent={did('onRecent')} />
      ) : (
        <ShareKinds {...kinds} onScreen={() => { kinds.onScreen(); setStep('screen'); }}
          board={toBoard ? { onPress: () => { toBoard(); setStep('board'); } } : b} />
      )}
    </OverDock>
  );
}

const meta = {
  title: 'Components/In a call/ShareMenu',
  component: ShareKinds,
  subcomponents: { ShareStepHead, ShareScreenStep, BoardPicker },
  ...onStage,
  args: { sharing: null, screenWhy: null, onScreen: did('Your screen'), board: { onPress: did('A board') }, workspace: { onPress: did('The workspace') } },
  argTypes: { sharing: { control: false }, board: { control: false }, workspace: { control: false }, screenWhy: { control: 'text' } },
  render: (args) => <ShareFlow kinds={args} />
} satisfies Meta<typeof ShareKinds>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Your screen, a board or the workspace: the workspace is presented straight away; the others take one more step. */
export const Kinds: Story = {};
/** While you share your screen it says so first, with Stop sharing; Share again changes what you share. */
export const KindsWhileSharing: Story = { name: 'Kinds, while sharing', args: { sharing: { what: 'your screen', onStop: did('Stop sharing') } } };
/** On a phone, as a sheet: a phone can't share its screen, so it says why and the row can't be pressed. */
export const KindsOnAPhone: Story = {
  name: 'Kinds, on a phone',
  args: { screenWhy: 'Sharing a screen needs a computer' },
  render: (args) => <ShareFlow kinds={args} phone />,
  globals: { viewport: { value: 'phone', isRotated: false } }
};
/** Your screen: a tab, with its sound, while notes are on and read what's shared. Then the browser asks which tab. */
export const ScreenStep: Story = { name: 'Screen step', render: (args) => <ShareFlow kinds={args} start="screen" /> };
/** The last try didn't start: why, and what to do, over the same choices. */
export const ScreenStepTrouble: Story = { name: 'Screen step, with trouble', render: (args) => <ShareFlow kinds={args} start="screen" trouble={SYSTEM} /> };
/** Sharing already, with notes paused: Share this instead. */
export const ScreenStepChanging: Story = { name: 'Screen step, sharing already', render: (args) => <ShareFlow kinds={args} start="screen" read="paused" changing /> };
/** A board: a new one from a template, or one the team has, presented to everyone as it opens. */
export const BoardStep: Story = { name: 'Board step', render: (args) => <ShareFlow kinds={args} start="board" /> };
/** Priya presents the launch retro: it's first, to join, and a new board waits until she stops. */
export const BoardStepSomeonePresenting: Story = {
  name: 'Board step, someone presenting',
  render: (args) => (
    <ShareFlow kinds={args} start="board" blocked="Priya is presenting a board. You can start one once they stop."
      inCall={{ name: 'Launch retro', by: 'Priya is presenting it', onOpen: did('Launch retro') }} />
  )
};
/** Theo and Sam can't open the onboarding flow: let them in for this call, or present it without them. */
export const BoardStepAccess: Story = {
  name: 'Board step, someone can’t open it',
  render: (args) => (
    <ShareFlow kinds={args} start="board"
      access={{ names: ['Theo', 'Sam'], board: 'Onboarding flow', where: 'Aiko’s workspace', onLetIn: did('Let them in for this call'), onWithout: did('Present without them') }} />
  )
};
