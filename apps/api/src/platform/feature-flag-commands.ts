/*
 * The feature-flags commands (docs: engineering/feature-flags.md): words in, the lines to say back out. The command
 * line (feature-flags-cli.ts) prints them, and inside the API the operator route answers with them
 * (features/operator/routes.ts), so both take the same words and say the same lines. Addresses are hashed here, with
 * the index key the API finds people by, under flags' own purpose (`flagHash`), so what's stored for one joins to no
 * account. Nothing said repeats an address, or anything else typed that isn't a flag or a group: it says flags, groups
 * and counts. Words it can't run are refused with an AppError whose message is what to say instead: how the commands
 * go, or which flags there are.
 */
import { FEATURE_FLAG_NAMES, FEATURE_FLAGS, isFeatureFlagName, type FeatureFlagName } from '@alcove/api';
import type { Db } from './db';
import { ValidationError } from './errors';
import type { OperatorScope } from '../keys/operator-keys';
import { addMembers, createGroup, deleteGroup, featureFlagReport, flagHash, grantGroup, grantPerson, groupNames, isMember, memberCount, removeMembers, revokeGroup, revokePerson, setEveryone } from './feature-flags';

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
/** Words that aren't a command: how the commands go. */
const usage = () => new ValidationError(USAGE, { context: { why: 'usage' } });

const COMMANDS = new Set(['list', 'groups', 'everyone', 'group', 'grant', 'revoke']);
/** The command the words name, for a log line: what was typed isn't logged when it's no command, as it may be an address. */
export const commandName = (words: string[]): string => (words[0] !== undefined && COMMANDS.has(words[0]) ? words[0] : 'unknown');
/**
 * What an operator's key needs to run the words through the operator route: `read` to list flags and groups, and to count a
 * group's members; `write` for anything else. Asking whether one address is in a group finds out something about a person
 * by their address, as finding an account by one does, so it takes a write key and a reason too.
 */
export const featureFlagScope = (words: string[]): OperatorScope =>
  (words[0] === 'list' || words[0] === 'groups' || (words[0] === 'group' && words[1] === 'members' && words.length <= 3) ? 'read' : 'write');

/** The flag named. What was typed isn't said back: it may be an address put in the wrong place. */
function featureFlagNamed(name: string | undefined): FeatureFlagName {
  if (name !== undefined && isFeatureFlagName(name)) return name;
  throw new ValidationError(`That isn't a flag. The flags are: ${FEATURE_FLAG_NAMES.join(', ')}.`, { context: { why: 'not a flag' } });
}

/** Runs one command, as the words of `feature-flags …`, and returns what it says. `indexKey` hashes the addresses. */
export async function runFeatureFlagCommand(db: Db, indexKey: Uint8Array, words: string[]): Promise<string[]> {
  const lines: string[] = [];
  const say = (text: string) => { lines.push(text); };
  const yes = (done: boolean, did: string, already: string) => say(done ? did : already);
  const hashes = (emails: string[]) => emails.map((e) => flagHash(indexKey, e));

  async function list(): Promise<void> {
    const { featureFlags, unknown } = await featureFlagReport(db);
    for (const f of featureFlags) {
      say(`${f.name}: ${FEATURE_FLAGS[f.name]}`);
      say(`  everyone: ${f.everyone ? 'on' : 'off'}; groups: ${f.groups.length ? f.groups.join(', ') : 'none'}; people: ${f.people}`);
    }
    for (const name of unknown) say(`Ignored: ${name}, not a flag in this build.`);
  }

  async function groups(): Promise<void> {
    const all = await groupNames(db);
    for (const g of all) say(`${g.name}: ${g.members} members`);
    if (!all.length) say('No groups yet: feature-flags group create <group>.');
  }

  async function group([action, name, ...emails]: string[]): Promise<void> {
    if (action === 'create' && name !== undefined && !emails.length) return yes(await createGroup(db, name), `Created ${name}.`, `${name} already exists.`);
    if (action === 'delete' && name !== undefined && !emails.length) return yes(await deleteGroup(db, name), `Deleted ${name}, its members and its grants.`, `There's no group called ${name}.`);
    if (action === 'add' && name !== undefined && emails.length) return say(`Added ${await addMembers(db, name, hashes(emails))} of ${emails.length} to ${name}.`);
    if (action === 'remove' && name !== undefined && emails.length) return say(`Removed ${await removeMembers(db, name, hashes(emails))} of ${emails.length} from ${name}.`);
    if (action === 'members' && name !== undefined && emails.length <= 1) {
      const [email] = emails;
      if (email !== undefined) return say(`That address ${(await isMember(db, name, flagHash(indexKey, email))) ? 'is' : 'is not'} in ${name}.`);
      return say(`${name} has ${await memberCount(db, name)} members. Addresses aren't kept: ask about one with feature-flags group members ${name} <email>.`);
    }
    throw usage();
  }

  async function grant(on: boolean, [featureFlagName, kind, ...who]: string[]): Promise<void> {
    const featureFlag = featureFlagNamed(featureFlagName);
    const [groupName] = who;
    if (kind === 'group' && groupName !== undefined && who.length === 1) {
      if (on) return yes(await grantGroup(db, featureFlag, groupName), `${featureFlag} is on for ${groupName}.`, `${featureFlag} was already on for ${groupName}.`);
      return yes(await revokeGroup(db, featureFlag, groupName), `${featureFlag} is no longer granted to ${groupName}.`, `${featureFlag} wasn't granted to ${groupName}.`);
    }
    if (kind === 'person' && who.length) {
      let changed = 0;
      for (const hash of hashes(who)) if (on ? await grantPerson(db, featureFlag, hash) : await revokePerson(db, featureFlag, hash)) changed++;
      return say(on ? `${featureFlag} is now on for ${changed} of ${who.length} addresses; the rest already had it.` : `${featureFlag} is no longer granted to ${changed} of ${who.length} addresses; the rest didn't have it.`);
    }
    throw usage();
  }

  async function everyone([featureFlagName, state, ...rest]: string[]): Promise<void> {
    if ((state !== 'on' && state !== 'off') || rest.length) throw usage();
    const featureFlag = featureFlagNamed(featureFlagName);
    yes(await setEveryone(db, featureFlag, state === 'on'), `${featureFlag} is ${state} for everyone.`, `${featureFlag} was already ${state} for everyone.`);
  }

  const [command, ...args] = words;
  if (command === 'list' && !args.length) await list();
  else if (command === 'groups' && !args.length) await groups();
  else if (command === 'everyone') await everyone(args);
  else if (command === 'group') await group(args);
  else if (command === 'grant' || command === 'revoke') await grant(command === 'grant', args);
  else throw usage();
  return lines;
}
