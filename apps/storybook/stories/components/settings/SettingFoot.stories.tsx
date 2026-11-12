/*
 * SettingFoot: the foot of something open in place: a short line to know (13px, in ink-3), and its buttons at the right
 * (`actions`), which go under the line on a phone. `sub` lines it up with the rows nested above it, as Google Drive's
 * foot does under its folder and files.
 */
import { Button, DriveExportDisclosure, ProviderMark, SettingFact, SettingFoot, SettingRow, SettingsPanel, Switch } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';

/** Settings' column, as the page lays it out. */
const column: Decorator = (Story) => <div className="set-groups" style={{ maxWidth: 940, margin: '0 auto' }}><Story /></div>;

const meta = {
  title: 'Components/Settings/SettingFoot',
  component: SettingFoot,
  decorators: [column],
  args: { sub: true, children: <DriveExportDisclosure />, actions: <Button variant="quiet" onClick={did('onDisconnect')}>Disconnect Google Drive</Button> },
  argTypes: { sub: { control: 'boolean' }, children: { control: false }, actions: { control: false }, className: { control: false } },
  render: (args) => (
    <SettingsPanel>
      <SettingRow label="Google Drive" mark={<ProviderMark provider="google" />} help="After each call: notes and transcript to Call notes."
        control={<><SettingFact icon="check" tone="yes">Exporting</SettingFact><Button size="sm" iconRight="up" aria-expanded onClick={did('onDone')}>Done</Button></>} />
      <SettingRow sub label="Export after each call" help="Files upload in the background, even after you leave." control={<Switch label="Export after each call" checked onChange={did('onChange')} />} />
      <SettingFoot {...args} />
    </SettingsPanel>
  )
} satisfies Meta<typeof SettingFoot>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Under rows nested in a connection: what happens to the copies, and the way out. */
export const UnderSubRows: Story = { name: 'Under sub rows' };
export const UnderSubRowsNight: Story = { ...UnderSubRows, name: 'Under sub rows, night', globals: { theme: 'dark' } };
export const UnderSubRowsPhone: Story = { ...UnderSubRows, name: 'Under sub rows, phone', globals: { viewport: { value: 'phone' } } };
