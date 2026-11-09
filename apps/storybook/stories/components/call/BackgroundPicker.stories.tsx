/*
 * BackgroundPicker: the choices in Background's window, in groups: Blur (Off, Light, Strong), Alcove's Pictures
 * (SCENE_PICTURES), Colours, and Yours, the person's own pictures with Replace and Remove, then Add. The one in use is ringed.
 * It's stateless: the window (BackgroundModal) holds it, and the app gives it the choice and the pictures kept in that
 * browser and draws the background itself. What can't be added is said under Yours, in the refusal's own words.
 */
import { BACKGROUND_SCENES, type CameraBackground } from '@alcove/api';
import { BackgroundPicker, SCENE_PICTURES, type PickerPicture } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { ModalFrame, did, onStage } from '../../../src/component';

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
  ...onStage,
  args: { value: { kind: 'none' }, scenes: SCENES, pictures: [], onPick: did('onPick'), onAdd: did('onAdd'), onRemove: did('onRemove'), most: 6, accept: ACCEPT },
  argTypes: {
    value: { control: 'object' },
    adding: { control: 'boolean' },
    most: { control: 'number' },
    ownNote: { control: 'text' },
    problem: { control: 'text' },
    scenes: { control: false },
    pictures: { control: false },
    onPick: { control: false },
    onAdd: { control: false },
    onRemove: { control: false },
    onReplace: { control: false },
    accept: { control: false }
  },
  // In the window's surface, on the night stage the window opens over.
  decorators: [(Story) => <ModalFrame><div style={{ width: 'min(400px, calc(100vw - 32px))', padding: 24 }}><Story /></div></ModalFrame>, ...onStage.decorators]
} satisfies Meta<typeof BackgroundPicker>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing behind you yet, and no pictures of your own: Add stands in for them. */
export const Off: Story = {};
export const LightBlur: Story = { name: 'Light blur', args: { value: { kind: 'blur', strength: 'mild' } } };
export const StrongBlur: Story = { name: 'Strong blur', args: { value: { kind: 'blur', strength: 'strong' } } };
/** One of Alcove's pictures. */
export const APicture: Story = { name: 'A picture', args: { value: { kind: 'scene', id: 'beach' } } };
export const AColour: Story = { name: 'A colour', args: { value: { kind: 'color', id: 'slate' } } };
/** Pictures of their own, one in use; hovering one shows Replace and Remove. */
export const YourOwn: Story = { name: 'Your own pictures', args: { pictures: OWN, value: { kind: 'custom', id: OWN[0]?.id ?? '' }, onReplace: did('onReplace') } };
/** A picture on its way in. */
export const Adding: Story = { args: { pictures: OWN, adding: true } };
/** Six kept: Add gives way to how many can be kept. */
export const Full: Story = {
  name: 'Six kept',
  args: { pictures: Array.from({ length: 6 }, (_, i) => ({ id: `picture-${i}`, src: (i % 2 ? SCENE_PICTURES.beach : SCENE_PICTURES.office).thumb })), onReplace: did('onReplace') }
};
/** A picture that wasn't taken: the refusal says what's allowed, under Yours. */
export const Refused: Story = { name: 'A picture refused', args: { pictures: OWN, problem: 'That picture is over 20 MB. Pick a smaller one.' } };
/** Reading the pictures kept in this browser. */
export const Loading: Story = { name: 'Reading your pictures', args: { pictures: null } };
/** A guest, signed out: no pictures of their own, and Yours says how to have them. */
export const Guest: Story = { render: ({ onAdd: _onAdd, ...args }) => <BackgroundPicker {...args} ownNote="Sign in to add pictures of your own." /> };
/** Choosing, replacing and removing, as in the window. Removing the one in use puts strong blur in its place. */
export const Live: Story = {
  render: function Render(args) {
    const [value, setValue] = useState<CameraBackground>({ kind: 'none' });
    const [pictures, setPictures] = useState(OWN);
    return (
      <BackgroundPicker {...args} value={value} pictures={pictures} onPick={setValue}
        onReplace={(id) => setPictures((p) => p.map((x) => (x.id === id ? { id, src: SCENE_PICTURES.balloons.thumb } : x)))}
        onRemove={(id) => { setPictures((p) => p.filter((x) => x.id !== id)); if (value.kind === 'custom' && value.id === id) setValue({ kind: 'blur', strength: 'strong' }); }} />
    );
  }
};
