/*
 * Logo: the mark with the wordmark, "alcove", in the page's ink. It heads the side panel, the phone's top bar and the
 * pages someone reaches without signing in. The side panel is the dark frame in both themes, so the logo there is in
 * the dark theme's ink on `bg-frame`. `size` is the mark's height; the wordmark keeps its own size.
 */
import { Logo } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Row } from '../../../src/component';

const meta = {
  title: 'Components/Icons and marks/Logo',
  component: Logo,
  parameters: { layout: 'centered' },
  args: { size: 26 },
  argTypes: { size: { control: { type: 'range', min: 16, max: 64, step: 1 } } }
} satisfies Meta<typeof Logo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
/** 22 in the phone's top bar and the welcome page's foot, 25 in the welcome page's top bar, 26 everywhere else. */
export const Sizes: Story = {
  render: () => (
    <Row>
      <Logo size={22} />
      <Logo size={25} />
      <Logo size={26} />
    </Row>
  )
};
/** At the top of the side panel: the frame is dark in both themes, so the logo takes the dark theme's ink. */
export const OnTheFrame: Story = {
  name: 'On the frame',
  render: (args) => (
    <div className="dark bg-frame rounded-lg px-6 py-5">
      <Logo {...args} />
    </div>
  )
};
