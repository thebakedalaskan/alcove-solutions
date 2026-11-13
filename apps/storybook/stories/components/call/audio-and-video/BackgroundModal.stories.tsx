/*
 * BackgroundModal: Background, in a window of its own, from the pre-join's Background and the camera's menu in a call. A big
 * live preview on the left with what shows behind you named on it, the choices on the right (BackgroundPicker), how the
 * background stands under the preview (BackgroundStatus), and Done. Picking applies at once; Done or Escape closes. On a
 * phone it's a sheet: the preview on top, the choices scrolling under it. Here the camera is drawn from Alcove's own pictures
 * (the Office picture is "your room"), never a real camera; Calls/Camera effects has the real pipeline.
 */
import { BACKGROUND_SCENES, type CameraBackground } from '@alcove/api';
import { BackgroundModal, BackgroundPicker, BackgroundStatus, Button, CAMERA_COLORS, SCENE_PICTURES, backgroundLabel, type PickerPicture } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type CSSProperties } from 'react';
import { did, onStage } from '../../../../src/component';

const SCENES = BACKGROUND_SCENES.map((id) => ({ id, label: SCENE_PICTURES[id].label }));
const OWN: PickerPicture[] = [{ id: '6f9d2c1e-4b7a-4e0b-9c55-2f0e8d1a7b31', src: SCENE_PICTURES.balloons.thumb }];
const FILL: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' };

/** What the camera shows with `b` behind you, drawn: the Office picture as your room, plain or blurred, or what's chosen. */
function Look({ b }: { b: CameraBackground }) {
  if (b.kind === 'color') return <span style={{ ...FILL, background: `rgb(${CAMERA_COLORS[b.id].rgb.join(' ')})` }} />;
  const src = b.kind === 'scene' ? SCENE_PICTURES[b.id].src : b.kind === 'custom' ? SCENE_PICTURES.balloons.src : SCENE_PICTURES.office.src;
  return <img src={src} alt="" style={b.kind === 'blur' ? { ...FILL, filter: `blur(${b.strength === 'mild' ? 4 : 12}px)`, transform: 'scale(1.06)' } : FILL} />;
}

interface Setup {
  start: CameraBackground;
  camera?: boolean;
  preparing?: boolean;
  quality?: 'full' | 'balanced' | 'light';
  support?: 'checking' | 'supported' | 'unsupported';
  guest?: boolean;
}

const meta = {
  title: 'Components/In a call/Audio and video/BackgroundModal',
  component: BackgroundModal,
  ...onStage,
  args: { open: true, onOpenChange: did('onOpenChange'), person: { name: 'Art Vandelay' }, video: null, children: null },
  argTypes: { video: { control: false }, person: { control: false }, status: { control: false }, foot: { control: false }, onCloseFocus: { control: false }, children: { control: false } }
} satisfies Meta<typeof BackgroundModal>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The window as the app fills it, with Background (behind it) to open it again once it's closed. */
function Window({ args, setup }: { args: Story['args']; setup: Setup }) {
  const { start, camera = true, preparing = false, quality = 'full', support = 'supported', guest = false } = setup;
  const [open, setOpen] = useState(args?.open ?? true);
  const [value, setValue] = useState<CameraBackground>(start);
  const [pictures, setPictures] = useState<PickerPicture[]>(guest ? [] : OWN);
  const on = value.kind !== 'none';
  const close = (o: boolean) => { did('onOpenChange')(o); setOpen(o); };
  return (
    <>
      <Button icon="image" onClick={() => setOpen(true)}>Background</Button>
      <BackgroundModal open={open} onOpenChange={close} person={{ name: 'Art Vandelay' }} video={camera ? <Look b={value} /> : null}
        shows={on ? backgroundLabel(value) : null} preparing={preparing}
        status={support === 'supported' && <BackgroundStatus support={support} quality={quality} preparing={preparing} cameraOn={camera} effectOn={on} />}
        foot={support === 'supported' && !guest && 'Your pictures stay in this browser, sealed for your account.'}>
        {support === 'supported' ? (
          <BackgroundPicker value={value} scenes={SCENES} pictures={pictures} onPick={setValue} accept="image/jpeg,image/png,image/webp"
            onAdd={guest ? undefined : did('onAdd')} onReplace={guest ? undefined : did('onReplace')} most={guest ? undefined : 6}
            onRemove={(id) => { setPictures((p) => p.filter((x) => x.id !== id)); if (value.kind === 'custom' && value.id === id) setValue({ kind: 'blur', strength: 'strong' }); }}
            ownNote={guest ? 'Sign in to add pictures of your own.' : undefined} />
        ) : (
          <div className="ac-bgpick-groups">
            <BackgroundStatus support={support} quality={quality} preparing={false} cameraOn={camera} effectOn={on} />
            {support === 'unsupported' && on && <div><Button size="sm" onClick={() => setValue({ kind: 'none' })}>Choose Off</Button></div>}
          </div>
        )}
      </BackgroundModal>
    </>
  );
}

/** A picture behind you, seen on you before anyone else sees it. Pick another and the preview changes at once. */
export const APicture: Story = { name: 'A picture', render: (args) => <Window args={args} setup={{ start: { kind: 'scene', id: 'beach' } }} /> };
/** Nothing behind you yet: your room as the camera sees it. */
export const Off: Story = { render: (args) => <Window args={args} setup={{ start: { kind: 'none' } }} /> };
export const StrongBlur: Story = { name: 'Strong blur', render: (args) => <Window args={args} setup={{ start: { kind: 'blur', strength: 'strong' } }} /> };
/** The camera's off: your arch, and the background waits for the camera. */
export const CameraOff: Story = { name: 'Camera off', render: (args) => <Window args={args} setup={{ start: { kind: 'blur', strength: 'mild' }, camera: false }} /> };
/** Getting a background ready: the camera stays covered meanwhile. */
export const Preparing: Story = { render: (args) => <Window args={args} setup={{ start: { kind: 'color', id: 'sand' }, preparing: true }} /> };
/** A busy device: the background is drawn more simply for a while, and stays on. */
export const ReducedQuality: Story = { name: 'Reduced quality', render: (args) => <Window args={args} setup={{ start: { kind: 'color', id: 'slate' }, quality: 'light' }} /> };
/** A guest has blur, Alcove's pictures and the colours. */
export const Guest: Story = { render: (args) => <Window args={args} setup={{ start: { kind: 'none' }, guest: true }} /> };
/** A browser that can't draw camera effects, with blur chosen on another: Choose Off. */
export const Unsupported: Story = { render: (args) => <Window args={args} setup={{ start: { kind: 'blur', strength: 'strong' }, support: 'unsupported' }} /> };
/** On a phone: a sheet, the preview on top and the choices scrolling under it. */
export const OnAPhone: Story = {
  name: 'On a phone',
  render: (args) => <Window args={args} setup={{ start: { kind: 'scene', id: 'balloons' } }} />,
  globals: { viewport: { value: 'phone', isRotated: false } }
};
