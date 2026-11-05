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
 * ordinary sealed meetings in the account's vault. Around them it has a made-up week of busy times
 * and a made-up catalog of documents, both worked out when they're asked for and stored nowhere.
 * Google sign-in is real (../google.ts).
 */
import { firstName, type CallDocument, type Document, type DocumentKind, type DocumentLibrary, type DemoProvider, type MeetingInput, type PortraitStyle } from '@alcove/api';
import { createHash } from 'node:crypto';
import { ValidationError } from './errors';
import { nameFrom, type Identity } from './identity';
import { dayIn, zoned } from './zones';

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

/** Colleagues, as a company directory would list them. Theo, Kofi, Aiko and Maya already use Alcove. */
export const TEAM: readonly Contact[] = [
  { name: 'Theo Martin', title: 'Engineering', email: 'theo@vandelay.industries', onAlcove: true, portrait: { skin: '#E8C2A0', hair: '#5B3B25', style: 'short', shirt: '#2E3A8C', bg: '#D5DEFF', beard: true, room: [...ROOM.peri] } },
  { name: 'Kofi Asante', title: 'Design lead', email: 'kofi@vandelay.industries', onAlcove: true, portrait: { skin: '#7B4F35', hair: '#141010', style: 'buzz', shirt: '#3D35A8', bg: '#FFE1C4', glasses: true, room: [...ROOM.dusk] } },
  { name: 'Sam Ortiz', title: 'Product design', email: 'sam@vandelay.industries', onAlcove: false, portrait: { skin: '#DDB08B', hair: '#2B2019', style: 'wavy', shirt: '#C2577A', bg: '#FCDCD5', room: [...ROOM.peach] } },
  { name: 'Lena Fischer', title: 'Research', email: 'lena@vandelay.industries', onAlcove: false, portrait: { skin: '#F0CDB0', hair: '#9A5A2E', style: 'bob', shirt: '#4A5A9C', bg: '#DCE3FB', room: [...ROOM.peri] } },
  { name: 'Aiko Tanaka', title: 'Design', email: 'aiko@vandelay.industries', onAlcove: true, portrait: { skin: '#F0D0B4', hair: '#15110F', style: 'bob', shirt: '#D98CB8', bg: '#E8E2FF', room: [...ROOM.lilac] } },
  { name: 'Maya Chen', title: 'Product', email: 'maya@vandelay.industries', onAlcove: true, portrait: { skin: '#F1CBA8', hair: '#231813', style: 'long', shirt: '#4859D6', bg: '#E2E7FF', room: [...ROOM.sky] } }
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

/* ---------- a demo account's week ---------- */

/** A stretch of someone's day, in half hours after nine. */
interface Block { from: number; to: number }
const HALF_HOUR = 30 * MIN;
const NINE = 9 * 60;
/** Nine to five, in half hours. */
const WORKING_DAY = 16;

/**
 * One person's working day, the same every time for the same address and day: lunch some time from noon to two, and two
 * to four calls of half an hour to an hour and a half, none on top of another. Nobody else's day looks like it.
 */
function workday(email: string, day: string): Block[] {
  const seed = createHash('sha256').update(`alcove/demo-busy/v1\n${email}\n${day}`).digest();
  const roll = (i: number, sides: number) => (seed[i] ?? 0) % sides;
  const lunch = 6 + roll(0, 3);
  const taken: Block[] = [{ from: lunch, to: lunch + 1 + roll(1, 2) }];
  for (let i = 0, calls = 2 + roll(2, 3); i < calls; i++) {
    const length = 1 + roll(3 + 2 * i, 3);
    const from = roll(4 + 2 * i, WORKING_DAY - length + 1);
    if (!taken.some((b) => from < b.to && b.from < from + length)) taken.push({ from, to: from + length });
  }
  return taken.sort((a, b) => a.from - b.from);
}

/**
 * Reads sample people's busy times between two moments, in ms, each working day where the person asking is: Monday to
 * Friday, nine to five. Each person's week comes from their address alone, so it's the same on every read, whoever asks.
 */
export function sampleWeek(range: { from: Date; to: Date }, timeZone: string): (email: string) => { from: number; to: number }[] {
  const days: { day: string; nine: number }[] = [];
  const last = dayIn(range.to, timeZone);
  for (let day = dayIn(range.from, timeZone); day <= last; day = new Date(Date.parse(day) + 24 * 60 * MIN).toISOString().slice(0, 10)) {
    const weekday = new Date(day).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push({ day, nine: zoned(day, NINE, timeZone).getTime() });
  }
  return (email) => days.flatMap(({ day, nine }) => workday(email.trim().toLowerCase(), day).map((b) => ({ from: nine + b.from * HALF_HOUR, to: nine + b.to * HALF_HOUR })));
}

/* ---------- a demo account's documents ---------- */

/** A document, with how many hours ago it changed. */
interface SampleDocument { slug: string; name: string; kind: DocumentKind; hours: number }
const HOUR = 60 * MIN;
/** The demo company's workspaces. Anyone at the company can open what's in them. */
const WORKSPACES: readonly { id: string; name: string; documents: readonly (SampleDocument & { by: string })[] }[] = [
  {
    id: 'product', name: 'Product', documents: [
      { slug: 'launch-plan', name: 'Launch plan', kind: 'doc', by: 'Priya', hours: 2 },
      { slug: 'launch-checklist', name: 'Launch checklist', kind: 'sheet', by: 'Maya', hours: 5 },
      { slug: 'pricing-copy', name: 'Pricing page copy', kind: 'doc', by: 'Lena', hours: 26 }
    ]
  },
  { id: 'design', name: 'Design', documents: [{ slug: 'onboarding-flow', name: 'Onboarding flow', kind: 'board', by: 'Aiko', hours: 50 }] }
];
/** What someone on their own has. Only they can open them. */
const OWN: readonly SampleDocument[] = [
  { slug: 'proposal', name: 'Harbourline proposal', kind: 'doc', hours: 26 },
  { slug: 'rates', name: 'Rates 2026', kind: 'sheet', hours: 74 },
  { slug: 'brief', name: 'Project brief template', kind: 'doc', hours: 550 }
];

const companyId = (slug: string) => `vandelay.${slug}`;
const ownerTag = (email: string) => createHash('sha256').update(`alcove/demo-documents/v1\n${email.trim().toLowerCase()}`).digest('base64url').slice(0, 16);
/** Someone's own document's ID says whose it is, under a tag of their address, and how to name them, since a call's documents are read by ID alone. */
const ownId = (who: { name: string; email: string }, slug: string) => `own.${ownerTag(who.email)}.${slug}.${encodeURIComponent(firstName(who.name))}`;
const OWN_ID = /^own\.([A-Za-z0-9_-]{16})\.([a-z-]+)\.(.+)$/;

/** What a demo account can bring to a call: the company's workspaces at the company, otherwise their own documents. */
export function sampleLibrary(who: { name: string; email: string }, now: Date): DocumentLibrary['workspaces'] {
  const document = (id: string, d: SampleDocument, by: string): Document => ({ id, name: d.name, kind: d.kind, by, updatedAt: new Date(now.getTime() - d.hours * HOUR).toISOString() });
  if (inCompany(who.email)) return WORKSPACES.map((w) => ({ id: w.id, name: w.name, documents: w.documents.map((d) => document(companyId(d.slug), d, d.by)) }));
  return [{ id: 'own', name: 'Your documents', documents: OWN.map((d) => document(ownId(who, d.slug), d, firstName(who.name))) }];
}

/** A document brought to a call, as `viewer` sees it, from its ID alone; null when it's nothing in the catalog (any more). */
export function sampleDocument(id: string, viewer: { email: string; sample: boolean }): CallDocument | null {
  const company = WORKSPACES.flatMap((w) => w.documents).find((d) => companyId(d.slug) === id);
  if (company) return { id, kind: company.kind, by: company.by, name: viewer.sample && inCompany(viewer.email) ? company.name : null };
  const [, tag, slug, by] = OWN_ID.exec(id) ?? [];
  const own = OWN.find((d) => d.slug === slug);
  return own && by ? { id, kind: own.kind, by: decodeURIComponent(by), name: viewer.sample && ownerTag(viewer.email) === tag ? own.name : null } : null;
}
