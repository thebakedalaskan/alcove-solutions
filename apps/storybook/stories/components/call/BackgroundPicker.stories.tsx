/*
 * BackgroundPicker: what shows behind someone on camera: Off, Blur with its strength, stable solid colors, Alcove's
 * pictures (SCENE_PICTURES), then the person's own with replace/remove controls, and Add image. It's stateless: the call's camera menu
 * and the pre-join screen give it the choice and the pictures kept in that browser, and draw the background themselves.
 */
import { BACKGROUND_SCENES, type CameraBackground } from '@alcove/api';
import { BackgroundPicker, BackgroundStatus, SCENE_PICTURES, type PickerPicture } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

const SCENES = BACKGROUND_SCENES.map((id) => ({ id, label: SCENE_PICTURES[id].label }));
/** Two pictures someone added, as made-up stand-ins. */
const OWN: PickerPicture[] = [
  { id: '6f9d2c1e-4b7a-4e0b-9c55-2f0e8d1a7b31', src: SCENE_PICTURES.office.thumb },
  { id: '0c3e8a5d-91f2-4d6b-a8e7-5b4c2d9f1e60', src: SCENE_PICTURES.beach.thumb }
];
const ACCEPT = 'image/jpeg,image/png,image/webp';

const meta = {
  title: 'Components/In a call/BackgroundPicker',
  component: BackgroundPicker,
  parameters: { layout: 'centered' },
  args: { value: { kind: 'none' }, scenes: SCENES, pictures: [], onPick: () => undefined, onAdd: () => undefined, onRemove: () => undefined, accept: ACCEPT },
  argTypes: {
    value: { control: 'object' },
    adding: { control: 'boolean' },
    full: { control: 'boolean' },
    scenes: { control: false },
    pictures: { control: false },
    onPick: { control: false },
    onAdd: { control: false },
    onRemove: { control: false },
    accept: { control: false }
  },
  decorators: [(Story) => <div className="ac-pop ic-dmenu"><div className="ac-eyebrow">Background</div><Story /></div>]
} satisfies Meta<typeof BackgroundPicker>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing chosen yet, and no pictures of their own: Add image stands in for them. */
export const Empty: Story = {};
/** Blur chosen. */
export const Blurred: Story = { args: { value: { kind: 'blur', strength: 'strong' } } };
export const MildBlur: Story = { name: 'Mild blur', args: { value: { kind: 'blur', strength: 'mild' } } };
export const SolidColor: Story = { name: 'A solid color', args: { value: { kind: 'color', id: 'slate' } } };
/** One of Alcove's pictures chosen. */
export const Scene: Story = { args: { value: { kind: 'scene', id: 'balloons' } } };
/** Pictures of their own, one chosen; hovering one shows its remove button. */
export const OwnPictures: Story = { name: 'Own pictures', args: { pictures: OWN, value: { kind: 'custom', id: OWN[0]?.id ?? '' } } };
/** A picture on its way in. */
export const Adding: Story = { args: { pictures: OWN, adding: true } };
export const Full: Story = { args: { pictures: Array.from({ length: 6 }, (_, i) => ({ id: `picture-${i}`, src: SCENE_PICTURES.office.thumb })), full: true, onReplace: () => undefined } };
export const Preparing: Story = { render: (args) => <><BackgroundPicker {...args} /><BackgroundStatus support="supported" quality="full" preparing cameraOn effectOn /></> };
export const ReducedQuality: Story = { name: 'Reduced quality, still covered', args: { value: { kind: 'color', id: 'sand' } }, render: (args) => <><BackgroundPicker {...args} /><BackgroundStatus support="supported" quality="light" preparing={false} cameraOn effectOn /></> };
export const CameraOff: Story = { name: 'Choosing with the camera off', args: { value: { kind: 'blur', strength: 'strong' } }, render: (args) => <><BackgroundPicker {...args} /><BackgroundStatus support="supported" quality="full" preparing={false} cameraOn={false} effectOn /></> };
export const Unsupported: Story = { render: () => <BackgroundStatus support="unsupported" quality="full" preparing={false} cameraOn={false} effectOn /> };
/** A guest, or a browser that can't keep pictures: no adding. */
export const Guest: Story = { render: ({ onAdd: _onAdd, ...args }) => <BackgroundPicker {...args} /> };
/** Choosing and removing, as in the camera's menu. */
export const Live: Story = {
  render: function Render(args) {
    const [value, setValue] = useState<CameraBackground>({ kind: 'none' });
    const [pictures, setPictures] = useState(OWN);
    return (
      <BackgroundPicker {...args} value={value} pictures={pictures} onPick={setValue}
        onReplace={(id) => setPictures((p) => p.map((x) => x.id === id ? { id, src: SCENE_PICTURES.balloons.thumb } : x))}
        onRemove={(id) => { setPictures((p) => p.filter((x) => x.id !== id)); if (value.kind === 'custom' && value.id === id) setValue({ kind: 'blur', strength: 'strong' }); }} />
    );
  }
};
