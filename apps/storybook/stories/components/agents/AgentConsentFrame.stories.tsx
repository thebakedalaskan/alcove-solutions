/*
 * AgentConsentFrame: the sheet an agent's `/connect` shows before Agents asks: signing in first, no request, or the
 * sign-in being checked. One quiet column on the theme's ground, with the mark above it. Signed in, `/connect` hands over
 * to Agents, which asks on its sky.
 */
import { AgentConsentFrame, EmptyState, ProviderButton, Spinner } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';

const meta = {
  title: 'Components/Agents/AgentConsentFrame', component: AgentConsentFrame, parameters: { layout: 'fullscreen' },
  args: {
    title: 'Sign in to connect your agent',
    children: <><p>Choose which account your agent can use. You’ll review its permissions after signing in.</p><ProviderButton provider="google" onClick={did('onSignIn')}>Continue with Google</ProviderButton></>
  },
  argTypes: { title: { control: 'text' }, children: { control: false } }
} satisfies Meta<typeof AgentConsentFrame>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SignInFirst: Story = { name: 'Sign in first' };
export const SignInFirstNight: Story = { ...SignInFirst, name: 'Sign in first, night', globals: { theme: 'dark' } };
export const NoRequest: Story = {
  name: 'No request',
  args: { title: 'Connect an agent', children: <EmptyState title="Open the connection from your agent">The agent will send you here to choose its permissions.</EmptyState> }
};
export const CheckingSignIn: Story = { name: 'Checking the sign-in', args: { title: 'Connect an agent', children: <p role="status"><Spinner /> Checking your sign-in…</p> } };
