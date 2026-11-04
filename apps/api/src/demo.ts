/*
 * Stand-ins for Microsoft and company SSO until they're connected. Delete this file then.
 *
 * Microsoft always signs in Art Vandelay. Single sign-on signs in whoever's work email was typed,
 * so a second account is a click away, but only at an address no real person can have: a domain
 * reserved for examples, or the demo company. Nothing checks the address, and notes are shared by
 * address, so a real one would let anyone read what was shared with its owner. Everyone at
 * vandelay.industries shares Art's company
 * directory. A demo account's calendar is a day of Alcove calls placed around the moment they sign
 * in, so the app opens on a day that looks real. Nothing here leaves the server: the calls are
 * ordinary sealed meetings in the account's vault. Google sign-in is real (../google.ts).
 */
import type { DemoProvider, MeetingInput, PortraitStyle } from '@alcove/api';
import { ValidationError } from './errors';
import { nameFrom, type Identity } from './identity';

const ART: Identity = {
  subject: 'demo:art-vandelay',
  name: 'Art Vandelay',
  email: 'art@vandelay.industries',
  /** Served by the web app (apps/web/public). */
  photoUrl: '/people/art-vandelay.jpg',
  sample: true
};
/** Whether this is the one shared demo account (Art Vandelay), which everyone who tries the demo signs in to. */
export const isSharedDemo = (p: { sample: boolean; email: string }): boolean => p.sample && p.email.toLowerCase() === ART.email;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Domains that can't belong to anyone (RFC 2606 and RFC 6761), and the demo company's. */
const DEMO_DOMAIN = /(?:^|\.)(?:example|test|invalid|localhost)$|(?:^|\.)example\.(?:com|net|org)$|^vandelay\.industries$/;

export function demoIdentity(provider: DemoProvider, email: string | undefined): Identity {
  if (provider === 'microsoft') return ART;
  const e = (email ?? '').trim().toLowerCase();
  if (!EMAIL.test(e)) throw new ValidationError('Enter your full work email.', { context: { provider } });
  if (e === ART.email) return ART;
  if (!DEMO_DOMAIN.test(e.slice(e.lastIndexOf('@') + 1))) {
    throw new ValidationError('Company sign-in isn’t connected yet. Sign in with Google, or try single sign-on with an address at example.com.', { context: { provider, reason: 'real-domain' } });
  }
  return { subject: `demo:sso:${e}`, email: e, name: nameFrom(e), sample: true };
}

export const COMPANY = { name: 'Vandelay Industries', domain: 'vandelay.industries' } as const;
/** The company directory a work account at Vandelay Industries can see. */
export const inCompany = (email: string) => email.endsWith(`@${COMPANY.domain}`);

export interface Contact { name: string; title?: string; email: string; onAlcove: boolean; portrait: PortraitStyle }

const ROOM = {
  warm: ['#EADFF0', '#CDBEDD', '#FFF1DE'], peri: ['#D4DBF3', '#AEB8DF', '#E8ECFB'], rose: ['#F0D5E1', '#D6AEC3', '#F8EEF3'], dusk: ['#CEC6EA', '#A79BD2', '#F5EEFB'],
  sky: ['#D1E0F5', '#A8BFE4', '#EEF4FD'], mist: ['#E0DDEE', '#BEB8D6', '#F2F0F9'], lilac: ['#E2D6F2', '#C3AEE0', '#F4EEFB'], peach: ['#F5DDD2', '#DDB9AD', '#FBEDE6']
} as const satisfies Record<string, [string, string, string]>;

/** Colleagues, as a company directory would list them. Theo and Kofi already use Alcove. */
export const TEAM: readonly Contact[] = [
  { name: 'Theo Martin', title: 'Engineering', email: 'theo@vandelay.industries', onAlcove: true, portrait: { skin: '#E8C2A0', hair: '#5B3B25', style: 'short', shirt: '#2E3A8C', bg: '#D5DEFF', beard: true, room: [...ROOM.peri] } },
  { name: 'Kofi Asante', title: 'Design lead', email: 'kofi@vandelay.industries', onAlcove: true, portrait: { skin: '#7B4F35', hair: '#141010', style: 'buzz', shirt: '#3D35A8', bg: '#FFE1C4', glasses: true, room: [...ROOM.dusk] } },
  { name: 'Sam Ortiz', title: 'Product design', email: 'sam@vandelay.industries', onAlcove: false, portrait: { skin: '#DDB08B', hair: '#2B2019', style: 'wavy', shirt: '#C2577A', bg: '#FCDCD5', room: [...ROOM.peach] } },
  { name: 'Lena Fischer', title: 'Research', email: 'lena@vandelay.industries', onAlcove: false, portrait: { skin: '#F0CDB0', hair: '#9A5A2E', style: 'bob', shirt: '#4A5A9C', bg: '#DCE3FB', room: [...ROOM.peri] } }
];

/** People outside the company Art has had calls with, as his calendar would show them. */
export const MET: readonly Contact[] = [
  { name: 'Priya Raman', email: 'priya@lumen.health', onAlcove: false, portrait: { skin: '#B47A55', hair: '#1A120E', style: 'bun', shirt: '#9C4A86', bg: '#F8D6E4', earrings: true, room: [...ROOM.rose] } },
  { name: 'Inès Moreau', email: 'ines@lumen.health', onAlcove: false, portrait: { skin: '#D9AA86', hair: '#3A2318', style: 'curly', shirt: '#4F6FD6', bg: '#D4E4FF', room: [...ROOM.sky] } },
  { name: 'Ana Souza', email: 'ana@souza.law', onAlcove: false, portrait: { skin: '#C7926C', hair: '#2A1A12', style: 'bob', shirt: '#7A5BD6', bg: '#E9DBFA', earrings: true, room: [...ROOM.lilac] } },
  { name: 'Jonas Weber', email: 'jonas@weber.design', onAlcove: false, portrait: { skin: '#F3D8C1', hair: '#C7A066', style: 'side', shirt: '#2A2845', bg: '#E2E0F3', glasses: true, room: [...ROOM.mist] } }
];

const MIN = 60_000;
const at = (base: number, minutes: number) => new Date(base + minutes * MIN).toISOString();

/** The calendar: the next call starts in about 12 minutes, and the rest of the day follows. */
export function demoDay(now: Date): MeetingInput[] {
  const first = Math.ceil((now.getTime() + 12 * MIN) / (5 * MIN)) * 5 * MIN;
  return [
    { title: 'Weekly with Theo', startsAt: at(first, 0), durationMinutes: 30, guests: ['theo@vandelay.industries'], notes: 'on' },
    { title: 'Contract follow-up with Ana', startsAt: at(first, 90), durationMinutes: 30, guests: ['ana@souza.law'], notes: 'off' },
    { title: 'Lumen: pilot prep', startsAt: at(first, 240), durationMinutes: 45, guests: ['priya@lumen.health', 'ines@lumen.health', 'kofi@vandelay.industries', 'sam@vandelay.industries'], notes: 'on' },
    { title: 'Interview: Jonas Weber', startsAt: at(first, 390), durationMinutes: 45, guests: ['jonas@weber.design', 'kofi@vandelay.industries'], notes: 'off' },
    { title: 'Studio stand-up', startsAt: at(first, 23 * 60), durationMinutes: 15, guests: ['theo@vandelay.industries', 'kofi@vandelay.industries', 'sam@vandelay.industries'], notes: 'off' }
  ];
}
