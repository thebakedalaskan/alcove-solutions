/*
 * SidebarNav: a group of the app's places in the side panel, which is dark in both themes: Home, Calls, Drive, Record and
 * Team under Start a call, and Agents at the foot. Each place is a router link with className="ac-nav-item" holding
 * NavItemContent: its icon, its name, and a count while something waits on you there (what's for you on Home, tags you
 * haven't seen in the Drive, recordings waiting to upload). Home's count is a link of its own (NavCount): pointing at it
 * says what's waiting, by For you's tabs, and pressing it lands on For you. The page you're on carries aria-current="page".
 * Someone on their own has no Team. At 860px and narrower the phone's tab bar takes its place.
 */
import { Icon, Kbd, Logo, NavCount, NavItemContent, SidebarNav, buttonClass, cn, type IconName } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { useState, type MouseEvent } from 'react';
import { did } from '../../../src/component';

interface Place { to: string; icon: IconName; label: string; count?: number | undefined; says?: string | undefined }
/** Your work on the busy afternoon: two things wait on you on Home, and a tag you haven't seen in the Drive. */
const WORK: Place[] = [
  { to: '/home', icon: 'home', label: 'Home', count: 2, says: 'For you: 1 to answer, 1 follow-up' },
  { to: '/calls', icon: 'calls', label: 'Calls' },
  { to: '/drive', icon: 'folderOpen', label: 'Drive', count: 1 },
  { to: '/record', icon: 'recordDot', label: 'Record' },
  { to: '/team', icon: 'people', label: 'Team' }
];
/** On your own: no Team, nothing waits on Home, and a recording waits on this device to upload. */
const ALONE: Place[] = [
  { to: '/home', icon: 'home', label: 'Home' },
  { to: '/calls', icon: 'calls', label: 'Calls' },
  { to: '/drive', icon: 'folderOpen', label: 'Drive' },
  { to: '/record', icon: 'recordDot', label: 'Record', count: 1 }
];
/** The foot: Agents, which everyone has, someone on their own too. */
const FOOT: Place[] = [
  { to: '/agents', icon: 'agent', label: 'Agents' }
];

const navigate = did('navigate');

/**
 * The places as links. Pressing one makes it the page you're on, as the router would. A count that says what it counts
 * (Home's) is a link of its own, to For you on Home.
 */
function Links({ places, start }: { places: Place[]; start: string }) {
  const [current, setCurrent] = useState(start);
  const go = (e: MouseEvent<HTMLAnchorElement>, to: string) => { e.preventDefault(); setCurrent(to); navigate(to); };
  return (
    <>
      {places.map((p) => {
        const row = (
          <a key={p.to} href={p.to} className="ac-nav-item" aria-current={current === p.to ? 'page' : undefined} onClick={(e) => go(e, p.to)}>
            <NavItemContent icon={p.icon} label={p.label} count={p.says ? undefined : p.count} />
          </a>
        );
        return p.count && p.says ? (
          <NavCount key={p.to} row={row} n={p.count} says={p.says}
            link={(props) => <a {...props} href={`${p.to}#for-you`} onClick={(e) => go(e, p.to)} />} />
        ) : row;
      })}
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
  subcomponents: { NavItemContent, NavCount },
  decorators: [panel],
  parameters: { layout: 'fullscreen' },
  args: { label: 'Main', children: <Links places={WORK} start="/home" /> },
  argTypes: { label: { control: 'text' }, children: { control: false }, className: { control: false } }
} satisfies Meta<typeof SidebarNav>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * On Home. A count sits at a place's end while something waits on you there. Home's is a link of its own: point at it for
 * what's waiting, by For you's tabs, and press it to land on For you.
 */
export const OnHome: Story = { name: 'On Home' };
/** On Calls: the page you're on is lit. */
export const OnCalls: Story = { name: 'On Calls', args: { children: <Links places={WORK} start="/calls" /> } };
/** Someone on their own. Record counts the recording waiting on this device to upload. */
export const OnTheirOwn: Story = { name: 'On their own', args: { children: <Links places={ALONE} start="/home" /> } };
/** On Team, under Record. */
export const OnTeam: Story = { name: 'On Team', args: { children: <Links places={WORK} start="/team" /> } };
/** The group at the foot of the panel, on Agents. */
export const AtTheFoot: Story = { name: 'At the foot', args: { label: 'Agents', children: <Links places={FOOT} start="/agents" /> } };
