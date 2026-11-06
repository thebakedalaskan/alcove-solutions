import { z } from 'zod';
import type { Owner } from '../../context';
import { b64u, openRecord, sealRecord, stateKey, unb64u } from '../../crypto';
import { bytea, exec, type Db } from '../../db';

/* ---------- the call's MLS log: ordered and relayed here, read only in browsers ---------- */

type MlsKind = 'keypackage' | 'commit' | 'welcome' | 'message';

const mlsKey = (o: Owner, callId: string) => stateKey(o.root, o.ownerId, `call-mls:${callId}`);

/** Binds a log entry to its call, place in the log, kind and part of the call's group (none for a key package). */
const mlsHeader = (o: Owner, callId: string, seq: number, kind: MlsKind, grp: string | null) => ({ v: 1 as const, kind: 'call-mls', ownerId: o.ownerId, callId, seq, mlsKind: kind, grp });

export const MlsRow = z.object({ seq: z.coerce.number().int(), kind: z.enum(['keypackage', 'commit', 'welcome', 'message']), party: z.string().nullable(), grp: z.string().nullable(), epoch: z.coerce.number().int(), body_ciphertext: bytea });

/** Appends to the call's log at `seq` (the caller holds the call's row lock and moves mls_seq on): a key package (no group), or a commit, welcome or message for one part of the call's group. */
export async function appendMls(o: Owner, db: Db, callId: string, at: { seq: number; generation: number; epoch: number; grp: string | null }, kind: MlsKind, party: string | null, body: string): Promise<void> {
  await exec(db, 'INSERT INTO call_mls (owner_id, call_id, seq, generation, kind, party, grp, epoch, body_ciphertext) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [o.ownerId, callId, at.seq, at.generation, kind, party, at.grp, at.epoch, sealRecord(mlsKey(o, callId), mlsHeader(o, callId, at.seq, kind, at.grp), unb64u(body))]);
}

export const openMls = (o: Owner, callId: string, r: z.infer<typeof MlsRow>) => b64u(openRecord(mlsKey(o, callId), mlsHeader(o, callId, r.seq, r.kind, r.grp), r.body_ciphertext));
