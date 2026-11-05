/*
 * ProviderButton: Continue with Google or Microsoft, on the sign-in card. A full-width pill with the provider's own mark
 * pinned left. While the provider's page opens it's `busy`: the mark becomes a spinner, the label says what's happening,
 * and it can't be pressed again. `disabled` greys it out while another way in is under way.
 */
import { ProviderButton } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, Stack, did } from '../../../src/component';

const meta = {
  title: 'Components/Actions/ProviderButton',
  component: ProviderButton,
  parameters: { layout: 'centered' },
  args: { provider: 'google', children: 'Continue with Google', busy: false, disabled: false, onClick: did('onClick') },
  argTypes: { provider: { control: 'inline-radio', options: ['google', 'microsoft'] } },
  render: (args) => <Box width="min(360px, calc(100vw - 32px))" height="auto"><ProviderButton {...args} /></Box>
} satisfies Meta<typeof ProviderButton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Google: Story = {};
export const Microsoft: Story = { args: { provider: 'microsoft', children: 'Continue with Microsoft' } };
/** Google's page is opening: the mark becomes a spinner and the label says so. */
export const Busy: Story = { args: { busy: true, children: 'Opening Google…' } };
/** While Google's page opens, Microsoft's button waits, greyed out. */
export const Disabled: Story = { args: { provider: 'microsoft', children: 'Continue with Microsoft', disabled: true } };
/** Both, one under the other, as the sign-in card offers them. */
export const Both: Story = {
  render: (args) => (
    <Box width="min(360px, calc(100vw - 32px))" height="auto">
      <Stack>
        <ProviderButton provider="google" onClick={args.onClick}>Continue with Google</ProviderButton>
        <ProviderButton provider="microsoft" onClick={args.onClick}>Continue with Microsoft</ProviderButton>
      </Stack>
    </Box>
  )
};
