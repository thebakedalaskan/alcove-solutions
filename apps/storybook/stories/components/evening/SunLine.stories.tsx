/*
 * SunLine: how much of your minutes of notes is left, drawn on a row's own hairline as a sun a `share` of the way along
 * it (0 to 1), with the line lit behind it. Settings' Plan and credits puts it on the Notes left row, so the hairline
 * under that row is the horizon. At nothing, the sun has set, and a little of its light is left at the start of the line.
 */
import { SettingFact, SettingRow, SettingsPart, SunLine } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';

/** Settings' sheet, as the page lays it out: one column of parts, every control on the same axis. */
const sheet: Decorator = (Story) => (
  <div className="set" style={{ position: 'relative', isolation: 'isolate', marginTop: 0 }}>
    <div className="set-parts" style={{ maxWidth: 820 }}><Story /></div>
  </div>
);

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
      <SettingsPart id="plan" title="Plan and credits">
        <SettingRow className="is-left" label="Notes left" control={<span className="set-left">{hoursAndMinutes(GRANTED * share)}</span>}>
          <SunLine {...args} />
        </SettingRow>
        <SettingRow label="Used this month" control={<SettingFact title="Since 00:00 UTC on the 1st">{share < 1 ? hoursAndMinutes(GRANTED * (1 - share)) : 'None yet'}</SettingFact>} />
        <SettingRow label="Calls without notes" control={<SettingFact>Free</SettingFact>} />
      </SettingsPart>
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
