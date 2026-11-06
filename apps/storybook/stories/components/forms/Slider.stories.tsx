/*
 * Slider: one value along a track, such as how loud someone is for you. The browser's own range input, so arrow keys
 * move it a step, Page Up and Page Down further, and Home and End to either end; the sun fills the track up to the
 * thumb. `mark` draws a notch where the usual value sits. `valueText` is what a screen reader says, such as "60%".
 */
import { Slider } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { Box, did } from '../../../src/component';

const pct = (v: number) => `${Math.round(v * 100)}%`;

const meta = {
  title: 'Components/Forms/Slider',
  component: Slider,
  parameters: { layout: 'centered' },
  args: { value: 0.6, min: 0, max: 1, step: 0.05, label: 'How loud Priya is for you', disabled: false, onChange: did('onChange') },
  argTypes: {
    value: { control: { type: 'range', min: 0, max: 1, step: 0.05 } },
    mark: { control: { type: 'range', min: 0, max: 1, step: 0.05 } },
    valueText: { control: 'text' }
  },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <Box width={280} height="auto"><Slider {...args} onChange={(value) => { args.onChange(value); update({ value }); }} /></Box>;
  }
} satisfies Meta<typeof Slider>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Drag it, or focus it and use the arrow keys. */
export const Default: Story = {};
/** A notch where the usual value sits: full volume. */
export const WithAMark: Story = { name: 'With a mark', args: { mark: 1 } };
export const Disabled: Story = { args: { disabled: true } };
/** What a screen reader says moves with the value, and the volume row shows the same beside it. */
export const WithValueText: Story = {
  name: 'With value text',
  args: { valueText: pct(0.6) },
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return (
      <Box width={320} height="auto">
        <span className="flex items-center gap-3">
          <Slider {...args} onChange={(value) => { args.onChange(value); update({ value, valueText: pct(value) }); }} />
          <span className="w-10 text-right text-[13px] text-ink-2 tabular-nums">{args.valueText}</span>
        </span>
      </Box>
    );
  }
};
