/*
 * People to invite and share with: your company directory, people you've had calls with, and any
 * address typed in full. Whether someone uses Alcove is answered by email hash, so the server
 * never keeps a readable list of who is on Alcove.
 */
import type { PersonSuggestion, Team } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../../platform/context';
import { blindIndex } from '../../keys/crypto';
import { bytea, rows } from '../../platform/db';
import { MET, TEAM, inCompany } from '../profile/demo-directory';
import { companyOf, domainOf } from '../profile/companies';
import { log } from '../../platform/log';
import { indexKey } from '../../keys/owners';
import { profile } from '../profile/profile';
import { invitedOnYourTeam } from '../billing/teams/invitations';
import { metEmails } from './calendar';
import { all as allMeetings } from './service';
import { personOf } from '../profile/portraits';

const plog = log.child({ component: 'people' });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX = 8;
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Which of these addresses belong to an Alcove account. */
async function onAlcove(o: Owner, emails: string[]): Promise<Set<string>> {
  if (!emails.length) return new Set();
  const byIndex = new Map(emails.map((e) => [Buffer.from(blindIndex(indexKey(o), 'email', e)).toString('hex'), e]));
  const found = await rows(o.pool, z.object({ email_index: bytea }), 'SELECT DISTINCT email_index FROM identities WHERE email_index = ANY($1)', [[...byIndex.keys()].map((h) => Buffer.from(h, 'hex'))]);
  return new Set(found.flatMap((r) => { const e = byIndex.get(Buffer.from(r.email_index).toString('hex')); return e ? [e] : []; }));
}

export async function search(o: Owner, query: string): Promise<PersonSuggestion[]> {
  const mine = (await profile(o)).email;
  const q = fold(query.trim());
  const seen = new Set<string>([mine]);
  const pool: { email: string; name?: string | undefined; source: 'team' | 'met'; listed: boolean }[] = [];
  const add = (email: string, source: 'team' | 'met', name?: string, listed = false) => { if (!seen.has(email)) { seen.add(email); pool.push({ email, name, source, listed }); } };
  if (inCompany(mine)) {
    for (const c of TEAM) add(c.email, 'team', c.name, c.onAlcove);
    for (const c of MET) add(c.email, 'met', c.name, c.onAlcove);
  }
  for (const m of await allMeetings(o)) for (const e of m.manifest.guests) add(e, 'met');

  const matches = pool.filter((p) => !q || fold(p.email).includes(q) || fold(personOf(p.email, p.name).name).includes(q)).slice(0, MAX);
  const typed = query.trim().toLowerCase();
  const exact = EMAIL.test(typed) && typed !== mine && !matches.some((m) => m.email === typed) ? [{ email: typed, name: undefined, source: 'new' as const, listed: false }] : [];
  const out = [...exact, ...matches].slice(0, MAX);
  const users = await onAlcove(o, out.map((p) => p.email));
  plog.debug('people searched', { length: query.length, results: out.length });
  return out.map((p) => ({ person: personOf(p.email, p.name), source: p.source, onAlcove: p.listed || users.has(p.email) }));
}

interface Candidate { email: string; name?: string | undefined; title?: string | undefined; onAlcove: boolean }

/**
 * Who is at your company: the demo directory, or the colleagues at your work domain from your calls and calendar. Null at a
 * personal address. Its name is the company's (profile/companies.ts), as a team made for you takes it.
 */
async function candidates(o: Owner, mine: string): Promise<{ name: string; domain: string; people: Candidate[] } | null> {
  const company = companyOf(mine);
  if (!company) return null;
  if (inCompany(mine)) return { ...company, people: TEAM.filter((c) => c.email !== mine) };
  const { domain } = company;
  const seen = new Set<string>([mine]);
  const people: Candidate[] = [];
  const add = (raw: string) => { const email = raw.trim().toLowerCase(); if (domainOf(email) === domain && EMAIL.test(email) && !seen.has(email)) { seen.add(email); people.push({ email, onAlcove: false }); } };
  for (const m of await allMeetings(o)) for (const e of m.manifest.guests) add(e);
  for (const e of await metEmails(o)) add(e);
  return { ...company, people };
}

/** The addresses on your team: none at a personal address. Knowing them can take a calendar read of up to 4 seconds. */
export async function teammates(o: Owner): Promise<Set<string>> {
  return new Set(((await candidates(o, (await profile(o)).email))?.people ?? []).map((c) => c.email));
}

/**
 * Your company page; null at a personal address. Someone `invited` has a live invitation to the team you're on (none while
 * you're on no team).
 */
export async function team(o: Owner): Promise<Team | null> {
  const p = await profile(o);
  const t = await candidates(o, p.email);
  if (!t) return null;
  const emails = t.people.map((c) => c.email);
  const [users, invited] = await Promise.all([onAlcove(o, emails), invitedOnYourTeam(o, emails)]);
  return {
    name: t.name, domain: t.domain,
    members: t.people.map((c) => ({ person: personOf(c.email, c.name), ...(c.title ? { title: c.title } : {}), onAlcove: c.onAlcove || users.has(c.email), invited: invited.has(c.email) }))
  };
}
