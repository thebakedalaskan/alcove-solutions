/*
 * People to invite and share with: your company directory, people you've had calls with, and any
 * address typed in full. Whether someone uses Alcove is answered by email hash, so the server
 * never keeps a readable list of who is on Alcove.
 */
import type { PersonSuggestion, Team } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../context';
import { blindIndex } from '../crypto';
import { bytea, rows } from '../db';
import { COMPANY, MET, TEAM, inCompany } from '../demo';
import { ValidationError } from '../errors';
import { log } from '../log';
import { masterKey } from '../owners';
import { profile, updateProfile } from './account';
import { all as allMeetings } from './meetings';
import { personOf } from './portraits';

const plog = log.child({ component: 'people' });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX = 8;
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Which of these addresses belong to an Alcove account. */
async function onAlcove(o: Owner, emails: string[]): Promise<Set<string>> {
  if (!emails.length) return new Set();
  const byIndex = new Map(emails.map((e) => [Buffer.from(blindIndex(masterKey(o), 'email', e)).toString('hex'), e]));
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

/** Your company's directory; null for an account outside any company we know. */
export async function team(o: Owner): Promise<Team | null> {
  const p = await profile(o);
  if (!inCompany(p.email)) return null;
  const users = await onAlcove(o, TEAM.map((c) => c.email));
  return {
    name: COMPANY.name, domain: COMPANY.domain,
    members: TEAM.filter((c) => c.email !== p.email).map((c) => ({ person: personOf(c.email, c.name), onAlcove: c.onAlcove || users.has(c.email), invited: p.invited.includes(c.email) }))
  };
}

/** Invites colleagues from the directory. Only people in your company can be invited this way. */
export async function inviteToTeam(o: Owner, emails: string[]): Promise<Team> {
  const known = new Set(TEAM.map((c) => c.email));
  const outside = emails.filter((e) => !known.has(e));
  if (!inCompany((await profile(o)).email) || outside.length) throw new ValidationError('Only people in your company directory can be invited to your team.', { context: { outside: outside.length } });
  await updateProfile(o, (p) => ({ ...p, invited: [...new Set([...p.invited, ...emails])] }));
  plog.info('team invites sent', { count: emails.length });
  const t = await team(o);
  if (!t) throw new ValidationError('You don’t have a company directory.');
  return t;
}
