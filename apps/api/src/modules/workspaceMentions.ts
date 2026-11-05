/*
 * Tags (docs: Data and storage › Tags): someone tagged in a document hears about it, on the workspace's stream if they're
 * here and whenever they're next here if not, so what they haven't heard waits, sealed, under the keyed hash access knows
 * them by. A tag gives nobody anything: someone who can't open the document isn't told, and whoever tagged them can't tell
 * from the answer. Nobody hears of a tag in something they can't open now, however long it waited, so all of this asks
 * workspaceAccess.ts at the moment it's told, and again each time it's read.
 */
import { PersonSchema, type MentionBody, type MentionNotice, type WorkspaceMention } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../context';
import { b64u, id128, openJson, sealJson, toJson, type RecordHeader } from '../crypto';
import { bytea, exec, rows, timestamp, tx, type Db } from '../db';
import { AppError } from '../errors';
import { publish } from '../live/hub';
import { TOLD } from '../live/room';
import { log } from '../log';
import {
  grantsFor, holdersOf, personIn, principalOf, requireDocument, roleOf, standingIn, trashOf, workspaceFor, workspaceKey, type Reader, type Who, type Workspace
} from './workspaceAccess';

const tlog = log.child({ component: 'mentions' });

/** How long a tag waits for someone who doesn't come back. */
export const MENTION_MS = 30 * 24 * 60 * 60_000;
/** How many tags wait for one person in one workspace: the newest. */
const MOST_WAITING = 200;
/** How many are read at once. */
const ONE_READ = 50;

const MentionInfo = z.object({ by: PersonSchema, block: z.string().nullable() });
const mentionHeader = (o: Owner, workspaceId: string, documentId: string, mentionId: string): RecordHeader => ({ v: 1, kind: 'workspace-mention', ownerId: o.ownerId, workspaceId, documentId, mentionId });
const Waiting = z.object({ mention_id: z.string(), document_id: z.string(), info_ciphertext: bytea, created_at: timestamp });
type Waiting = z.infer<typeof Waiting>;

const samePerson = (a: Who, b: Who): boolean => a.principals.some((p) => b.principals.some((q) => Buffer.compare(p, q) === 0));

/** Tells `tag.to`, if they can open the document. Under the workspace's lock, so nothing's told after either of them loses it. */
export async function mention(d: Deps, reader: Reader, workspaceId: string, documentId: string, tag: MentionBody): Promise<void> {
  const [target] = await grantsFor(reader, [tag.to], 'read');
  if (!target) return;
  const principal = principalOf(d, target);
  const who: Who = { email: target.kind === 'email' ? target.email : undefined, principals: [principal] };
  await tx(d.pool, async (c) => {
    const w = await workspaceFor(d, reader, workspaceId, c, 'hold');
    const { item } = requireDocument(reader, w, documentId, 'edit');
    if (samePerson(who, reader)) return;
    const theirs = standingIn(await holdersOf(c, w.owner.ownerId, who.principals), who);
    if (!roleOf(who, theirs, documentId, item)) {
      tlog.debug('someone tagged who can’t open this isn’t told', { workspaceId, documentId });
      return;
    }
    const mentionId = id128();
    const by = { ...personIn(w.owner, reader), email: '' };
    const sealed = sealJson(workspaceKey(w.owner), mentionHeader(w.owner, workspaceId, documentId, mentionId), toJson({ by, block: tag.block }));
    await exec(c, 'INSERT INTO workspace_mentions (owner_id, mention_id, document_id, principal_index, info_ciphertext) VALUES ($1,$2,$3,$4,$5)', [w.owner.ownerId, mentionId, documentId, principal, sealed]);
    await exec(c, `DELETE FROM workspace_mentions WHERE owner_id = $1 AND principal_index = $2 AND mention_id NOT IN (
      SELECT mention_id FROM workspace_mentions WHERE owner_id = $1 AND principal_index = $2 ORDER BY created_at DESC, mention_id LIMIT $3)`, [w.owner.ownerId, principal, MOST_WAITING]);
    await publish(c, workspaceId, `${TOLD}${b64u(principal)}`);
    tlog.info('someone tagged', { workspaceId, documentId, mentionId });
  });
}

/** What of these this person may hear of now. A tag in something they've lost goes: having it back later doesn't bring it back. One in Trash waits to see if it comes back. */
async function heard(who: Who, w: Workspace, waiting: Waiting[], db: Db): Promise<(WorkspaceMention & { name: string })[]> {
  const lost: string[] = [];
  const out = waiting.flatMap((m) => {
    const item = w.state.items[m.document_id];
    if (!item || !roleOf(who, w, m.document_id, item)) { lost.push(m.mention_id); return []; }
    if (trashOf(w.state, m.document_id)) return [];
    const { by, block } = openJson(workspaceKey(w.owner), mentionHeader(w.owner, w.workspaceId, m.document_id, m.mention_id), m.info_ciphertext, MentionInfo);
    return [{ id: m.mention_id, document: m.document_id, block, by, at: m.created_at.toISOString(), name: item.name }];
  });
  if (lost.length) await exec(db, 'DELETE FROM workspace_mentions WHERE owner_id = $1 AND mention_id = ANY($2::text[])', [w.owner.ownerId, lost]);
  return out;
}

/** What's waiting for someone in one workspace, the oldest first. For a stream, which holds no keys: they're opened for this and not kept. */
export async function waitingFor(d: Deps, who: Who, workspaceId: string): Promise<WorkspaceMention[]> {
  const w = await workspaceFor(d, who, workspaceId);
  const waiting = await rows(d.pool, Waiting, `SELECT mention_id, document_id, info_ciphertext, created_at FROM workspace_mentions
    WHERE owner_id = $1 AND principal_index = ANY($2::bytea[]) ORDER BY created_at, mention_id LIMIT $3`, [w.owner.ownerId, who.principals, ONE_READ]);
  return (await heard(who, w, waiting, d.pool)).map(({ name: _, ...m }) => m);
}

const WaitingIn = Waiting.extend({ workspace_id: z.string() });
/** What's waiting for someone in every workspace, the newest first, with what each document's called. */
export async function notices(d: Deps, reader: Reader): Promise<MentionNotice[]> {
  const waiting = await rows(d.pool, WaitingIn, `SELECT w.workspace_id, m.mention_id, m.document_id, m.info_ciphertext, m.created_at FROM workspace_mentions m
    JOIN workspaces w ON w.owner_id = m.owner_id WHERE m.principal_index = ANY($1::bytea[]) ORDER BY m.created_at DESC, m.mention_id LIMIT $2`, [reader.principals, ONE_READ]);
  const out: MentionNotice[] = [];
  for (const workspaceId of new Set(waiting.map((m) => m.workspace_id))) {
    try {
      const w = await workspaceFor(d, reader, workspaceId);
      out.push(...(await heard(reader, w, waiting.filter((m) => m.workspace_id === workspaceId), d.pool)).map((m) => ({ ...m, workspaceId })));
    } catch (e) {
      // Taken out of it, or it's gone, since the tag: there's nothing to hear.
      if (!(e instanceof AppError) || e.status >= 500) throw e;
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** They've heard: it isn't kept. Only they can say so, and saying so of something that's gone changes nothing. */
export async function seen(d: Deps, reader: Reader, workspaceId: string, mentionId: string): Promise<void> {
  const w = await workspaceFor(d, reader, workspaceId);
  await exec(d.pool, 'DELETE FROM workspace_mentions WHERE owner_id = $1 AND mention_id = $2 AND principal_index = ANY($3::bytea[])', [w.owner.ownerId, mentionId, reader.principals]);
}

/** Tags nobody came back for. */
export const sweepMentions = (d: Deps, ageMs: number = MENTION_MS): Promise<number> => exec(d.pool, 'DELETE FROM workspace_mentions WHERE created_at < $1', [new Date(Date.now() - ageMs)]);
