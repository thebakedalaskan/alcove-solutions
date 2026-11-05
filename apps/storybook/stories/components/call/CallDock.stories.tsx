/*
 * CallDock: the call's controls in one floating bar at the bottom of the stage, always at night. Each control is a
 * DockButton: a device that's switched off turns solid (`off`), an open panel or a running share is lit (`on`), a device
 * that can't work right now gets a caution mark (`alert`), chat counts what's new (`badge`), and a `tip` shows above a
 * button on hover and focus. The microphone, camera and captions are DockSplits, with a DockChevron that opens their
 * menus; DockSeparators group the rest, and Leave is always last. In the call it sits in the dock bar, which makes it
 * smaller on a phone.
 */
import { CallDock, DockButton, DockChevron, DockLeave, DockSeparator, DockSplit, ICON_NAMES } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { did, onStage } from '../../../src/component';

const pressed = {
  mic: did('microphone'), micMenu: did('microphone menu'), cam: did('camera'), camMenu: did('camera menu'), share: did('share'),
  hand: did('hand'), captions: did('captions'), captionsMenu: did('caption language'), notes: did('notes'), chat: did('chat'),
  more: did('more'), leave: did('leave')
};

/** How the call's dock starts; pressing it changes it from there, as in the call. */
interface Start {
  mic?: boolean | undefined; cam?: boolean | undefined; blocked?: boolean | undefined; sharing?: boolean | undefined;
  hand?: boolean | undefined; captions?: boolean | undefined; panel?: 'notes' | 'chat' | null | undefined; unread?: number | undefined;
  /** The microphone's menu is open. */
  menu?: boolean | undefined;
  /** Which button has the focus, so its tip shows as it does on hover. */
  tip?: 'mic' | 'captions' | undefined;
  leaving?: boolean | undefined;
}

/** The dock's controls as the call has them: microphone, camera, share, hand and captions, then notes, chat and more, then Leave. */
function Controls({ mic: micFirst = true, cam: camFirst = true, blocked = false, sharing = false, hand: handFirst = false, captions: ccFirst = false,
  panel: panelFirst = null, unread: unreadFirst = 2, menu = false, tip, leaving = false }: Start) {
  const [mic, setMic] = useState(micFirst && !blocked);
  const [cam, setCam] = useState(camFirst);
  const [hand, setHand] = useState(handFirst);
  const [cc, setCc] = useState(ccFirst);
  const [panel, setPanel] = useState(panelFirst);
  const [unread, setUnread] = useState(panelFirst === 'chat' ? 0 : unreadFirst);
  const focused = useRef<HTMLButtonElement>(null);
  useEffect(() => { focused.current?.focus(); }, []);

  const micSays = blocked ? 'Microphone blocked' : mic ? 'Mute' : 'Unmute';
  const camSays = cam ? 'Turn camera off' : 'Turn camera on';
  const shareSays = sharing ? 'Change what you share' : 'Share a tab, window or screen';
  const handSays = hand ? 'Lower your hand' : 'Raise your hand';
  const ccSays = cc ? 'Turn off captions' : 'Turn on captions';
  const flip = (p: 'notes' | 'chat') => {
    setPanel(panel === p ? null : p);
    if (p === 'chat') setUnread(0);
  };
  return (
    <>
      <DockSplit>
        <DockButton ref={tip === 'mic' ? focused : undefined} icon={mic ? 'mic' : 'micOff'} label={micSays} off={!mic} alert={blocked}
          tip={blocked ? 'Microphone blocked. Press to see how to fix it' : micSays} onClick={() => { pressed.mic(); if (!blocked) setMic(!mic); }} />
        <DockChevron label="Microphone and speaker" on={menu} onClick={() => pressed.micMenu()} />
      </DockSplit>
      <DockSplit>
        <DockButton icon={cam ? 'video' : 'videoOff'} label={camSays} off={!cam} tip={camSays} onClick={() => { pressed.cam(); setCam(!cam); }} />
        <DockChevron label="Camera and background" onClick={() => pressed.camMenu()} />
      </DockSplit>
      <DockButton icon="screen" label={shareSays} tip={shareSays} on={sharing} onClick={() => pressed.share()} />
      <DockButton icon="hand" label={handSays} tip={handSays} on={hand} onClick={() => { pressed.hand(); setHand(!hand); }} />
      <DockSplit>
        <DockButton ref={tip === 'captions' ? focused : undefined} icon="captions" label={ccSays} tip={`${ccSays} · the call is still transcribed for notes`} on={cc}
          onClick={() => { pressed.captions(); setCc(!cc); }} />
        <DockChevron label="Caption language" onClick={() => pressed.captionsMenu()} />
      </DockSplit>
      <DockSeparator />
      <DockButton icon="notesPen" label="Notes" tip="Notes" on={panel === 'notes'} onClick={() => { pressed.notes(); flip('notes'); }} />
      <DockButton icon="chat" label={unread ? `Chat, ${unread} new` : 'Chat'} tip="Chat" on={panel === 'chat'} badge={unread} onClick={() => { pressed.chat(); flip('chat'); }} />
      <DockButton icon="more" label="More: catch up, settings" onClick={() => pressed.more()} />
      <DockSeparator />
      <DockLeave disabled={leaving} onClick={() => pressed.leave()}>Leave</DockLeave>
    </>
  );
}

/**
 * The bar the dock sits in at the bottom of the call, which makes it smaller on a phone. The call keeps an 8px gutter
 * there and the frame keeps 24px, so the bar reaches into the frame's to have the room the call gives it.
 */
const DockBar = ({ children }: { children: ReactNode }) => <div style={{ marginInline: -16 }}><footer className="ic-dockbar">{children}</footer></div>;

const meta = {
  title: 'Components/In a call/CallDock',
  component: CallDock,
  subcomponents: { DockButton, DockSplit, DockChevron, DockSeparator, DockLeave },
  ...onStage,
  args: { label: 'Call controls', children: <Controls /> },
  argTypes: { children: { control: false }, className: { control: false } },
  render: (args) => <DockBar><CallDock {...args} /></DockBar>
} satisfies Meta<typeof CallDock>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The dock as the call has it, with two new messages in chat. Press anything: devices switch, panels open, and chat is read. */
export const InTheCall: Story = { name: 'In the call' };
export const MicrophoneOff: Story = { name: 'Microphone off', args: { children: <Controls mic={false} /> } };
export const CameraOff: Story = { name: 'Camera off', args: { children: <Controls cam={false} /> } };
/** A panel open: Notes is lit while it shows. */
export const PanelOpen: Story = { name: 'Panel open', args: { children: <Controls panel="notes" /> } };
/** Sharing your screen: Share stays lit, and pressing it again is how you change what you share. */
export const Sharing: Story = { args: { children: <Controls sharing /> } };
export const HandRaised: Story = { name: 'Hand raised', args: { children: <Controls hand /> } };
/**
 * The browser blocked the microphone: it's off, with the caution mark, and its tip says what to do. It has the focus here,
 * as Tab would give it, so the tip shows as it does on hover.
 */
export const MicrophoneBlocked: Story = { name: 'Microphone blocked', args: { children: <Controls blocked tip="mic" /> } };
/** A tip says more than the button's name. Captions has the focus here, so its tip shows as it does on hover. */
export const Tip: Story = { args: { children: <Controls tip="captions" /> } };
/** The chevron beside the microphone, lit while its menu is open. */
export const MenuOpen: Story = { name: 'Menu open', args: { children: <Controls menu /> } };
/** Leaving: Leave can't be pressed twice while the call ends. */
export const Leaving: Story = { args: { children: <Controls leaving /> } };
/** Before joining: only the microphone and camera, over your own preview. */
export const BeforeJoining: Story = {
  name: 'Before joining',
  args: {
    label: 'Microphone and camera',
    children: (
      <>
        <DockButton icon="mic" label="Turn microphone off" onClick={() => pressed.mic()} />
        <DockButton icon="videoOff" label="Turn camera on" off onClick={() => pressed.cam()} />
      </>
    )
  },
  render: (args) => <CallDock {...args} />
};
/** On a phone the bar makes the dock smaller: the buttons shrink, the chevrons go, and Leave keeps only its icon. */
export const Phone: Story = { globals: { viewport: { value: 'phone', isRotated: false } } };

/** One button and every state it has, from Controls. */
export const Button: StoryObj<typeof DockButton> = {
  args: { icon: 'chat', label: 'Chat, 2 new', off: false, on: false, alert: false, badge: 2, tip: 'Chat', disabled: false, onClick: did('onClick') },
  argTypes: { icon: { control: 'select', options: ICON_NAMES }, tip: { control: 'text' } },
  render: (args) => <CallDock><DockButton {...args} /></CallDock>
};
