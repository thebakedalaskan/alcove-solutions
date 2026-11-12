/*
 * The app's places, as the side panel and the phone's tab bar list them. Adding a place is a line in
 * NAV or TABS (and, for a count, a line in useCounts). `tour` is the hook the tour of Home finds a place
 * by (features/onboarding/Tour.tsx).
 */
import type { Team } from '@alcove/api';
import type { IconName } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { uploads } from '~/features/record/uploads';
import { useLive } from '~/lib/live';
import { openCount } from '~/features/home/day';
import { q } from '~/lib/queries';
import type { FileRoutesByTo } from '~/routeTree.gen';

/** A path in the app with nothing to fill in, such as /notes. */
export type Place = { [K in keyof FileRoutesByTo]: K extends `${string}$${string}` ? never : K }[keyof FileRoutesByTo];

/** How often the side panel looks for tags you haven't seen. */
const TAGS_MS = 60_000;

/**
 * What a place in the side panel can count: what's waiting on you, notes, tags you haven't seen, recordings on this
 * device waiting to upload, the team, and the agents you've connected.
 */
export type Counter = 'home' | 'notes' | 'drive' | 'record' | 'team' | 'agents';
/**
 * How many there are of each, once they've loaded. The team counts the people on Alcove, you among
 * them, once someone besides you is; Agents counts your connections, once there's one.
 */
export function useCounts(): Record<Counter, number | undefined> {
  const notes = useQuery(q.notes()).data;
  const inbox = useQuery(q.inbox()).data;
  const others = useQuery(q.team()).data?.members.filter((m) => m.onAlcove).length;
  const tags = useQuery({ ...q.mentions(), refetchInterval: TAGS_MS }).data?.length;
  const agents = useQuery(q.agents()).data?.length;
  const kept = useLive(uploads);
  const waiting = kept.list.filter((k) => k.status === 'waiting' || k.status === 'uploading' || k.status === 'refused').length;
  return {
    home: (inbox && openCount(inbox, notes ?? [], Date.now())) || undefined, notes: notes?.length, drive: tags || undefined, record: waiting || undefined,
    team: others ? others + 1 : undefined, agents: agents || undefined
  };
}

/** A workspace's pages, in the Drive, fill the frame, keep one screen as you move around them, and take N for themselves. */
export const inWorkspace = (path: string): boolean => path.startsWith('/drive/');

export interface NavPlace { to: Place; icon: IconName; label: string; count?: Counter | undefined; tour?: string | undefined }
/** The side panel's places, under Start a call. */
export const NAV: readonly NavPlace[] = [
  { to: '/home', icon: 'home', label: 'Home', count: 'home' },
  { to: '/notes', icon: 'notes', label: 'Notes', count: 'notes', tour: 'notes' },
  { to: '/drive', icon: 'folderOpen', label: 'Drive', count: 'drive' },
  { to: '/record', icon: 'recordDot', label: 'Record', count: 'record', tour: 'room' },
  { to: '/team', icon: 'people', label: 'Team', count: 'team' },
  { to: '/agents', icon: 'agent', label: 'Agents', count: 'agents' }
];

/** The places someone has: on your own there's no Team page. Until that's known they're all there, so nothing appears late. */
export const places = <P extends { to: Place }>(all: readonly P[], team: Team | null | undefined): readonly P[] => (team === null ? all.filter((p) => p.to !== '/team') : all);

export interface Tab { to: Place; icon: IconName; label: string; raised?: boolean | undefined; tour?: string | undefined }
/**
 * The phone's tab bar, with Record in the middle. `raised` is Record's button, which stands up out of the bar. Settings is
 * behind your face in the top bar, and Agents opens from Settings › Connections.
 */
export const TABS: readonly Tab[] = [
  { to: '/home', icon: 'home', label: 'Home' },
  { to: '/notes', icon: 'notes', label: 'Notes', tour: 'notes' },
  { to: '/record', icon: 'recordDot', label: 'Record', raised: true, tour: 'room' },
  { to: '/drive', icon: 'folderOpen', label: 'Drive' },
  { to: '/team', icon: 'people', label: 'Team' }
];
