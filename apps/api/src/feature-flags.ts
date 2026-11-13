/*
 * Feature flags (docs: engineering/feature-flags.md). A flag only switches something on, and is on for someone when any of
 * these says so: it's on for everyone; it's granted to a group their address is in; it's granted to their address. Nothing
 * says no. The names are in packages/api (FEATURE_FLAGS); the database says which are on, and for whom, as keyed hashes of
 * addresses with a purpose of their own (`flag-email`), never addresses: those rows join to nothing else, so switching a flag
 * for an address, as operators do through the API, says nothing of whose account it is. Each instance keeps a copy of all of
 * it and reads it again once the copy is FEATURE_FLAGS_CACHE_MS old, as limits.ts does, so a flag switched from
 * `feature-flags` is in force everywhere within that, and every instance that sees a change says so. The functions below
 * `featureFlagsFor` are what the feature-flags CLI does.
 */
import { FEATURE_FLAG_NAMES, isFeatureFlagName, type FeatureFlagName } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from './context';
import { b64u, blindIndex } from './crypto';
import { bytea, exec, maybeOne, rows, type Db } from './db';
import { NotFoundError, ValidationError } from './errors';
import { log } from './log';
import { indexKey } from './owners';
import { listItems } from './vault';

const featureFlagLog = log.child({ component: 'feature-flags' });

/**
 * The one place flags hash an address: its own purpose, `flag-email`, so no hash a flag keeps is one identities, sharing or a
 * workspace keeps, and none can be joined to them.
 */
export const flagHash = (key: Uint8Array, email: string): Uint8Array => blindIndex(key, 'flag-email', email);

/** What the database says, as one instance has it. Hashes are base64url, to compare by value. */
interface State {
  everyone: Set<FeatureFlagName>;
  /** By flag, the groups it's granted to. */
  groups: Map<FeatureFlagName, Set<string>>;
  /** By flag, the addresses it's granted to. */
  people: Map<FeatureFlagName, Set<string>>;
  /** By group, the addresses in it. */
  members: Map<string, Set<string>>;
  /** Names in the database that aren't flags here. */
  unknown: Set<string>;
}
const empty = (): State => ({ everyone: new Set(), groups: new Map(), people: new Map(), members: new Map(), unknown: new Set() });
const add = <K, V>(m: Map<K, Set<V>>, k: K, v: V) => { const s = m.get(k) ?? new Set<V>(); s.add(v); m.set(k, s); };

async function readState(db: Db): Promise<State> {
  const [everyone, groupGrants, personGrants, members] = await Promise.all([
    rows(db, z.object({ name: z.string() }), 'SELECT name FROM feature_flags_everyone'),
    rows(db, z.object({ feature_flag: z.string(), group_name: z.string() }), 'SELECT feature_flag, group_name FROM feature_flag_group_grants'),
    rows(db, z.object({ feature_flag: z.string(), email_index: bytea }), 'SELECT feature_flag, email_index FROM feature_flag_person_grants'),
    rows(db, z.object({ group_name: z.string(), email_index: bytea }), 'SELECT group_name, email_index FROM feature_flag_group_members')
  ]);
  const s = empty();
  for (const r of everyone) if (isFeatureFlagName(r.name)) s.everyone.add(r.name); else s.unknown.add(r.name);
  for (const r of groupGrants) if (isFeatureFlagName(r.feature_flag)) add(s.groups, r.feature_flag, r.group_name); else s.unknown.add(r.feature_flag);
  for (const r of personGrants) if (isFeatureFlagName(r.feature_flag)) add(s.people, r.feature_flag, b64u(r.email_index)); else s.unknown.add(r.feature_flag);
  for (const r of members) add(s.members, r.group_name, b64u(r.email_index));
  return s;
}

/**
 * What a flag's state comes to: whether it's on for everyone, which groups have it, and how many people have it directly
 * and through those groups. What's logged when it changes is the counts, never who.
 */
function summary(s: State, featureFlag: FeatureFlagName) {
  const groups = [...(s.groups.get(featureFlag) ?? [])].sort();
  const members = new Set(groups.flatMap((g) => [...(s.members.get(g) ?? [])]));
  return { everyone: s.everyone.has(featureFlag), granted: groups.join(' '), groups: groups.length, people: s.people.get(featureFlag)?.size ?? 0, members: members.size };
}

/** One instance's copy: when it was read, what it said, and which unknown names it has already warned about. */
interface Copy { at: number; state: State; noted: Set<string>; reading: Promise<void> | undefined }
/** One copy per database, which is one per process outside tests. */
const copies = new WeakMap<Db, Copy>();

/** Reads the flags into a copy and says what changed. If they can't be read, what was in force stays, until the next try. */
async function refresh(d: Pick<Deps, 'pool'>, copy: Copy): Promise<void> {
  copy.reading ??= (async () => {
    try {
      const next = await readState(d.pool);
      for (const name of next.unknown) if (!copy.noted.has(name)) featureFlagLog.warn('feature flag ignored', { featureFlag: name, why: 'not a flag' });
      copy.noted = next.unknown;
      for (const featureFlag of FEATURE_FLAG_NAMES) {
        const was = summary(copy.state, featureFlag);
        const now = summary(next, featureFlag);
        if (was.everyone !== now.everyone || was.granted !== now.granted || was.people !== now.people || was.members !== now.members) {
          featureFlagLog.info('feature flag changed', { featureFlag, everyone: now.everyone, groups: now.groups, people: now.people, members: now.members });
        }
      }
      copy.state = next;
    } catch (e) {
      featureFlagLog.warn('feature flags not read; keeping what was in force', { err: e });
    } finally {
      copy.at = performance.now();
      copy.reading = undefined;
    }
  })();
  await copy.reading;
}

async function stateNow(d: Pick<Deps, 'pool' | 'cfg'>): Promise<State> {
  let copy = copies.get(d.pool);
  if (!copy) {
    copy = { at: -Infinity, state: empty(), noted: new Set(), reading: undefined };
    copies.set(d.pool, copy);
  }
  if (performance.now() - copy.at >= d.cfg.FEATURE_FLAGS_CACHE_MS) await refresh(d, copy);
  return copy.state;
}

function onFor(s: State, hashes: string[]): ReadonlySet<FeatureFlagName> {
  const any = (set: Set<string> | undefined) => set !== undefined && hashes.some((x) => set.has(x));
  return new Set(FEATURE_FLAG_NAMES.filter((featureFlag) => s.everyone.has(featureFlag) || any(s.people.get(featureFlag)) || [...(s.groups.get(featureFlag) ?? [])].some((g) => any(s.members.get(g)))));
}

/** One answer per asker per request: the asker is the request's own object (its Owner), so the next request asks again. */
const answered = new WeakMap<object, Promise<ReadonlySet<FeatureFlagName>>>();
/** What flags read of a profile: the address it signs in with, which the provider keeps it up to date with. */
const Address = z.object({ email: z.string() });

/**
 * The flags on for someone: for an account, by the address it signs in with, hashed as flags hash it from its opened
 * profile; for nobody signed in, only those on for everyone.
 */
export function featureFlagsFor(d: Pick<Deps, 'pool' | 'cfg'>, who: Owner | undefined): Promise<ReadonlySet<FeatureFlagName>> {
  if (!who) return stateNow(d).then((s) => onFor(s, []));
  let found = answered.get(who);
  if (!found) {
    found = (async () => {
      const key = indexKey(who);
      const hashes = (await listItems(who, d.pool, 'profile', Address)).map((p) => b64u(flagHash(key, p.manifest.email)));
      key.fill(0);
      return onFor(await stateNow(d), hashes);
    })();
    answered.set(who, found);
  }
  return found;
}

/** Refuses what a flag gates when it's off for whoever asks, as if it weren't there. */
export function requireFeatureFlag(on: ReadonlySet<FeatureFlagName>, name: FeatureFlagName): void {
  if (!on.has(name)) throw new NotFoundError('That isn’t here.', { level: 'info', context: { featureFlag: name } });
}

/* ---------- what the feature-flags CLI does ---------- */

const GROUP_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
function groupName(name: string): string {
  if (!GROUP_NAME.test(name)) throw new ValidationError('A group’s name is lowercase letters, digits and dashes, starting with a letter or digit: staff, beta-testers.');
  return name;
}
async function existingGroup(db: Db, name: string): Promise<string> {
  const found = await maybeOne(db, z.object({ name: z.string() }), 'SELECT name FROM feature_flag_groups WHERE name = $1', [groupName(name)]);
  if (!found) throw new NotFoundError(`There’s no group called ${name}.`, { level: 'info', context: { group: name } });
  return found.name;
}

/** Switches a flag on or off for everyone. True if that changed anything. */
export async function setEveryone(db: Db, featureFlag: FeatureFlagName, on: boolean): Promise<boolean> {
  const changed = on
    ? await exec(db, 'INSERT INTO feature_flags_everyone (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [featureFlag])
    : await exec(db, 'DELETE FROM feature_flags_everyone WHERE name = $1', [featureFlag]);
  featureFlagLog.info('feature flag set for everyone', { featureFlag, on, changed: changed > 0 });
  return changed > 0;
}

export async function createGroup(db: Db, name: string): Promise<boolean> {
  const made = await exec(db, 'INSERT INTO feature_flag_groups (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [groupName(name)]);
  featureFlagLog.info('feature flag group created', { group: name, made: made > 0 });
  return made > 0;
}

/** Deletes a group, and with it its members and every grant to it. */
export async function deleteGroup(db: Db, name: string): Promise<boolean> {
  const gone = await exec(db, 'DELETE FROM feature_flag_groups WHERE name = $1', [groupName(name)]);
  featureFlagLog.info('feature flag group deleted', { group: name, deleted: gone > 0 });
  return gone > 0;
}

export function groupNames(db: Db): Promise<{ name: string; members: number }[]> {
  return rows(db, z.object({ name: z.string(), members: z.number() }), `SELECT g.name, count(m.email_index)::int AS members
    FROM feature_flag_groups g LEFT JOIN feature_flag_group_members m ON m.group_name = g.name GROUP BY g.name ORDER BY g.name`);
}

/** Adds addresses (as hashes) to a group. How many weren't in it already. */
export async function addMembers(db: Db, group: string, hashes: Uint8Array[]): Promise<number> {
  const name = await existingGroup(db, group);
  const added = await exec(db, 'INSERT INTO feature_flag_group_members (group_name, email_index) SELECT $1, unnest($2::bytea[]) ON CONFLICT DO NOTHING', [name, hashes]);
  featureFlagLog.info('feature flag group members added', { group: name, asked: hashes.length, added });
  return added;
}

/** Takes addresses (as hashes) out of a group. How many were in it. */
export async function removeMembers(db: Db, group: string, hashes: Uint8Array[]): Promise<number> {
  const name = await existingGroup(db, group);
  const removed = await exec(db, 'DELETE FROM feature_flag_group_members WHERE group_name = $1 AND email_index = ANY($2::bytea[])', [name, hashes]);
  featureFlagLog.info('feature flag group members removed', { group: name, asked: hashes.length, removed });
  return removed;
}

/** How many addresses are in a group: the database holds no addresses to list. */
export async function memberCount(db: Db, group: string): Promise<number> {
  const name = await existingGroup(db, group);
  return (await maybeOne(db, z.object({ n: z.number() }), 'SELECT count(*)::int AS n FROM feature_flag_group_members WHERE group_name = $1', [name]))?.n ?? 0;
}

export async function isMember(db: Db, group: string, hash: Uint8Array): Promise<boolean> {
  const name = await existingGroup(db, group);
  return (await exec(db, 'SELECT 1 FROM feature_flag_group_members WHERE group_name = $1 AND email_index = $2', [name, hash])) > 0;
}

export async function grantGroup(db: Db, featureFlag: FeatureFlagName, group: string): Promise<boolean> {
  const name = await existingGroup(db, group);
  const made = await exec(db, 'INSERT INTO feature_flag_group_grants (feature_flag, group_name) VALUES ($1, $2) ON CONFLICT DO NOTHING', [featureFlag, name]);
  featureFlagLog.info('feature flag granted to a group', { featureFlag, group: name, changed: made > 0 });
  return made > 0;
}

export async function revokeGroup(db: Db, featureFlag: FeatureFlagName, group: string): Promise<boolean> {
  const gone = await exec(db, 'DELETE FROM feature_flag_group_grants WHERE feature_flag = $1 AND group_name = $2', [featureFlag, groupName(group)]);
  featureFlagLog.info('feature flag revoked from a group', { featureFlag, group, changed: gone > 0 });
  return gone > 0;
}

export async function grantPerson(db: Db, featureFlag: FeatureFlagName, hash: Uint8Array): Promise<boolean> {
  const made = await exec(db, 'INSERT INTO feature_flag_person_grants (feature_flag, email_index) VALUES ($1, $2) ON CONFLICT DO NOTHING', [featureFlag, hash]);
  featureFlagLog.info('feature flag granted to a person', { featureFlag, changed: made > 0 });
  return made > 0;
}

export async function revokePerson(db: Db, featureFlag: FeatureFlagName, hash: Uint8Array): Promise<boolean> {
  const gone = await exec(db, 'DELETE FROM feature_flag_person_grants WHERE feature_flag = $1 AND email_index = $2', [featureFlag, hash]);
  featureFlagLog.info('feature flag revoked from a person', { featureFlag, changed: gone > 0 });
  return gone > 0;
}

/** Each flag here, who it's on for, and any name in the database that isn't a flag: for `feature-flags list`. */
export async function featureFlagReport(db: Db): Promise<{ featureFlags: { name: FeatureFlagName; everyone: boolean; groups: string[]; people: number }[]; unknown: string[] }> {
  const s = await readState(db);
  return {
    featureFlags: FEATURE_FLAG_NAMES.map((name) => ({ name, everyone: s.everyone.has(name), groups: [...(s.groups.get(name) ?? [])].sort(), people: s.people.get(name)?.size ?? 0 })),
    unknown: [...s.unknown].sort()
  };
}

/**
 * When an account is deleted: takes its address out of every group and grant, unless another account signs in with the
 * same address too (as note_access does). `key`: the index key. How many rows went.
 */
export async function forgetEmail(c: Db, key: Uint8Array, email: string, ownerId: string): Promise<number> {
  const others = await maybeOne(c, z.object({ one: z.number() }), 'SELECT 1 AS one FROM identities WHERE email_index = $1 AND owner_id <> $2 LIMIT 1', [blindIndex(key, 'email', email), ownerId]);
  if (others) return 0;
  const hash = flagHash(key, email);
  return (await exec(c, 'DELETE FROM feature_flag_group_members WHERE email_index = $1', [hash]))
    + (await exec(c, 'DELETE FROM feature_flag_person_grants WHERE email_index = $1', [hash]));
}
