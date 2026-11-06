/*
 * Who hosts a call (docs: Calls and recordings › Host hand-off). The organizer hosts while they're in it; while they're
 * away (their connection dropped, or they left the call to someone), someone invited stands in. Whoever hosts lets
 * people in, commits every part of the call's MLS group and takes its notes; only the organizer changes what the notes
 * capture. This module decides who may stand in, in what order, and what everyone is told when the host changes. The
 * change itself (a new MLS generation, under the call's row lock) is the calls module's `newGeneration`.
 */
import { MAIN_PLACE, firstName } from '@alcove/api';
import { placeOf, type Joined, type Placing } from './places';

/**
 * Who may host: someone in the call who is invited (by email, or let in from the link and so added to the invite).
 * Never a guest: whoever hosts sees everyone asking to join, addresses included, decides who comes in, and holds every
 * part of the call's keys. The organizer's own connection hosts by being in the call, so it's never a stand-in.
 */
export const mayStandIn = (j: Joined): boolean => j.status === 'in' && j.role === 'invited';

/** When someone first came into this call (ms): the earliest of their connections, reloads and other tabs included. */
function firstArrival(s: Placing, person: string): number {
  return s.people.reduce((t, j) => (j.person === person ? Math.min(t, j.since) : t), Number.POSITIVE_INFINITY);
}

/**
 * Who could host, best first, leaving out `not` (connections), and when `connected` is given, anyone not in the call's
 * LiveKit room now (a browser that isn't there can't take over). People in the main room come before people in a
 * breakout room, since the host's browser is what hears the main room for the call's notes; then whoever came into the
 * call first; then by identity, so every server picks the same person.
 */
export function standIns(s: Placing, not: ReadonlySet<string>, connected?: ReadonlySet<string> | undefined): Joined[] {
  const rank = (j: Joined) => [placeOf(s, j) === MAIN_PLACE ? 0 : 1, firstArrival(s, j.person)] as const;
  return s.people
    .filter((j) => mayStandIn(j) && !not.has(j.identity) && (!connected || connected.has(j.identity)))
    .sort((a, b) => {
      const [ap, at] = rank(a);
      const [bp, bt] = rank(b);
      return ap - bp || at - bt || a.identity.localeCompare(b.identity);
    });
}

/** Why the host changed, for what everyone is told: their connection dropped, they left it to someone, or the organizer came back. */
export type HostChange = { kind: 'dropped' | 'left'; from: Joined; to: Joined } | { kind: 'back'; standIn: Joined; organizer: Joined };

/** A notice about a host change: for one connection alone (`to`), or for everyone but one (`not`). */
export interface HostNotice { text: string; to?: string | undefined; not?: string | undefined }

/**
 * What everyone is told when the host changes, by first name: the new host in their own words, everyone else (the old
 * host included, if they're still there to hear it) in the same sentence. `organizer` is the organizer's name.
 */
export function noticesFor(change: HostChange, organizer: string): HostNotice[] {
  const org = firstName(organizer);
  if (change.kind === 'back') {
    return [
      { text: `You’re hosting again. ${firstName(change.standIn.name)} hosted while you were away.`, to: change.organizer.identity },
      { text: `${org} is back and hosting again.`, not: change.organizer.identity }
    ];
  }
  const from = change.from.role === 'host' ? org : firstName(change.from.name);
  const to = firstName(change.to.name);
  if (change.kind === 'dropped') {
    return [
      { text: `${from}’s connection dropped, so you’re hosting until ${org} is back.`, to: change.to.identity },
      { text: `${from}’s connection dropped, so ${to} is hosting until ${org} is back.`, not: change.to.identity }
    ];
  }
  return [
    { text: `${from} left the call and asked you to host until ${org} is back.`, to: change.to.identity },
    { text: `${from} left the call. ${to} is hosting until ${org} is back.`, not: change.to.identity }
  ];
}
