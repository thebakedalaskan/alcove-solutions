/*
 * AgentTokenReveal: a token, shown once, hidden but for its first and last four characters, with Copy. `problem` says
 * when copying didn't work. In Settings it sits in the Agents panel, opened in place under the token's title, with a
 * foot whose Done puts it away for good.
 */
import { AgentTokenReveal, Button, SettingFoot, SettingsPanel, SettingStep } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { PREVIEW_AGENT_TOKEN } from '../../../src/api/agents';
import { did } from '../../../src/component';

/** The Agents panel, the token just made. */
const inPanel: Decorator = (Story) => (
  <div className="set-groups" style={{ maxWidth: 940, margin: '0 auto' }}>
    <SettingsPanel title="Agents">
      <SettingStep title="Weekly digest script can use Alcove until 4 Dec" help="This token shows once. Copy it into your script now."><Story /></SettingStep>
      <SettingFoot actions={<Button variant="primary" onClick={did('onDone')}>Done</Button>}>Disconnect it here whenever you like. Alcove keeps only a sealed fingerprint of it.</SettingFoot>
    </SettingsPanel>
  </div>
);

const meta = {
  title: 'Components/Settings/AgentTokenReveal', component: AgentTokenReveal,
  decorators: [inPanel],
  args: { token: PREVIEW_AGENT_TOKEN, onCopy: did('onCopy') },
  argTypes: { token: { control: 'text' }, problem: { control: 'text' }, onCopy: { control: false } }
} satisfies Meta<typeof AgentTokenReveal>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A deliberately invalid preview token, hidden as the real one is. */
export const IssuedOnce: Story = {};
export const IssuedOnceNight: Story = { name: 'Issued once, night', globals: { theme: 'dark' } };
export const IssuedOncePhone: Story = { name: 'Issued once, phone', globals: { viewport: { value: 'phone' } } };
/** Copying didn't work: it says so under the token. */
export const CopyUnavailable: Story = { args: { problem: 'Copy wasn’t available. Try again.' } };
