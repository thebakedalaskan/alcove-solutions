/*
 * Who a document's Yjs clients are (docs: Data and storage › What gets into a document): each client a document's log has had,
 * tagged by everyone it's been written as, by a keyed hash, so a caret or an update can be told to be someone's, and the
 * clients the server writes as are always ones the log hasn't had.
 */
import { isServerClient } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../../../platform/context';
import { concat, equalBytes, mac, stateKey, utf8 } from '../../../keys/crypto';
import { bigintText, bytea, exec, rows, type Db } from '../../../platform/db';
import { ClientTakenError, ConflictError } from '../../../platform/errors';
import { log } from '../../../platform/log';
import { type Reader } from '../access';
import { clientsOf, type Block, type Inspected, type KnownClient } from './firewall';
import type { Place, DocRow } from './documents';

const dlog = log.child({ component: 'documents' });

/* ---------- who a client is ---------- */

/**
 * Who's written as a client: a keyed hash for each way access knows them, bound to the document and the client, so no two rows
 * can be linked. An account is one of those ways, because its address can change: what someone wrote or kept before a new
 * address is still theirs after it. What a call opens to everyone in it isn't one: it says nothing about who anyone is.
 */
const PERSON_TAG_BYTES = 32;
const clientsKey = (o: Owner, documentId: string): Uint8Array => stateKey(o.root, o.ownerId, `document-clients:${documentId}`);
const clientTag = (key: Uint8Array, client: number, principal: Uint8Array): Uint8Array => mac(key, concat(utf8(`${client}:`), principal));
export function tagsFor(o: Owner, documentId: string, client: number, r: Reader): Uint8Array[] {
  const key = clientsKey(o, documentId);
  return [...r.principals, ...(r.account ? [utf8(`account:${r.account.owner.ownerId}`)] : [])].map((p) => clientTag(key, client, p));
}
const tagsIn = (people: Uint8Array): Uint8Array[] => Array.from({ length: Math.floor(people.length / PERSON_TAG_BYTES) }, (_, i) => people.subarray(i * PERSON_TAG_BYTES, (i + 1) * PERSON_TAG_BYTES));
const ClientTags = z.object({ document_id: z.string(), client_id: bigintText, people: bytea });
/**
 * Someone's address changed, in the caller's transaction: every client in this workspace's documents that went by the old one
 * goes by the new one, so a tab of theirs that's open, or words they kept offline, carry on. Rows from before clients went by
 * account too have only the address to go by.
 */
export async function moveClientTags(o: Owner, db: Db, from: Uint8Array, to: Uint8Array): Promise<number> {
  const found = await rows(db, ClientTags, 'SELECT document_id, client_id, people FROM document_clients WHERE owner_id = $1', [o.ownerId]);
  const keys = new Map<string, Uint8Array>();
  let moved = 0;
  for (const r of found) {
    const key = keys.get(r.document_id) ?? clientsKey(o, r.document_id);
    keys.set(r.document_id, key);
    const was = clientTag(key, r.client_id, from);
    const tags = tagsIn(r.people);
    if (!tags.some((t) => equalBytes(t, was))) continue;
    const now = clientTag(key, r.client_id, to);
    const people = concat(...tags.filter((t) => !equalBytes(t, was) && !equalBytes(t, now)), now);
    await exec(db, 'UPDATE document_clients SET people = $4 WHERE owner_id = $1 AND document_id = $2 AND client_id = $3', [o.ownerId, r.document_id, r.client_id, Buffer.from(people)]);
    moved += 1;
  }
  if (moved) dlog.info('document clients moved to a new address', { workspaceOwner: o.ownerId, clients: moved });
  return moved;
}
/** What the server writes belongs to nobody, so no browser can write as it. */
export const nobody = (): Uint8Array => new Uint8Array(0);

const ClientRow = z.object({ client_id: bigintText, next_clock: bigintText, people: bytea });
export async function knownClients(c: Db, p: Place, documentId: string, seen: Inspected): Promise<Map<number, KnownClient>> {
  const found = await rows(c, ClientRow, 'SELECT client_id, next_clock, people FROM document_clients WHERE owner_id = $1 AND document_id = $2 AND client_id = ANY($3::bigint[])', [p.owner.ownerId, documentId, clientsOf(seen)]);
  return new Map(found.map((r) => [r.client_id, { next: r.next_clock, people: tagsIn(r.people) }]));
}
/**
 * What the server writes into a document's log as a change of its own goes only as Yjs clients the log hasn't had, asked under
 * the row's lock in the transaction that appends it: two updates that say different things under one client and clock leave
 * browsers disagreeing for good, and nothing tells anyone. `writeDocument` and a restore are the only ways the server makes a
 * change, and both ask this first, of the clients they write as. A client that's taken is `ClientTakenError`, for working the
 * change out again on what's there now: a random one gets past that, and a fixed one (`SERVER_CLIENT`) finds what was written
 * as it, which is how it's written once. A fixed one the log had already when the change was worked out, in a row that won't
 * open or from before a version was put back, is the same every time, so that's refused for good. `read`: where the log the
 * change was worked out on ended (`markOf`), from that log itself, so nothing that landed while it was being read counts as before.
 */
export async function requireNewClients(c: Db, p: Place, documentId: string, locked: DocRow, x: { read: number; clients: number[]; what: string }): Promise<void> {
  if (!x.clients.length) return;
  const taken = (await rows(c, z.object({ client_id: bigintText }), 'SELECT client_id FROM document_clients WHERE owner_id = $1 AND document_id = $2 AND client_id = ANY($3::bigint[])', [p.owner.ownerId, documentId, x.clients])).map((r) => r.client_id);
  if (!taken.length) return;
  const context = { workspaceId: p.workspaceId, documentId, what: x.what, taken: taken.length };
  if (locked.next_seq === x.read && taken.some(isServerClient)) throw new ConflictError('This document has had this change already, so it can’t have it again.', { context });
  throw new ClientTakenError(undefined, { context });
}
/** How often a change from the server is worked out again because a client it was written as was taken first. */
export const WRITE_TRIES = 3;
export const workedOutAgain = (workspaceId: string, documentId: string, what: string, tries: number) => dlog.debug('server change worked out again: a client it was written as was taken', { workspaceId, documentId, what, tries });

/** Moves on how far each client has written, gives anyone new to whoever wrote first, and takes whatever else it's told a client goes by. The server's own say nothing, and change nothing. */
export async function noteClients(c: Db, p: Place, documentId: string, blocks: Block[], people: (client: number) => Uint8Array): Promise<void> {
  if (!blocks.length) return;
  await exec(c, `INSERT INTO document_clients (owner_id, document_id, client_id, next_clock, people)
                 SELECT $1, $2, t.client, t.next, t.people FROM unnest($3::bigint[], $4::bigint[], $5::bytea[]) AS t(client, next, people)
                 ON CONFLICT (owner_id, document_id, client_id) DO UPDATE SET next_clock = greatest(document_clients.next_clock, EXCLUDED.next_clock),
                   people = CASE WHEN octet_length(EXCLUDED.people) > 0 THEN EXCLUDED.people ELSE document_clients.people END`, [
    p.owner.ownerId, documentId, blocks.map((b) => b.client), blocks.map((b) => b.to), blocks.map((b) => Buffer.from(people(b.client)))
  ]);
}
