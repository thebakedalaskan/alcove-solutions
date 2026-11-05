/*
 * Who can be rung, and what someone rung is doing, in words. Only people on Alcove hear a ring. Nobody who doesn't
 * answer is ever called offline: Alcove can't know, and a ring only reaches a tab that's open.
 */
import { RING_SECONDS, type Person, type Rung, type Team } from '@alcove/api';
import type { IconName } from '@alcove/ui';
import { callName, sameEmail } from '~/lib/people';

/** The people on your team who are on Alcove, you aside. */
export const ringable = (team: Team | null | undefined, me: { email: string } | undefined): Person[] =>
  (team?.members ?? []).filter((m) => m.onAlcove && !(me && sameEmail(m.person, me))).map((m) => m.person);

/** "In 5 minutes", counting down to when they're rung again. */
function inMinutes(until: string | undefined, now: number): string {
  const n = until ? Math.max(1, Math.ceil((new Date(until).getTime() - now) / 60_000)) : 0;
  return n === 0 ? 'In a little while' : n === 1 ? 'In 1 minute' : `In ${n} minutes`;
}

export interface RungWords {
  /** On their arch. */
  title: string;
  /** Under it, while it's ringing. */
  detail?: string | undefined;
  /** Their answer, as a mark. */
  reply?: { icon: IconName; text: string } | undefined;
  /** In People: the same thing in a few words. */
  line: string;
  /** They said no, or it ran out: the organizer can ring them again. */
  again: boolean;
}
export function rungWords(r: Rung, now: number): RungWords {
  const name = callName(r.person);
  if (r.state === 'ringing') {
    const s = Math.max(0, Math.min(RING_SECONDS, Math.floor((now - new Date(r.since).getTime()) / 1000)));
    const detail = `For ${s} ${s === 1 ? 'second' : 'seconds'}`;
    return { title: `Ringing ${name}`, detail, line: `Ringing · ${detail.toLowerCase()}`, again: false };
  }
  if (r.state === 'coming') return { title: `${name} is on the way`, line: 'On the way', again: false };
  if (r.state === 'later') {
    const text = inMinutes(r.until, now);
    return { title: `${name} can’t join yet`, reply: { icon: 'clock', text }, line: `Can’t join yet · ${text.toLowerCase()}`, again: false };
  }
  if (r.state === 'declined') return { title: `${name} can’t join`, reply: { icon: 'x', text: 'Not this time' }, line: 'Not this time', again: true };
  return { title: `${name} hasn’t answered`, line: 'Hasn’t answered', again: true };
}

/** How long an answer stays on the stage, in milliseconds. It stays in People until the call ends. */
const ON_STAGE: Record<Rung['state'], number> = { ringing: Infinity, later: Infinity, coming: 120_000, declined: 20_000, missed: 20_000 };
/**
 * Who waits on the stage now. Someone who said no or didn't answer stays a moment, then the stage gives their room back;
 * `seen` keeps when this browser first saw each answer.
 */
export function waitingOnStage(rung: Rung[], seen: Map<string, number>, now: number): Rung[] {
  return rung.filter((r) => {
    const key = `${r.id}:${r.state}:${r.since}`;
    const first = seen.get(key) ?? now;
    seen.set(key, first);
    return now - first < ON_STAGE[r.state];
  });
}
