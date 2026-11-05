/*
 * SidebarNav: the app's places, under Start a call in the side panel, which is dark in both themes. Each place is a
 * router link with className="ac-nav-item" holding NavItemContent: its icon, its name, and a count when there's one
 * (what's waiting on you, your notes, recordings waiting to upload, the people on Alcove). The page you're on carries
 * aria-current="page". Someone on their own has no Team. At 860px and narrower the phone's tab bar takes its place.
 */
import { Icon, Kbd, Logo, NavItemContent, SidebarNav, buttonClass, cn, type IconName } from '@alcove/ui';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { useState, type MouseEvent } from 'react';
import { did } from '../../../src/component';

interface Place { to: string; icon: IconName; label: string; count?: number | undefined }
/** A team's places on the busy afternoon: two things wait on you, eleven notes, six people on Alcove. */
const TEAM: Place[] = [
  { to: '/home', icon: 'home', label: 'Home', count: 2 },
  { to: '/notes', icon: 'notes', label: 'Notes', count: 11 },
  { to: '/record', icon: 'recordDot', label: 'Record' },
  { to: '/team', icon: 'people', label: 'Team', count: 6 }
];
/** On your own there's no Team page. A recording waits on this device to upload. */
const ALONE: Place[] = [
  { to: '/home', icon: 'home', label: 'Home' },
  { to: '/notes', icon: 'notes', label: 'Notes', count: 4 },
  { to: '/record', icon: 'recordDot', label: 'Record', count: 1 }
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
        <Icon name="video" size={18} /><span>Start a call</span><Kbd>N</Kbd>
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
  args: { label: 'Main', children: <Links places={TEAM} start="/home" /> },
  argTypes: { label: { control: 'text' }, children: { control: false }, className: { control: false } }
} satisfies Meta<typeof SidebarNav>;
export default meta;
type Story = StoryObj<typeof meta>;

/** On Home. A place's count sits at its end: what's waiting on you, notes, the people on Alcove. */
export const OnHome: Story = { name: 'On Home' };
/** On Notes: the page you're on is lit. */
export const OnNotes: Story = { name: 'On Notes', args: { children: <Links places={TEAM} start="/notes" /> } };
/** Someone on their own: no Team. Record counts the recording waiting on this device to upload. */
export const OnTheirOwn: Story = { name: 'On their own', args: { children: <Links places={ALONE} start="/home" /> } };
