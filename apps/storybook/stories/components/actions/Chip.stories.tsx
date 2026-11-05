/*
 * Chip: a fact about something, never something to press. Neutral by default; sun for chosen or ready, horizon for
 * information, caution for a problem (there is no alarm red), outline for something switched off. An icon can lead it.
 * A chip stays on one line, so it grows with its words: keep them few.
 */
import { Chip, ICON_NAMES } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Row } from '../../../src/component';

const meta = {
  title: 'Components/Actions/Chip',
  component: Chip,
  parameters: { layout: 'centered' },
  args: { tone: 'neutral', children: 'Ready' },
  argTypes: {
    tone: { control: 'inline-radio', options: ['neutral', 'sun', 'horizon', 'caution', 'outline'] },
    icon: { control: 'select', options: ICON_NAMES },
    children: { control: 'text' }
  }
} satisfies Meta<typeof Chip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = {};
/** Chosen or ready. */
export const Sun: Story = { args: { tone: 'sun', children: 'Sealed' } };
/** Information. */
export const Horizon: Story = { args: { tone: 'horizon', children: 'Shared with you' } };
/** A problem, said calmly. */
export const Caution: Story = { args: { tone: 'caution', children: 'Couldn’t be read' } };
/** Something switched off, or not done. */
export const Outline: Story = { args: { tone: 'outline', children: 'Not read' } };
/** An icon before the words: a follow-up nobody has done for three calls. */
export const WithAnIcon: Story = { name: 'With an icon', args: { tone: 'caution', icon: 'clock', children: 'Not done 3 calls later' } };
/** The longest the app writes. It stays on one line, so it's as wide as its words. */
export const LongText: Story = { name: 'Long text', args: { tone: 'sun', icon: 'sealed', children: 'Writing in confidential compute' } };
/** Every tone, each with the icon it usually has. */
export const AllTones: Story = {
  name: 'All tones',
  render: () => (
    <Row>
      <Chip icon="mic">Microphone on</Chip>
      <Chip tone="sun" icon="sealed">Sealed</Chip>
      <Chip tone="horizon" icon="share">Shared with you</Chip>
      <Chip tone="caution" icon="eyeOff">Couldn’t be read</Chip>
      <Chip tone="outline" icon="videoOff">Camera off</Chip>
    </Row>
  )
};
