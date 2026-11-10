import { FEATURE_FLAG_NAMES, FEATURE_FLAGS, isFeatureFlagName, type FeatureFlagName } from '@alcove/api';
import { z } from 'zod';
import { unb64u } from './crypto';
import { createPool, type Db } from './db';
import { AppError } from './errors';
import { addMembers, createGroup, deleteGroup, emailHash, featureFlagReport, grantGroup, grantPerson, groupNames, isMember, memberCount, removeMembers, revokeGroup, revokePerson, setEveryone } from './feature-flags';
import { configureLogging, flushLogs, log } from './log';

/**
 * `pnpm --filter @alcove/server feature-flags …` switches feature flags on and off, for everyone, for groups and for people, in
 * whichever database DATABASE_URL names (docs: engineering/feature-flags.md). Unlike `limits` it needs KMASTER, to hash
 * the addresses it's given as the API does: locally from .env, and in production as the Cloud Run job alcove-feature-flags, which
 * has it bound, so the key never reaches a laptop. Every instance takes a change within FEATURE_FLAGS_CACHE_MS, with no restart.
 * Nothing it says, here or in its log, repeats an address or anything else typed that isn't a flag or a group: in the
 * job, what it prints goes to Cloud Logging. It says flags, groups and counts.
 */
const env = z.object({
  DATABASE_URL: z.string().url(),
  KMASTER: z.string().min(1),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('pretty')
}).parse(process.env);
configureLogging({ level: env.LOG_LEVEL, format: env.LOG_FORMAT, service: 'alcove-feature-flags' });
const kmaster = unb64u(env.KMASTER, 32);

const USAGE = `feature-flags list
feature-flags everyone <feature-flag> on|off
feature-flags groups
feature-flags group create <group>
feature-flags group delete <group>
feature-flags group add <group> <email>…
feature-flags group remove <group> <email>…
feature-flags group members <group> [<email>]
feature-flags grant <feature-flag> group <group>
feature-flags revoke <feature-flag> group <group>
feature-flags grant <feature-flag> person <email>…
feature-flags revoke <feature-flag> person <email>…

${FEATURE_FLAG_NAMES.map((name) => `  ${name}  ${FEATURE_FLAGS[name]}`).join('\n')}
`;
const say = (text: string) => { process.stdout.write(`${text}\n`); };
const yes = (done: boolean, did: string, already: string) => say(done ? did : already);

async function list(db: Db): Promise<void> {
  const { featureFlags, unknown } = await featureFlagReport(db);
  for (const f of featureFlags) {
    say(`${f.name}: ${FEATURE_FLAGS[f.name]}`);
    say(`  everyone: ${f.everyone ? 'on' : 'off'}; groups: ${f.groups.length ? f.groups.join(', ') : 'none'}; people: ${f.people}`);
  }
  for (const name of unknown) say(`Ignored: ${name}, not a flag in this build.`);
}

/** The flag named, or nothing after saying which there are. */
function featureFlagNamed(name: string | undefined): FeatureFlagName | undefined {
  if (name !== undefined && isFeatureFlagName(name)) return name;
  // What was typed isn't logged: it may be an address put in the wrong place.
  log.warn('feature flags refused', { why: 'not a flag' });
  say(`That isn't a flag. The flags are: ${FEATURE_FLAG_NAMES.join(', ')}.`);
  return undefined;
}

async function group(db: Db, [action, name, ...emails]: string[]): Promise<boolean> {
  if (action === 'create' && name !== undefined && !emails.length) { yes(await createGroup(db, name), `Created ${name}.`, `${name} already exists.`); return true; }
  if (action === 'delete' && name !== undefined && !emails.length) { yes(await deleteGroup(db, name), `Deleted ${name}, its members and its grants.`, `There's no group called ${name}.`); return true; }
  if (action === 'add' && name !== undefined && emails.length) { say(`Added ${await addMembers(db, name, emails.map((e) => emailHash(kmaster, e)))} of ${emails.length} to ${name}.`); return true; }
  if (action === 'remove' && name !== undefined && emails.length) { say(`Removed ${await removeMembers(db, name, emails.map((e) => emailHash(kmaster, e)))} of ${emails.length} from ${name}.`); return true; }
  if (action === 'members' && name !== undefined && emails.length <= 1) {
    const [email] = emails;
    if (email !== undefined) say(`That address ${(await isMember(db, name, emailHash(kmaster, email))) ? 'is' : 'is not'} in ${name}.`);
    else say(`${name} has ${await memberCount(db, name)} members. Addresses aren't kept: ask about one with feature-flags group members ${name} <email>.`);
    return true;
  }
  say(USAGE);
  return false;
}

async function grant(db: Db, on: boolean, [featureFlagName, kind, ...who]: string[]): Promise<boolean> {
  const featureFlag = featureFlagNamed(featureFlagName);
  if (!featureFlag) return false;
  const [groupName] = who;
  if (kind === 'group' && groupName !== undefined && who.length === 1) {
    if (on) yes(await grantGroup(db, featureFlag, groupName), `${featureFlag} is on for ${groupName}.`, `${featureFlag} was already on for ${groupName}.`);
    else yes(await revokeGroup(db, featureFlag, groupName), `${featureFlag} is no longer granted to ${groupName}.`, `${featureFlag} wasn't granted to ${groupName}.`);
    return true;
  }
  if (kind === 'person' && who.length) {
    let changed = 0;
    for (const email of who) {
      const hash = emailHash(kmaster, email);
      if (on ? await grantPerson(db, featureFlag, hash) : await revokePerson(db, featureFlag, hash)) changed++;
    }
    say(on ? `${featureFlag} is now on for ${changed} of ${who.length} addresses; the rest already had it.` : `${featureFlag} is no longer granted to ${changed} of ${who.length} addresses; the rest didn't have it.`);
    return true;
  }
  say(USAGE);
  return false;
}

async function everyone(db: Db, [featureFlagName, state, ...rest]: string[]): Promise<boolean> {
  if ((state !== 'on' && state !== 'off') || rest.length) { say(USAGE); return false; }
  const featureFlag = featureFlagNamed(featureFlagName);
  if (!featureFlag) return false;
  yes(await setEveryone(db, featureFlag, state === 'on'), `${featureFlag} is ${state} for everyone.`, `${featureFlag} was already ${state} for everyone.`);
  return true;
}

async function run(db: Db, [command, ...args]: string[]): Promise<boolean> {
  if (command === 'list' && !args.length) { await list(db); return true; }
  if (command === 'groups' && !args.length) {
    const groups = await groupNames(db);
    for (const g of groups) say(`${g.name}: ${g.members} members`);
    if (!groups.length) say('No groups yet: feature-flags group create <group>.');
    return true;
  }
  if (command === 'everyone') return everyone(db, args);
  if (command === 'group') return group(db, args);
  if (command === 'grant' || command === 'revoke') return grant(db, command === 'grant', args);
  say(USAGE);
  return false;
}

const pool = createPool(env.DATABASE_URL);
try {
  process.exitCode = (await run(pool, process.argv.slice(2))) ? 0 : 1;
} catch (e) {
  // A refusal (no such group, a name that can't be one) says why; anything else failed.
  if (e instanceof AppError) { log.warn('feature flags refused', { code: e.code }); say(e.message); } else log.error('feature flags failed', { err: e });
  process.exitCode = 1;
} finally {
  await pool.end();
  flushLogs();
}
