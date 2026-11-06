import { AgentConsentFrame, AgentDisclosure, Button, EmptyState, Spinner } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';

const meta = {
  title: 'Components/Settings/AgentConsentFrame', component: AgentConsentFrame, parameters: { layout: 'fullscreen' },
  args: { title: 'Connect your agent', children: <><p><strong>Workspace assistant</strong> wants access to your Alcove account.</p><AgentDisclosure /><Button variant="primary" onClick={did('onContinue')}>Continue</Button></> },
  argTypes: { title: { control: 'text' }, children: { control: false } }
} satisfies Meta<typeof AgentConsentFrame>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Connection: Story = {};
export const Loading: Story = { args: { title: 'Connect an agent', children: <p role="status"><Spinner /> Loading the request…</p> } };
export const Ended: Story = { args: { title: 'Connection unavailable', children: <EmptyState title="This request ended">It expired or has already been answered. Start connecting again from your agent.</EmptyState> } };
