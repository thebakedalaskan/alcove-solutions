/*
 * Stand-ins for Microsoft and company SSO until they're connected. Delete this file then, with the demo company's directory
 * (features/profile/demo-directory.ts) and its week (features/meetings/demo-week.ts).
 *
 * Microsoft always signs in Art Vandelay. Single sign-on signs in whoever's work email was typed,
 * so a second account is a click away, but only at an address no real person can have: a domain
 * reserved for examples, or the demo company. Nothing checks the address, and notes are shared by
 * address, so a real one would let anyone read what was shared with its owner. A demo account's calendar is a day of
 * Alcove calls placed around the moment they sign in, so the app opens on a day that looks real. Nothing here leaves the
 * server: the calls are ordinary sealed meetings in the account's vault. Google sign-in is real (providers/google.ts).
 */
import type { DemoProvider, MeetingInput } from '@alcove/api';
import { ValidationError } from '../../platform/errors';
import { nameFrom, type Identity } from '../../providers/identity';

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
