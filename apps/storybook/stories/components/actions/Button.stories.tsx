/*
 * Button: primary is the one thing a view is for (a solid sun fill, one per view), secondary the second choice, quiet
 * for Not now, Back and cancels. `buttonClass()` gives a link the same look.
 */
import { Button, ICON_NAMES, buttonClass } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Row, did } from '../../../src/component';

const meta = {
  title: 'Components/Actions/Button',
  component: Button,
  parameters: { layout: 'centered' },
  args: { children: 'Start a call', variant: 'secondary', size: 'md', loading: false, disabled: false, onClick: did('onClick') },
  argTypes: {
    variant: { control: 'inline-radio', options: ['primary', 'secondary', 'quiet'] },
    size: { control: 'inline-radio', options: ['xs', 'sm', 'md', 'lg'] },
    icon: { control: 'select', options: ICON_NAMES },
    iconRight: { control: 'select', options: ICON_NAMES },
    kb: { control: 'text' }
  }
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The one filled button in a view: the thing you came to do. */
export const Primary: Story = { args: { variant: 'primary', icon: 'video' } };
export const Secondary: Story = { args: { children: 'Schedule', icon: 'cal' } };
export const Quiet: Story = { args: { variant: 'quiet', children: 'Not now' } };
/** Busy: the icon becomes a spinner, and the label says what's happening. */
export const Loading: Story = { args: { variant: 'primary', icon: 'video', loading: true, children: 'Starting…' } };
export const Disabled: Story = { args: { variant: 'primary', disabled: true, children: 'Invite' } };
/** A keyboard hint after the label. */
export const WithShortcut: Story = { name: 'With a shortcut', args: { kb: 'N' } };
export const IconAfter: Story = { name: 'Icon after', args: { variant: 'quiet', children: 'Show fewer', iconRight: 'up' } };
/** Every size, from the 30px `xs` of a toolbar to the 52px `lg` of a hero. */
export const Sizes: Story = {
  render: (args) => (
    <Row>
      <Button {...args} size="xs">Extra small</Button>
      <Button {...args} size="sm">Small</Button>
      <Button {...args} size="md">Medium</Button>
      <Button {...args} size="lg">Large</Button>
    </Row>
  )
};
/** A link that looks like a button, with `buttonClass()`. */
export const AsALink: Story = {
  name: 'As a link',
  render: (args) => <a href="#notes" className={buttonClass({ variant: args.variant, size: args.size })}>Open notes</a>
};
