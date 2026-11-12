import { CheckoutSteps } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Step } from './parts';

/** Choose, Pay, Done at the window's head: the step you're at filled, those before it shaded. On a phone, the numbers alone. */
const meta = {
  title: 'Components/Checkout/CheckoutSteps', component: CheckoutSteps, parameters: { layout: 'centered' },
  args: { at: 1 }, argTypes: { at: { control: 'inline-radio', options: [1, 2, 3] } },
  decorators: [(Story) => <Step width={360}><Story /></Step>]
} satisfies Meta<typeof CheckoutSteps>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Choosing: Story = {};
export const Paying: Story = { args: { at: 2 } };
export const Done: Story = { args: { at: 3 } };
export const Night: Story = { args: { at: 2 }, globals: { theme: 'dark' } };
