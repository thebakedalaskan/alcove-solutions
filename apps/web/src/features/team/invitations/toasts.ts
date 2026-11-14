/*
 * An invitation to you, said once in this browser as it arrives (the design's 4.4): "Priya invited you to join Vandelay
 * Industries", in Priya's arch, with View, which opens Team. Two at a time; any more wait their turn, said as those two go.
 * Not while the Team page is open, which shows them, nor while a new account's arrival covers the page. Which have been said
 * is a convenience kept per account in this browser's storage (`alcove.team-invitations-said.<ownerId>`, the invitations'
 * IDs and nothing else); without storage, each is said once in this tab. Signing out here forgets it.
 */
import { useToast } from '@alcove/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useArrival } from '~/features/onboarding/store';
import { log } from '~/lib/log';
import { teamQueries } from '../queries';
import { invitedYou } from './words';

const ilog = log.child({ component: 'team-invitations' });
const saidKey = (owner: string) => `alcove.team-invitations-said.${owner}`;
/** What's been said in this tab, for a browser that keeps nothing. */
const saidHere = new Map<string, Set<string>>();
/** At most this many are said at once; the rest wait their turn, and Team's count says how many there are meanwhile. */
const AT_ONCE = 2;
/** How long each stands, and the moment between turns. */
const STANDS_MS = 9000;
const TURN_MS = STANDS_MS + 400;

function saidOf(owner: string): Set<string> {
  try {
    const kept = localStorage.getItem(saidKey(owner));
    return new Set(kept === null ? [] : kept.split(' ').filter((id) => id !== ''));
  } catch (e) {
    ilog.debug('the invitations said aren’t read from this browser', { err: e });
    return saidHere.get(owner) ?? new Set();
  }
}
function keep(owner: string, said: ReadonlySet<string>): void {
  saidHere.set(owner, new Set(said));
  try { localStorage.setItem(saidKey(owner), [...said].join(' ')); } catch (e) { ilog.debug('the invitations said aren’t kept in this browser', { err: e }); }
}
/** Forgets which invitations were said, for an account signing out or deleted on this browser. */
export function forgetInvitationsSaid(owner: string): void {
  saidHere.delete(owner);
  try { localStorage.removeItem(saidKey(owner)); } catch (e) { ilog.debug('the invitations said aren’t forgotten here', { err: e }); }
}

/**
 * Says each invitation to `owner` once, as the invitations are read (as the app opens, every minute, and when its window comes
 * back: teamQueries.invitations), two at a time: the rest when those two have gone (its one timer, cleared as it goes).
 */
export function useInvitationToasts(owner: string | null, offline: boolean): void {
  const toast = useToast();
  const navigate = useNavigate();
  const onTeam = useRouterState({ select: (s) => s.location.pathname === '/team' });
  const covered = useArrival().stage !== 'none';
  const invitations = useQuery({ ...teamQueries.invitations(), enabled: owner !== null && !offline }).data;
  /* A turn: the next two waiting may be said once it comes round. */
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    if (owner === null || !invitations || covered) return undefined;
    const said = saidOf(owner);
    const fresh = invitations.filter((i) => !i.putAside && !said.has(i.id));
    if (!fresh.length) return undefined;
    // Only those still there are kept, so what's kept never grows past what's waiting. On Team, which shows them all, they're
    // all said; elsewhere, the two said now.
    const now = onTeam ? fresh : fresh.slice(0, AT_ONCE);
    keep(owner, new Set([...said, ...now.map((i) => i.id)].filter((id) => invitations.some((i) => i.id === id))));
    if (onTeam) return undefined;
    ilog.info('invitations said', { count: now.length, waiting: fresh.length - now.length });
    for (const i of now) {
      toast(invitedYou(i), { person: i.from, ms: STANDS_MS, topic: `invitation ${i.id}`, action: { label: 'View', onClick: () => void navigate({ to: '/team' }) } });
    }
    if (fresh.length <= now.length) return undefined;
    const next = setTimeout(() => setTurn((t) => t + 1), TURN_MS);
    return () => clearTimeout(next);
  }, [owner, invitations, covered, onTeam, toast, navigate, turn]);
}
