/*
 * SidebarNav: a group of the app's places in the side panel, which is dark in both themes: Home, Calls, Drive and Record
 * under Start a call, and Team and Agents at the foot. Each place is a router link with className="ac-nav-item" holding
 * NavItemContent: its icon, its name, and a count while something waits on you there (what's for you on Home, tags you
 * haven't seen in the Drive, recordings waiting to upload). The page you're on carries aria-current="page". Someone on
 * their own has no Team. At 860px and narrower the phone's tab bar takes its place.
 */
import { Icon, Kbd, Logo, NavItemContent, SidebarNav, buttonClass, cn, type IconName } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { useState, type MouseEvent } from 'react';
import { did } from '../../../src/component';

interface Place { to: string; icon: IconName; label: string; count?: number | undefined }
/** Your work on the busy afternoon: two things wait on you on Home, and a tag you haven't seen in the Drive. */
const WORK: Place[] = [
  { to: '/home', icon: 'home', label: 'Home', count: 2 },
  { to: '/calls', icon: 'calls', label: 'Calls' },
  { to: '/drive', icon: 'folderOpen', label: 'Drive', count: 1 },
  { to: '/record', icon: 'recordDot', label: 'Record' }
];
/** On your own: nothing waits on Home, and a recording waits on this device to upload. */
const ALONE: Place[] = [
  { to: '/home', icon: 'home', label: 'Home' },
  { to: '/calls', icon: 'calls', label: 'Calls' },
  { to: '/drive', icon: 'folderOpen', label: 'Drive' },
  { to: '/record', icon: 'recordDot', label: 'Record', count: 1 }
];
/** The foot: who works with you. Someone on their own has Agents alone. */
const FOOT: Place[] = [
  { to: '/team', icon: 'people', label: 'Team' },
  { to: '/agents', icon: 'agent', label: 'Agents' }
];

const navigate = did('navigate');

/** The places as links. Pressing one makes it the page you're on, as the router would. */
function Links({ places, start }: { places: Place[]; start: string }) {
  const [current, setCurrent] = useState(start);
  const go = (e: MouseEvent<HTMLAnchorElement>, to: string) => { e.preventDefault(); setCurrent(to); navigate(to); };
  return (
    <>
      {places.map((p) => (
        <a key={p.to} href={p.to} className="ac-nav-item" aria-current={current === p.to ? 'page' : undefined} onClick={(e) => go(e, p.to)}>
          <NavItemContent icon={p.icon} label={p.label} count={p.count} />
        </a>
      ))}
    </>
  );
}

/** The side panel's frame: dark in both themes, 256px wide, with the logo and Start a call above the places. */
const panel: Decorator = (Story) => (
  <aside className="sb dark" aria-label="Side panel" style={{ display: 'block', width: 256 }}>
    <div className="sb-in">
      <div className="sb-top"><span className="sb-home"><Logo /></span></div>
      <button type="button" className={cn(buttonClass(), 'sb-new')} aria-keyshortcuts="N" onClick={did('onNew')}>
        <span className="sb-new-ic"><Icon name="video" size={16} /></span><span>Start a call</span><Kbd>N</Kbd>
      </button>
      <Story />
    </div>
  </aside>
);

const meta = {
  title: 'Components/Layout/SidebarNav',
  component: SidebarNav,
  subcomponents: { NavItemContent },
  decorators: [panel],
  parameters: { layout: 'fullscreen' },
  args: { label: 'Main', children: <Links places={WORK} start="/home" /> },
  argTypes: { label: { control: 'text' }, children: { control: false }, className: { control: false } }
} satisfies Meta<typeof SidebarNav>;
export default meta;
type Story = StoryObj<typeof meta>;

/** On Home. A count sits at a place's end while something waits on you there. */
export const OnHome: Story = { name: 'On Home' };
/** On Calls: the page you're on is lit. */
export const OnCalls: Story = { name: 'On Calls', args: { children: <Links places={WORK} start="/calls" /> } };
/** Someone on their own. Record counts the recording waiting on this device to upload. */
export const OnTheirOwn: Story = { name: 'On their own', args: { children: <Links places={ALONE} start="/home" /> } };
/** The group at the foot of the panel, on Team: Team and Agents. */
export const AtTheFoot: Story = { name: 'At the foot', args: { label: 'Team and agents', children: <Links places={FOOT} start="/team" /> } };
