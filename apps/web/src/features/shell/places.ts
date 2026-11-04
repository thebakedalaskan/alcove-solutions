/*
 * The app's places, as the side panel and the phone's tab bar list them. Adding a place is a line in
 * NAV or TABS (and, for a count, a line in useCounts). `tour` is the hook the tour of Home finds a place
 * by (features/onboarding/Tour.tsx).
 */
import type { IconName } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { q } from '~/lib/queries';
import type { FileRoutesByTo } from '~/routeTree.gen';

/** A path in the app with nothing to fill in, such as /notes. */
export type Place = { [K in keyof FileRoutesByTo]: K extends `${string}$${string}` ? never : K }[keyof FileRoutesByTo];

/** What a place in the side panel can count. */
export type Counter = 'notes';
/** How many there are of each, once they've loaded. */
export function useCounts(): Record<Counter, number | undefined> {
  const notes = useQuery(q.notes()).data;
  return { notes: notes?.length };
}

export interface NavPlace { to: Place; icon: IconName; label: string; count?: Counter | undefined; tour?: string | undefined }
/** The side panel's places, under New call and the search. */
export const NAV: readonly NavPlace[] = [
  { to: '/home', icon: 'home', label: 'Home' },
  { to: '/notes', icon: 'notes', label: 'Notes', count: 'notes' },
  { to: '/record', icon: 'recordDot', label: 'Record', tour: 'room' }
];

export interface Tab { to: Place; icon: IconName; label: string; raised?: boolean | undefined; tour?: string | undefined }
/** The phone's tab bar. `raised` is Record's button, which stands up out of the bar. */
export const TABS: readonly Tab[] = [
  { to: '/home', icon: 'home', label: 'Home' },
  { to: '/notes', icon: 'notes', label: 'Notes' },
  { to: '/record', icon: 'recordDot', label: 'Record', raised: true, tour: 'room' },
  { to: '/account', icon: 'settings', label: 'Settings' }
];
