/*
 * SunMark: a paid plan's own small sun, in the side panel's icon column: a 12px half sun on a 16px hairline with its glint
 * under it, lined up with the check's shield above it. `setting` sinks it to half of that while the plan is ending. The
 * side panel is dark in both themes, so it stands on the panel's own night here.
 */
import { Icon, SunMark } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';

/** The foot of the side panel, as the mark sits in it: the check above, the plan's row with its name and until when. */
const inTheFoot: Decorator = (Story, { args }) => (
  <aside className="sb dark" style={{ position: 'static', height: 'auto', width: 256 }}>
    <div className="sb-in" style={{ height: 'auto' }}>
      <div className="sb-foot">
        <p className="sb-seal"><Icon name="sealed" size={15} />Confidential compute</p>
        <span className="sb-pro">
          <Story />
          <span className="min-w-0"><b>Pro</b>{args['state'] === 'setting' ? <small className="is-warm">Ends in 6 days · Extend</small> : <small>Until 4 Nov 2027</small>}</span>
          <Icon name="chevron" size={15} />
        </span>
      </div>
    </div>
  </aside>
);

const meta = {
  title: 'Components/Icons and marks/SunMark', component: SunMark,
  decorators: [inTheFoot], parameters: { layout: 'centered' }, args: { state: 'up' },
  argTypes: { state: { control: 'inline-radio', options: ['up', 'setting'] }, className: { control: false } }
} satisfies Meta<typeof SunMark>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Pro running: the sun half risen on its line. */
export const Up: Story = {};
/** Pro ending: the same sun, half set. */
export const Setting: Story = { args: { state: 'setting' } };
export const UpLight: Story = { ...Up, name: 'Up, light page', globals: { theme: 'light' } };
export const SettingNight: Story = { ...Setting, name: 'Setting, night page', globals: { theme: 'dark' } };
