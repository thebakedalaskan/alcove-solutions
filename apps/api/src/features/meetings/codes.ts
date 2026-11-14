/*
 * The call-code index: anyone with a call's link can find its meeting, not only its organizer. Rows hold a
 * keyed hash of the code (under the index key) and opaque IDs, so the database can't be matched to links.
 */
import { z } from 'zod';
import type { Deps } from '../../platform/context';
import { blindIndex } from '../../keys/crypto';
import { exec, maybeOne, type Db } from '../../platform/db';
import { indexKey } from '../../keys/owners';

const hashOf = (d: Deps, code: string) => blindIndex(indexKey(d), 'call-code', code);

/** Records where a call's code leads. Safe to repeat. */
export async function indexCode(d: Deps, db: Db, m: { ownerId: string; meetingId: string; code: string }): Promise<void> {
  await exec(db, `INSERT INTO call_codes (code_hash, owner_id, meeting_item_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [hashOf(d, m.code), m.ownerId, m.meetingId]);
}

/** The meeting a code leads to, for anyone. */
export async function lookupCode(d: Deps, code: string): Promise<{ ownerId: string; meetingId: string } | undefined> {
  const r = await maybeOne(d.pool, z.object({ owner_id: z.string(), meeting_item_id: z.string() }), 'SELECT owner_id, meeting_item_id FROM call_codes WHERE code_hash = $1', [hashOf(d, code)]);
  return r ? { ownerId: r.owner_id, meetingId: r.meeting_item_id } : undefined;
}
