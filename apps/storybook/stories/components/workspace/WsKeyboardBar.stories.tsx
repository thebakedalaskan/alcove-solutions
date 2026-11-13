/*
 * WsKeyboardBar: the bar over a phone's keyboard while someone writes in a document, for what a phone has no keys for:
 * blocks (as `/` does), the text's style, @, photos and checklists, and Done to put the keyboard away. `lift` is how far
 * the keyboard has pushed it up; the app reads that from the visual viewport (features/workspace/document/KeyboardBar.tsx).
 */
import { WsKeyboardBar } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';

const meta = {
  title: 'Components/Workspace/WsKeyboardBar',
  component: WsKeyboardBar,
  args: { lift: 0, onBlock: did('add a block'), onStyle: did('text style'), onTag: did('tag someone'), onPhoto: did('add a photo'), onChecklist: did('checklist'), onDone: did('done') },
  argTypes: { onBlock: { control: false }, onStyle: { control: false }, onTag: { control: false }, onPhoto: { control: false }, onChecklist: { control: false }, onDone: { control: false } },
  globals: { viewport: { value: 'phone' } },
  parameters: { layout: 'fullscreen' }
} satisfies Meta<typeof WsKeyboardBar>;
export default meta;
type Story = StoryObj<typeof meta>;

/** No keyboard showing: the bar sits at the foot of the window. */
export const AtTheFoot: Story = {};
export const AtTheFootNight: Story = { globals: { theme: 'dark' } };
/** A keyboard 300 px tall: the bar rides on it. */
export const OverTheKeyboard: Story = { args: { lift: 300 } };
