/*
 * How people look when they have no photo: an illustrated portrait drawn from a stable seed (their
 * email), in the sunrise palette. Also how anyone outside Alcove appears: by their directory name
 * when the directory knows them, otherwise by their address.
 */
import type { Person, PortraitStyle } from '@alcove/api';
import { H, utf8 } from '../../keys/crypto';
import { nameFrom } from '../../providers/identity';
import { MET, TEAM } from './demo-directory';

const SKINS = ['#F1D3B8', '#E8C2A0', '#D9AA86', '#C7926C', '#B47A55', '#7B4F35', '#F3D8C1'];
const HAIRS = ['#1D1612', '#3A2318', '#5B3B25', '#141010', '#9A5A2E', '#C7A066', '#2B2019'];
const BGS = ['#DCD8FF', '#D5DEFF', '#F8D6E4', '#FFE1C4', '#D4E4FF', '#E9DBFA', '#FCDCD5'];
const SHIRTS = ['#5847E0', '#2E3A8C', '#9C4A86', '#3D35A8', '#4F6FD6', '#C2577A', '#7A5BD6'];
const STYLES = ['long', 'short', 'bun', 'curly', 'bob', 'wavy', 'side', 'buzz'] as const;
/** Wall top, wall bottom and the warm light in the room behind someone on camera. */
const ROOMS: [string, string, string][] = [
  ['#EADFF0', '#CDBEDD', '#FFF1DE'], ['#D4DBF3', '#AEB8DF', '#E8ECFB'], ['#F0D5E1', '#D6AEC3', '#F8EEF3'],
  ['#CEC6EA', '#A79BD2', '#F5EEFB'], ['#D1E0F5', '#A8BFE4', '#EEF4FD'], ['#F5DDD2', '#DDB9AD', '#FBEDE6']
];

export function portraitFor(seed: string): PortraitStyle {
  const h = H('alcove/portrait/v1', utf8(seed.trim().toLowerCase()));
  const pick = <T,>(xs: readonly T[], i: number, fallback: T): T => xs[(h[i] ?? 0) % xs.length] ?? fallback;
  return {
    bg: pick(BGS, 0, '#DCD8FF'), skin: pick(SKINS, 1, '#F1D3B8'), hair: pick(HAIRS, 2, '#1D1612'), shirt: pick(SHIRTS, 3, '#5847E0'),
    style: pick(STYLES, 4, 'short'), glasses: (h[5] ?? 0) % 4 === 0, beard: (h[7] ?? 0) % 5 === 0, earrings: (h[8] ?? 0) % 4 === 1,
    room: pick(ROOMS, 6, ['#EADFF0', '#CDBEDD', '#FFF1DE'])
  };
}

const known = (email: string) => [...TEAM, ...MET].find((c) => c.email === email.trim().toLowerCase());

/** Someone who may not use Alcove, identified by their email address. */
export function personOf(email: string, name?: string | undefined): Person {
  const e = email.trim().toLowerCase();
  const c = known(e);
  return { id: e, name: name ?? c?.name ?? e, email: e, portrait: c?.portrait ?? portraitFor(e) };
}

/** What someone is called: their name, or one made from their address when that's all Alcove knows ("kofi@…" is Kofi). */
export const nameOf = (p: Person): string => (p.name === p.email ? nameFrom(p.email) : p.name);
