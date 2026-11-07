/*
 * CallDock: what you do in the call, in one floating bar at the bottom of the stage, always at night. Each control is a
 * DockButton: a device that's switched off turns solid (`off`), what's yours running is lit (`on`), a device that can't
 * work right now gets a caution mark (`alert`), a `tip` shows above a button on hover and focus, and Share says its `word`.
 * The microphone and camera are DockSplits, with a DockChevron that opens their menus; DockSeparators group the rest:
 * Share, Raise your hand and More, then Leave, always last. In focus the dock tucks away to the microphone, the camera,
 * Show everything and Leave. In the call it sits in the dock bar, which makes it bigger to the thumb on a phone, where it's
 * the microphone, the camera, Share, More and Leave.
 */
import { CallDock, DockButton, DockChevron, DockLeave, DockSeparator, DockSplit, DockWords, ICON_NAMES } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { did, onStage } from '../../../src/component';

const pressed = {
  mic: did('microphone'), micMenu: did('microphone menu'), cam: did('camera'), camMenu: did('camera menu'), share: did('share'),
  hand: did('hand'), more: did('more'), back: did('show everything'), leave: did('leave')
};

/** How the call's dock starts; pressing it changes it from there, as in the call. */
interface Start {
  mic?: boolean | undefined; cam?: boolean | undefined; blocked?: boolean | undefined; presenting?: boolean | undefined;
  hand?: boolean | undefined; more?: boolean | undefined;
  /** The microphone's menu is open. */
  menu?: boolean | undefined;
  /** Which button has the focus, so its tip shows as it does on hover. */
  tip?: 'mic' | 'share' | undefined;
  leaving?: boolean | undefined;
  /** On a phone the hand is in More. */
  phone?: boolean | undefined;
  /** In focus: Show everything, before Leave. */
  focus?: boolean | undefined;
}

/** The dock's controls as the call has them: the microphone and camera, then Share, the hand and More, then Leave. */
function Controls({ mic: micFirst = true, cam: camFirst = true, blocked = false, presenting = false, hand: handFirst = false, more: moreFirst = false,
  menu = false, tip, leaving = false, phone = false, focus = false }: Start) {
  const [mic, setMic] = useState(micFirst && !blocked);
  const [cam, setCam] = useState(camFirst);
  const [hand, setHand] = useState(handFirst);
  const [more, setMore] = useState(moreFirst);
  const focused = useRef<HTMLButtonElement>(null);
  useEffect(() => { focused.current?.focus(); }, []);

  const micSays = blocked ? 'Microphone blocked' : mic ? 'Mute' : 'Unmute';
  const camSays = cam ? 'Turn camera off' : 'Turn camera on';
  const shareSays = presenting ? 'Presenting' : 'Share';
  const handSays = hand ? 'Lower your hand' : 'Raise your hand';
  return (
    <>
      <DockSplit className="keep">
        <DockButton ref={tip === 'mic' ? focused : undefined} icon={mic ? 'mic' : 'micOff'} label={micSays} off={!mic} alert={blocked}
          tip={blocked ? 'Microphone blocked. Press to see how to fix it' : micSays} onClick={() => { pressed.mic(); if (!blocked) setMic(!mic); }} />
        <DockChevron label="Microphone and speaker" on={menu} onClick={() => pressed.micMenu()} />
      </DockSplit>
      <DockSplit className="keep">
        <DockButton icon={cam ? 'video' : 'videoOff'} label={camSays} off={!cam} tip={camSays} onClick={() => { pressed.cam(); setCam(!cam); }} />
        <DockChevron label="Camera and background" onClick={() => pressed.camMenu()} />
      </DockSplit>
      <DockSeparator />
      <DockButton ref={tip === 'share' ? focused : undefined} icon="screen" label={shareSays} word={shareSays} on={presenting}
        tip={presenting ? 'Change what you share' : 'Share a tab, window or screen'} onClick={() => pressed.share()} />
      {!phone && <DockButton icon="hand" label={handSays} tip={handSays} on={hand} onClick={() => { pressed.hand(); setHand(!hand); }} />}
      <DockButton icon="more" label="More: captions, catch up, rooms, devices" tip="More: captions, catch up, rooms, devices" on={more} onClick={() => { pressed.more(); setMore(!more); }} />
      <DockSeparator />
      {focus && <DockWords icon="shrink" className="keep" onClick={() => pressed.back()}>Show everything</DockWords>}
      <DockLeave className="keep" disabled={leaving} onClick={() => pressed.leave()}>Leave</DockLeave>
    </>
  );
}

/**
 * The bar the dock sits in at the bottom of the call, which makes it bigger to the thumb on a phone. The call keeps a 16px
 * gutter there and the frame keeps 24px, so the bar reaches into the frame's to have the room the call gives it.
 */
const DockBar = ({ children }: { children: ReactNode }) => <div style={{ marginInline: -16 }}><footer className="ic-dockbar">{children}</footer></div>;

const meta = {
  title: 'Components/In a call/CallDock',
  component: CallDock,
  subcomponents: { DockButton, DockSplit, DockChevron, DockSeparator, DockWords, DockLeave },
  ...onStage,
  args: { label: 'Call controls', children: <Controls /> },
  argTypes: { children: { control: false }, className: { control: false } },
  render: (args) => <DockBar><CallDock {...args} /></DockBar>
} satisfies Meta<typeof CallDock>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The dock as the call has it. Press anything: devices switch, the hand goes up, More is lit while it's open. */
export const InTheCall: Story = { name: 'In the call' };
export const MicrophoneOff: Story = { name: 'Microphone off', args: { children: <Controls mic={false} /> } };
export const CameraOff: Story = { name: 'Camera off', args: { children: <Controls cam={false} /> } };
/** Sharing your screen: Share says Presenting, lit, and pressing it again is how you change what you share. */
export const Presenting: Story = { args: { children: <Controls presenting /> } };
export const HandRaised: Story = { name: 'Hand raised', args: { children: <Controls hand /> } };
/** More, lit while it's open over the dock. */
export const MoreOpen: Story = { name: 'More open', args: { children: <Controls more /> } };
/**
 * The browser blocked the microphone: it's off, with the caution mark, and its tip says what to do. It has the focus here,
 * as Tab would give it, so the tip shows as it does on hover.
 */
export const MicrophoneBlocked: Story = { name: 'Microphone blocked', args: { children: <Controls blocked tip="mic" /> } };
/** A tip says more than the button's name. Share has the focus here, so its tip shows as it does on hover. */
export const Tip: Story = { args: { children: <Controls tip="share" /> } };
/** The chevron beside the microphone, lit while its menu is open. */
export const MenuOpen: Story = { name: 'Menu open', args: { children: <Controls menu /> } };
/** Leaving: Leave can't be pressed twice while the call ends. */
export const Leaving: Story = { args: { children: <Controls leaving /> } };
/** In focus, what's open fills the window and the dock tucks away: the microphone, the camera, Show everything and Leave. */
export const InFocus: Story = { name: 'In focus', args: { tucked: true, children: <Controls focus /> } };
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
/** On a phone the bar makes the targets bigger: the chevrons and hairlines go, Share and Leave keep only their icons, and the hand is in More. */
export const Phone: Story = { args: { children: <Controls phone /> }, globals: { viewport: { value: 'phone', isRotated: false } } };

/** One button and every state it has, from Controls. */
export const Button: StoryObj<typeof DockButton> = {
  args: { icon: 'screen', label: 'Share', word: 'Share', off: false, on: false, alert: false, badge: 0, tip: 'Share a tab, window or screen', disabled: false, onClick: did('onClick') },
  argTypes: { icon: { control: 'select', options: ICON_NAMES }, tip: { control: 'text' } },
  render: (args) => <CallDock><DockButton {...args} /></CallDock>
};
