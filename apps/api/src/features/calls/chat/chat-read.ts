import type { Viewer } from '../participants';
import { requireIn } from '../participants';
import type { Stored } from '../state';
import { rows, type Db } from '../../../platform/db';
import { ForbiddenError } from '../../../platform/errors';
import { z } from 'zod';

const personKey = (v: Viewer): string => v.pass.role === 'host' ? 'organizer' : v.pass.person;

/** Only this person's receipts leave the sealed call state. A new connection keeps the same person's key. */
export const chatReadFor = (v: Viewer, s: Stored): string[] => v.inCall ? s.chatRead[personKey(v)] ?? [] : [];

/** Caller chooses only opaque message IDs: their own person is taken from the checked call pass. */
export async function readChat(v: Viewer, db: Db, callId: string, s: Stored, messages: readonly string[]): Promise<Stored> {
  requireIn(v, 'read-chat');
  // The viewer was checked before this transaction: removal or replacement can win the row lock meanwhile.
  if (s.removed.includes(v.pass.person) || !s.people.some((p) => p.identity === v.pass.identity && p.status === 'in')) {
    throw new ForbiddenError('You’re no longer in this call.', { context: { callId, what: 'read-chat' } });
  }
  const key = personKey(v);
  // Only actual encrypted messages in this call can grow its receipts. The body and who it addresses stay encrypted.
  const found = await rows(db, z.object({ id: z.string() }), `SELECT generation::text || ':' || seq::text AS id FROM call_mls
    WHERE owner_id = $1 AND call_id = $2 AND kind = 'message' AND generation::text || ':' || seq::text = ANY($3::text[])`, [v.organizer.ownerId, callId, messages]);
  // Receipts live as long as this call's encrypted chat. Dropping old IDs would make already-read messages unread again.
  const read = [...new Set([...(s.chatRead[key] ?? []), ...found.map((m) => m.id)])];
  return { ...s, chatRead: { ...s.chatRead, [key]: read } };
}
