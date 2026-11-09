/*
 * SunLine: how much of your minutes of notes is left, drawn on a row's own hairline as a sun a `share` of the way along
 * it (0 to 1), with the line lit behind it. Settings' Plan and credits puts it on the Notes left row of its panel, so the
 * hairline under that row is the horizon. At nothing, the sun has set, and a little of its light is left at the start of the line.
 */
import { Button, SettingFact, SettingRow, SettingsGroup, SettingsPanel, SunLine } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { did } from '../../../src/component';

/** Settings' column, as the page lays it out. */
const sheet: Decorator = (Story) => <div className="set-groups" style={{ maxWidth: 940, margin: '0 auto' }}><Story /></div>;

/** The minutes of notes the month started with. */
const GRANTED = 400;
/** "2 h 40 min", as the page says it. */
function hoursAndMinutes(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  const h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
}
const clamp = (share: number) => (Number.isFinite(share) ? Math.max(0, Math.min(1, share)) : 0);

const meta = {
  title: 'Components/The evening/SunLine',
  component: SunLine,
  decorators: [sheet],
  args: { share: 0.4 },
  argTypes: { share: { control: { type: 'range', min: 0, max: 1, step: 0.01 } } },
  render: (args) => {
    const share = clamp(args.share);
    return (
      <SettingsGroup id="plan" title="Plan and credits">
        <SettingsPanel>
          <SettingRow className="is-left" label="Notes left" help="Calls without notes are free." control={<span className="set-left">{hoursAndMinutes(GRANTED * share)}</span>}>
            <SunLine {...args} />
          </SettingRow>
          <SettingRow label="Used this month" control={<SettingFact title="Since 00:00 UTC on the 1st">{share < 1 ? hoursAndMinutes(GRANTED * (1 - share)) : 'None yet'}</SettingFact>} />
          <SettingRow label="Add credits" help="Pay with a stablecoin from any wallet or exchange." control={<Button size="sm" icon="plus" onClick={did('onAdd')}>Add credits</Button>} />
        </SettingsPanel>
      </SettingsGroup>
    );
  }
} satisfies Meta<typeof SunLine>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Some left: the sun stands that far along the line, lit behind it. */
export const SomeLeft: Story = { name: 'Some left' };
/** All of it left: the sun at the end of the line. */
export const AllLeft: Story = { name: 'All left', args: { share: 1 } };
/** None left: the sun has set, and a little of its light stays at the start of the line. */
export const NoneLeft: Story = { name: 'None left', args: { share: 0 } };
export const SomeLeftNight: Story = { name: 'Some left, night', globals: { theme: 'dark' } };
