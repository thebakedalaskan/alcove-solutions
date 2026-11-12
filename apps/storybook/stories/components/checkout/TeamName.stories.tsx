import { TeamName } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { did } from '../../../src/component';
import { Step } from './parts';

/**
 * Starting a team: its name, typed into a box with its label inside, under what starting it makes you. It starts as the
 * company's name where the directory knows it, and can't be changed once the team is made.
 */
const meta = {
  title: 'Components/Checkout/TeamName', component: TeamName, parameters: { layout: 'centered' },
  args: { value: 'Vandelay Industries', onChange: did('onChange'), placeholder: 'Your company or team' },
  argTypes: { value: { control: 'text' }, disabled: { control: 'boolean' }, hint: { control: 'text' }, placeholder: { control: 'text' } },
  decorators: [(Story) => <Step><Story /></Step>],
  render: function Render(args) {
    const [, update] = useArgs<typeof args>();
    return <TeamName {...args} onChange={(name) => { args.onChange(name); update({ value: name }); }} />;
  }
} satisfies Meta<typeof TeamName>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The company's name, from its directory. */
export const Named: Story = {};
export const NamedNight: Story = { globals: { theme: 'dark' } };
/** Nobody's company known (a personal address): empty, waiting for one. */
export const Empty: Story = { args: { value: '' } };
/** The team is made already (a payment for it was refused): its name is what it is. */
export const Made: Story = { args: { disabled: true } };
export const Phone: Story = { globals: { viewport: { value: 'phone' } } };
