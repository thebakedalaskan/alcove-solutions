/*
 * SunLine: how much of a plan's notes (or storage) is left, drawn on a row's own hairline as a sun a `share` of the way along
 * it (0 to 1), with the line lit behind it. Settings' Plan puts it on the Notes left this period row, so the hairline under
 * it is the horizon. At nothing, the sun has set, and a little of its light is left at the start of the line.
 */
import { SettingFact, SettingRow, SettingsGroup, SettingsPanel, SunLine } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';

/** Settings' column, as the page lays it out. */
const sheet: Decorator = (Story) => <div className="set-groups" style={{ maxWidth: 940, margin: '0 auto' }}><Story /></div>;

/** The minutes of notes a period brings on Free. */
const GRANTED = 300;
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
      <SettingsGroup id="plan" title="Plan">
        <SettingsPanel>
          <SettingRow className="is-left" label="Notes left this period" help={share > 0 ? 'Back to 5 hours on 20 November. Calls without notes are free.' : 'Calls go on without notes until 20 November.'} problem={share === 0}
            control={<span className={share > 0 ? 'set-left' : 'set-left is-out'}>{share > 0 ? <><small>About</small>{hoursAndMinutes(GRANTED * share)}</> : 'None'}</span>}>
            <SunLine {...args} />
          </SettingRow>
          <SettingRow label="Storage" help="Uploads and call recordings. Files up to 512 MB." control={<SettingFact icon="hardDrive">2.1 GB of 10 GB</SettingFact>} />
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
