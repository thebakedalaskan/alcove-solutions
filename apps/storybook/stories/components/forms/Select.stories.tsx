/*
 * Select: picks one of a list. A button shows the current choice; pressing it opens a listbox placed like a Popover, which
 * turns upward near the bottom of the window and scrolls when it's long. Arrow keys, Home and End move, Enter or Space
 * picks, Escape or Tab closes without changing anything, and typing jumps to the option whose name starts with it. It
 * keeps its own open state, so every story here starts closed: press it to open the list. `placeholder` shows when
 * nothing is chosen, and `stage` is for the night recorder and the call.
 */
import { CryptoMark, ICON_NAMES, Select, Unencrypted, type SelectOption } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did, onStage } from '../../../src/component';

/** The languages notes can be written in, as Settings offers them. */
const LANGUAGES: SelectOption<string>[] = [
  { value: 'call', label: 'Same as the call' }, { value: 'en', label: 'English' }, { value: 'es', label: 'Spanish' }, { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' }, { value: 'pt', label: 'Portuguese' }, { value: 'it', label: 'Italian' }, { value: 'nl', label: 'Dutch' },
  { value: 'ja', label: 'Japanese' }, { value: 'zh', label: 'Chinese' }, { value: 'ko', label: 'Korean' }, { value: 'hi', label: 'Hindi' }, { value: 'ar', label: 'Arabic' }
];

/** The demo browser's microphones, by the names people know them by. */
const MICROPHONES: SelectOption<string>[] = [
  { value: 'mic-built-in', label: 'Built-in microphone', icon: 'mic' },
  { value: 'mic-desk', label: 'Desk microphone', icon: 'mic' },
  { value: 'mic-headset', label: 'Headset microphone', icon: 'mic' }
];

/** A meeting room's inputs, each once with the system's saying so, as the app lists devices: more than the list shows at once. */
const ROOM_INPUTS: SelectOption<string>[] = [
  ...MICROPHONES.map((m) => (m.value === 'mic-built-in' ? { ...m, note: 'Your system’s choice' } : m)),
  { value: 'cam-desk', label: 'Desk camera', icon: 'video' },
  { value: 'display', label: 'Display', icon: 'monitor' },
  { value: 'phone', label: 'Phone, through this computer', icon: 'phone' },
  { value: 'room-front', label: 'Room microphone, front', icon: 'mic' },
  { value: 'room-back', label: 'Room microphone, back', icon: 'mic' },
  { value: 'interface-1', label: 'Audio interface, input 1', icon: 'mic' },
  { value: 'interface-2', label: 'Audio interface, input 2', icon: 'mic' }
];

/** AI models: the default is noted, and two aren't in a secure enclave. */
const MODELS: SelectOption<string>[] = [
  { value: 'enclave', label: 'Vandelay Private 70B', note: '(default)' },
  { value: 'fast', label: 'Vandelay Private 8B' },
  { value: 'open-a', label: 'Open Model A', tag: <Unencrypted compact /> },
  { value: 'open-b', label: 'Open Model B with a very long name that has to be cut', tag: <Unencrypted compact /> }
];

const values = (options: SelectOption<string>[]) => options.map((o) => o.value);

const meta = {
  title: 'Components/Forms/Select',
  component: Select,
  parameters: { layout: 'centered' },
  args: { label: 'Notes language', value: 'en', options: LANGUAGES, align: 'start', stage: false, disabled: false, onChange: did('onChange') },
  argTypes: {
    value: { control: 'select', options: values(LANGUAGES) },
    icon: { control: 'select', options: ICON_NAMES },
    placeholder: { control: 'text' },
    align: { control: 'inline-radio', options: ['start', 'center', 'end'] },
    options: { control: false }, className: { control: false }
  },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <Select {...args} onChange={(value) => { args.onChange(value); update({ value }); }} />;
  }
} satisfies Meta<typeof Select>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Settings' notes language. Pick another and the button shows it; the list marks the chosen one with a tick. */
export const WithAChoice: Story = { name: 'With a choice' };
/** A meeting room's inputs, each with its icon: the list scrolls, and opens with the chosen one in the middle. */
export const ALongList: Story = {
  name: 'A long list',
  args: { label: 'Microphone', icon: 'mic', value: 'room-front', options: ROOM_INPUTS },
  argTypes: { value: { control: 'select', options: values(ROOM_INPUTS) } }
};
/** A note after the first option's name, and a badge on the two that aren't in an enclave. Pressing a badge still picks the option. */
export const WithNotesAndTags: Story = {
  name: 'With notes and tags',
  args: { label: 'Model', value: 'enclave', options: MODELS },
  argTypes: { value: { control: 'select', options: values(MODELS) } }
};
/** An unencrypted choice shows its badge on the button too. */
export const TaggedChoice: Story = {
  name: 'Tagged choice',
  args: { label: 'Model', value: 'open-a', options: MODELS },
  argTypes: { value: { control: 'select', options: values(MODELS) } }
};
/** Nothing chosen yet: the placeholder says what's used meanwhile. */
export const Placeholder: Story = {
  args: { label: 'Microphone', icon: 'mic', value: undefined, placeholder: 'Default microphone', options: MICROPHONES },
  argTypes: { value: { control: 'select', options: values(MICROPHONES) } }
};
/** No microphone plugged in: there's nothing to pick, and the button says so. */
export const Disabled: Story = { args: { label: 'Microphone', icon: 'micOff', value: undefined, placeholder: 'No microphone', options: [], disabled: true } };
/** The same network mark appears in the list and beside the chosen value. */
export const NetworkMarks: Story = {
  args: {
    label: 'Network', value: 'base', options: [
      { value: 'base', label: 'Base', mark: <CryptoMark name="base" /> },
      { value: 'sol', label: 'Solana', mark: <CryptoMark name="sol" /> },
      { value: 'near', label: 'NEAR', mark: <CryptoMark name="near" /> }
    ]
  },
  argTypes: { value: { control: 'select', options: ['base', 'sol', 'near'] } }
};
export const TokenMarks: Story = {
  args: {
    label: 'Token', value: undefined, placeholder: 'Token', options: [
      { value: 'USDC', label: 'USDC', mark: <CryptoMark name="USDC" /> },
      { value: 'USDT', label: 'USDT', mark: <CryptoMark name="USDT" /> }
    ]
  },
  argTypes: { value: { control: 'select', options: ['USDC', 'USDT'] } }
};
/** On the night recorder: the microphone to record with, centred under its button. */
export const OnTheStage: Story = {
  name: 'On the stage',
  ...onStage,
  args: { label: 'Microphone', icon: 'mic', value: 'mic-desk', options: MICROPHONES, stage: true, align: 'center' },
  argTypes: { value: { control: 'select', options: values(MICROPHONES) } }
};
