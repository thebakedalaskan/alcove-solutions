/*
 * The line: who stands where on the horizon. You stand in the middle, whoever you met most recently beside you, one to
 * each side, and the people not on Alcove yet at the ends. Nine stand at full size. Up to thirteen, everyone gives up a
 * little room and keeps a name. Past that the front stays and the rest recede: smaller, nameless and hazier the further
 * they stand, until they reach the edge of the window. Nobody leaves the horizon, and nobody wraps to a second line.
 *
 * It's all in places, not pixels: `k` is a person's share of one place, `px` how many places from you, `z` how far
 * hovering brings them forward. The stylesheet says how wide a place is at this window's width.
 */
import type { Person } from '@alcove/api';
import { sameEmail } from '~/lib/people';
import type { Member } from './data';

/** Who stands at full size, and how many keep a name. */
const FULL = 9;
const NAMED = 13;
/** The most the line holds; the list of everyone has the rest. */
const MOST = 34;
const NEAR = 2;

/** Who's in an arch: you, a member of your team, or nobody yet (`person` left out). */
export interface Someone { key: string; person?: Person | undefined; member?: Member | undefined; me?: boolean | undefined; ghost: boolean }
export interface Arch extends Someone { d: number; k: number; far: boolean; haze: number; z: number; px: number }
export interface Line { arches: Arch[]; gap: number; width: number; n: number; recedes: boolean }

const asMember = (member: Member): Someone => ({ key: member.person.email, person: member.person, member, ghost: !member.onAlcove });
/** Empty places, for while there's nobody to stand in them. */
export const blanks = (n: number): Someone[] => Array.from({ length: n }, (_, i) => ({ key: `blank-${i}`, ghost: true }));
export const you = (person: Person): Someone => ({ key: person.email, person, me: true, ghost: false });

/** The people on Alcove, then the ones who aren't. Someone found in the list of everyone (`forward`) always has a place. */
export function inLine(on: Member[], off: Member[], forward: string | undefined): Someone[] {
  const everyone = [...on, ...off].map(asMember);
  const at = forward ? everyone.findIndex((s) => sameEmail({ email: s.key }, { email: forward })) : -1;
  const found = everyone[at];
  if (!found || at < MOST - 1) return everyone;
  return [...everyone.slice(0, MOST - 2), found, ...everyone.slice(MOST - 2, at), ...everyone.slice(at + 1)];
}

export function lineOf(me: Someone, rest: Someone[]): Line {
  const n = rest.length + 1;
  const kOf = (d: number) => {
    if (n <= FULL) return 1;
    if (n <= NAMED) return 9.4 / n;
    return d <= NEAR ? 0.84 : Math.max(0.2, 0.84 * Math.pow(0.8, d - NEAR));
  };
  const hazeOf = (d: number) => (n <= NAMED ? 0 : Math.max(0, Math.min(1, (d - NEAR) / 8)));
  const stand = (s: Someone, d: number, px = 0): Arch => {
    const k = kOf(d);
    return { ...s, d, k, far: k < 0.6, haze: hazeOf(d), z: k < 0.6 ? 0.62 / k : 1, px };
  };
  const centre = stand(me, 0);
  const left: Arch[] = [];
  const right: Arch[] = [];
  rest.slice(0, MOST - 1).forEach((s, i) => (i % 2 ? left : right).push(stand(s, Math.floor(i / 2) + 1)));
  const along = (side: Arch[], sign: number) => {
    let x = centre.k / 2;
    return side.map((a) => { const px = sign * (x + a.k / 2); x += a.k; return { ...a, px }; });
  };
  const sum = (side: Arch[]) => side.reduce((t, a) => t + a.k, 0);
  return {
    arches: [...along(left, -1).reverse(), centre, ...along(right, 1)],
    gap: sum(right) - sum(left),
    width: centre.k + 2 * Math.max(sum(right), sum(left)),
    n, recedes: n > NAMED
  };
}

/** The low sun, in places from you: `inArch` when it's standing in someone's empty arch. */
export interface Sun { x: number; r: number; inArch?: string | undefined }
const SETS = -3;

/** In the empty arch near where it sets if there is one, otherwise just past the end of the line, or behind whoever has receded far enough. */
export function sunOf(line: Line): Sun {
  const left = line.arches.filter((a) => a.px < 0);
  const off = (a: Arch) => Math.abs(a.px - SETS);
  const empty = left.filter((a) => a.ghost && a.k > 0.6).sort((a, b) => off(a) - off(b))[0];
  if (empty && off(empty) <= 1.1) return { x: empty.px, r: 0.27 * empty.k, inArch: empty.key };
  if (line.recedes) {
    const far = left.filter((a) => a.k <= 0.46).sort((a, b) => b.px - a.px)[0];
    return { x: far ? far.px - 0.1 : SETS, r: 0.4 };
  }
  const end = left.length ? Math.min(...left.map((a) => a.px)) : 0;
  return { x: Math.min(-2.85, end - 0.86), r: 0.38 };
}
