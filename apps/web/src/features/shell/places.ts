/*
 * The app's places, as the side panel and the phone's tab bar list them. Adding a place is a line in NAV, NAV_FOOT or
 * TABS (and, for a count, a line in useCounts). `tour` is the hook the tour of Home finds a place by
 * (features/onboarding/Tour.tsx).
 */
import type { MyTeam, Team } from '@alcove/api';
import type { IconName } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { FOR_YOU } from '~/features/home/landing';
import { uploads } from '~/features/record/uploads';
import { useLive } from '~/lib/live';
import { plural } from '~/lib/words';
import { waitingCounts } from '~/features/notes/inbox';
import { noteQueries } from '~/features/notes/queries';
import { workspaceQueries } from '~/features/workspace/queries';
import type { FileRoutesByTo } from '~/routeTree.gen';

/** A path in the app with nothing to fill in, such as /calls. */
export type Place = { [K in keyof FileRoutesByTo]: K extends `${string}$${string}` ? never : K }[keyof FileRoutesByTo];

/** How often the side panel looks for tags you haven't seen. */
const TAGS_MS = 60_000;

/**
 * What a place in the side panel can count. A count says something is waiting on you: what's for you on Home, tags you
 * haven't seen in the Drive, and recordings on this device waiting to upload. A total (every call, everyone on the team,
 * every agent) never waits on you, so nothing counts one.
 */
export type Counter = 'home' | 'drive' | 'record';
/**
 * A place's count: how many, and for one that leads somewhere the place's own link doesn't (`to`), where and what it says.
 * Home's leads to For you, under Home's horizon, and says what's in each of its tabs.
 */
export interface Count { n: number; to?: { hash: string; says: string } | undefined }
/** Each place's count, once it's loaded, and only while there's at least one. */
export function useCounts(): Record<Counter, Count | undefined> {
  const notes = useQuery(noteQueries.notes()).data;
  const inbox = useQuery(noteQueries.inbox()).data;
  const tags = useQuery({ ...workspaceQueries.mentions(), refetchInterval: TAGS_MS }).data?.length ?? 0;
  const kept = useLive(uploads);
  const waiting = kept.list.filter((k) => k.status === 'waiting' || k.status === 'uploading' || k.status === 'refused').length;
  const forYou = inbox ? waitingCounts(inbox, notes ?? [], Date.now()) : { ask: 0, todo: 0 };
  const home = forYou.ask + forYou.todo;
  return {
    home: home ? { n: home, to: { hash: FOR_YOU, says: forYouSays(forYou) } } : undefined,
    drive: tags ? { n: tags } : undefined,
    record: waiting ? { n: waiting } : undefined
  };
}

/** Home's count in words, by For you's tabs: "For you: 3 to answer, 2 follow-ups". */
const forYouSays = ({ ask, todo }: { ask: number; todo: number }): string =>
  `For you: ${[ask ? `${ask} to answer` : '', todo ? plural(todo, 'follow-up') : ''].filter((part) => part !== '').join(', ')}`;

/** A workspace's pages, in the Drive, fill the frame, keep one screen as you move around them, and take N for themselves. */
export const inWorkspace = (path: string): boolean => path.startsWith('/drive/');

export interface NavPlace { to: Place; icon: IconName; label: string; count?: Counter | undefined; tour?: string | undefined }
/** The side panel's places under Start a call: your own work, then Team, where your groups are. */
export const NAV: readonly NavPlace[] = [
  { to: '/home', icon: 'home', label: 'Home', count: 'home' },
  { to: '/calls', icon: 'calls', label: 'Calls', tour: 'calls' },
  { to: '/drive', icon: 'folderOpen', label: 'Drive', count: 'drive', tour: 'drive' },
  { to: '/record', icon: 'recordDot', label: 'Record', count: 'record', tour: 'record' },
  { to: '/team', icon: 'people', label: 'Team' }
];
/** The places at the side panel's foot, above the check: your agents. */
export const NAV_FOOT: readonly NavPlace[] = [
  { to: '/agents', icon: 'agent', label: 'Agents', tour: 'agents' }
];

/**
 * The places someone has: on your own, with no company around you (`company`) and no team on a plan (`mine`), there's no Team
 * page. A team of your own has one even without a company. Until both are known they're all there, so nothing appears late.
 */
export const places = <P extends { to: Place }>(all: readonly P[], company: Team | null | undefined, mine: MyTeam | null | undefined): readonly P[] =>
  (company === null && mine === null ? all.filter((p) => p.to !== '/team') : all);

export interface Tab { to: Place; icon: IconName; label: string; raised?: boolean | undefined; tour?: string | undefined }
/**
 * The phone's tab bar, with Record in the middle. `raised` is Record's button, which stands up out of the bar. Settings is
 * in your menu, which your face in the top bar opens, and Agents opens from Settings › Connections.
 */
export const TABS: readonly Tab[] = [
  { to: '/home', icon: 'home', label: 'Home' },
  { to: '/calls', icon: 'calls', label: 'Calls', tour: 'calls' },
  { to: '/record', icon: 'recordDot', label: 'Record', raised: true, tour: 'record' },
  { to: '/drive', icon: 'folderOpen', label: 'Drive', tour: 'drive' },
  { to: '/team', icon: 'people', label: 'Team' }
];
