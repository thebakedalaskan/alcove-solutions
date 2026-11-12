/*
 * Evening: a page on the evening. The scene (Horizon) runs out to the frame's edges behind it, and the page stands in
 * front at its own width. A page sets where the horizon falls with --hz in its stylesheet, as tall as the page is one
 * action, and these stories set it the same way. The app's main column gives --page-x, the page's side margin, and on a
 * phone a page gives itself its height; here the story does both. Record's page is night in both themes: the app turns
 * the whole document dark for it, and here the page is scoped dark and takes its text colour from that scope. So is the night
 * after a call, which the page a call leaves you on draws for itself (In a call › CallOver). Whatever passes through comes at
 * random.
 */
import { Card, Evening, Faces, PlanSunset, type Moment } from '@alcove/ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AIKO, KOFI, PRIYA } from '../../../src/world/people';

const MOMENTS = ['home', 'team', 'agents', 'calls', 'drive', 'plans', 'note', 'settings', 'record', 'after'] as const satisfies readonly Moment[];
/** Where each page has the horizon, as its stylesheet sets --hz. */
const PAGE_HZ: Record<Moment, string> = {
  home: 'clamp(352px, 45vh, 540px)',
  team: 'clamp(322px, 40vh, 470px)',
  agents: 'clamp(330px, 41vh, 470px)',
  calls: 'calc(8px + clamp(112px, 13vh, 128px))',
  drive: 'calc(8px + clamp(220px, 26vh, 300px))',
  plans: '262px',
  note: 'calc(8px + clamp(158px, 18.5vh, 196px))',
  settings: '136px',
  record: 'calc(8px + clamp(424px, 55vh, 700px))',
  after: '84dvh'
};
/** What Plans draws on its own sky: the last sliver of the sun, where its moment has none. */
const SUNSET = <PlanSunset />;
const PAGE: Record<Moment, string> = { home: 'Home', team: 'Team', agents: 'Agents', calls: 'Calls', drive: 'Drive', plans: 'Plans', note: 'Design review', settings: 'Settings', record: 'Record', after: 'Team standup has ended' };
/** The night, whatever the theme: Record, and after a call. */
const NIGHT: ReadonlySet<Moment> = new Set<Moment>(['record', 'after']);

const meta = {
  title: 'Components/The evening/Evening',
  component: Evening,
  parameters: { layout: 'fullscreen' },
  args: { moment: 'calls', children: null },
  argTypes: { moment: { control: 'inline-radio', options: MOMENTS }, children: { control: false }, className: { control: false }, sky: { control: false } },
  render: (args) => (
    <Evening {...args} sky={args.sky ?? (args.moment === 'plans' ? SUNSET : undefined)} className={NIGHT.has(args.moment) ? 'dark' : undefined} style={{ '--hz': PAGE_HZ[args.moment], '--page-x': 'clamp(28px, 3.4vw, 60px)', color: 'var(--ink)', minHeight: '100dvh' }}>
      {/* The heading stands in the sky, so the card starts on the horizon: the page's top padding is 30px, 6px on a phone. */}
      <header className="flex min-h-[calc(var(--hz)-6px)] items-end pb-6 min-[861px]:min-h-[calc(var(--hz)-30px)]">
        <h1 className="ac-display-m">{PAGE[args.moment]}</h1>
      </header>
      <Card title="Design review" aside={<Faces people={[PRIYA, KOFI, AIKO]} size={26} />} className="max-w-[560px]" style={{ '--d': 1 }}>
        <p className="text-[13px] text-ink-3">Yesterday 11:00 · 45 min</p>
        <p className="mt-2.5 text-[14.5px] leading-[1.5] text-ink-2">The sidebar reads better dark. One filled button per view from now on.</p>
      </Card>
    </Evening>
  )
} satisfies Meta<typeof Evening>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Notes, just after sunset: the sky a third of the window, the list on the sea. */
export const Notes: Story = {};
/** Home, the sunset: all sky, as the page is one action. */
export const Home: Story = { args: { moment: 'home' } };
/** Team: the sun low and to the left. */
export const Team: Story = { args: { moment: 'team' } };
/** The Drive: a little later than Notes, less glow on the water and the first stars. */
export const Drive: Story = { args: { moment: 'drive' } };
/** Plans: just after sunset, a long low glow, and the last sliver of the sun, which the page draws on the sky (`sky`). */
export const Plans: Story = { args: { moment: 'plans' } };
/** A note: a slim band of sky. */
export const ANote: Story = { name: 'A note', args: { moment: 'note' } };
/** Settings: the last of the light, mostly page. */
export const Settings: Story = { args: { moment: 'settings' } };
/** Record: night, in both themes. */
export const Record: Story = { args: { moment: 'record' } };
/** After a call: night in both themes, a crescent moon and the glow on the horizon. The page a call leaves you on draws it itself. */
export const AfterACall: Story = { name: 'After a call', args: { moment: 'after' } };
