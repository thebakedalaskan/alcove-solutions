import { CopyField } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { PREVIEW_DEPOSIT_ADDRESS } from '../../../src/world/plans/payments';

const meta = {
  title: 'Components/Forms/CopyField', component: CopyField,
  parameters: { layout: 'centered' }, args: { value: PREVIEW_DEPOSIT_ADDRESS, label: 'Deposit address' },
  argTypes: { value: { control: 'text' }, label: { control: 'text' } },
  decorators: [(Story) => <div style={{ width: 'min(420px, calc(100vw - 32px))' }}><Story /></div>]
} satisfies Meta<typeof CopyField>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Copy the full made-up value, then the tooltip says Copied. */
export const Address: Story = {};
export const Memo: Story = { args: { label: 'Memo', value: 'preview-reference-1284' } };
export const LongValueOnPhone: Story = {
  args: { value: `${PREVIEW_DEPOSIT_ADDRESS}-with-a-long-reference-for-a-narrow-screen` },
  globals: { viewport: { value: 'phone' } },
  decorators: [(Story) => <div style={{ width: 260 }}><Story /></div>]
};
export const Night: Story = { globals: { theme: 'dark' } };
