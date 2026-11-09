import { DirectEnvelopeSchema, DirectSendSchema, type DirectEnvelope, type DirectSend, type DirectSync } from '@alcove/api';
import { z } from 'zod';
import { type Owner } from '../../context';
import { mac, openJson, sealJson, stateKey, toJson, utf8 } from '../../crypto';
import { bytea, exec, maybeOne, rows, tx } from '../../db';
import { ConflictError, ForbiddenError } from '../../errors';
import { type Viewer, requireIn } from './participants';
import { placeOf, type Joined } from './places';
import { load, settle, type Stored } from './state';

const Row = z.object({ message_id: z.string(), seq: z.coerce.number().int().nonnegative(), ciphertext: bytea });
const StoredMessage = DirectEnvelopeSchema.extend({ fromStay: z.string(), toStay: z.string() });
type StoredMessage = z.infer<typeof StoredMessage>;
const header = (o: Owner, callId: string, id: string) => ({ v: 1 as const, kind: 'call-private-message', ownerId: o.ownerId, callId, messageId: id });
const key = (o: Owner, callId: string) => stateKey(o.root, o.ownerId, `call-private-message:${callId}`);
const save = (o: Owner, callId: string, m: StoredMessage) => sealJson(key(o, callId), header(o, callId, m.id), toJson(m));
const tag = (o: Owner, callId: string, identity: string) => mac(stateKey(o.root, o.ownerId, `call-private-routing:${callId}`), utf8(identity));
const opened = (o: Owner, callId: string, r: z.infer<typeof Row>): StoredMessage => ({ ...openJson(key(o, callId), header(o, callId, r.message_id), r.ciphertext, StoredMessage), order: r.seq });
const stay = (p: Joined) => `${p.since}:${p.placedAt}`;
function current(s: Stored, identity: string): Joined | undefined {
  return s.people.find((p) => p.identity === identity && p.status === 'in' && !p.replaced && !s.removed.includes(p.person));
}
function mine(v: Viewer, s: Stored): Joined {
  requireIn(v, 'private-message');
  const p = current(s, v.pass.identity);
  if (!p || p.person !== v.pass.person) throw new ForbiddenError('You’re no longer in this call.');
  return p;
}
function canDeliver(s: Stored, m: StoredMessage, generation: number): boolean {
  const from = current(s, m.from);
  const to = current(s, m.to);
  return m.generation === generation && !!from && !!to && placeOf(s, from) === m.place && placeOf(s, to) === m.place && stay(from) === m.fromStay && stay(to) === m.toStay;
}

/** Both membership checks happen under the call lock, including retries and recipient acknowledgments. */
export async function send(v: Viewer, callId: string, b: DirectSend): Promise<DirectEnvelope> {
  const o = v.organizer;
  return tx(o.pool, async (db) => {
    const { row, state } = await load(o, db, callId, true);
    if (row.state !== 'live') throw new ConflictError('This call has ended.');
    const s = settle(state, row);
    const from = mine(v, s);
    const to = current(s, b.to);
    if (!to || to.identity === from.identity || placeOf(s, from) !== b.place || placeOf(s, to) !== b.place || row.mls_generation !== b.generation) {
      throw new ConflictError('This person is no longer available in this room. Your message wasn’t sent.');
    }
    const existing = await maybeOne(db, Row, 'SELECT message_id, seq, ciphertext FROM call_private_messages WHERE owner_id = $1 AND call_id = $2 AND message_id = $3', [o.ownerId, callId, b.id]);
    if (existing) {
      const previous = opened(o, callId, existing);
      if (previous.from !== from.identity || JSON.stringify(DirectSendSchema.parse(previous)) !== JSON.stringify(b)) throw new ConflictError('This message ID already belongs to another message.');
      if (!canDeliver(s, previous, row.mls_generation)) throw new ConflictError('The original room connection has ended. This message wasn’t sent again.');
      return DirectEnvelopeSchema.parse(previous);
    }
    const counts = await maybeOne(db, z.object({ total: z.coerce.number(), sent: z.coerce.number() }), 'SELECT count(*) AS total, count(*) FILTER (WHERE sender_tag = $3) AS sent FROM call_private_messages WHERE owner_id = $1 AND call_id = $2', [o.ownerId, callId, tag(o, callId, from.identity)]);
    if (!counts || counts.total >= 2000 || counts.sent >= 500) throw new ConflictError('This call has as many private messages as it can keep. Your draft stays private.');
    const m: StoredMessage = { ...b, from: from.identity, fromStay: stay(from), toStay: stay(to), at: Math.max(0, (Date.now() - row.started_at.getTime()) / 1000), order: 0, delivered: false };
    const inserted = await maybeOne(db, z.object({ seq: z.coerce.number().int() }), 'INSERT INTO call_private_messages (owner_id, call_id, message_id, sender_tag, recipient_tag, ciphertext) VALUES ($1,$2,$3,$4,$5,$6) RETURNING seq', [o.ownerId, callId, b.id, tag(o, callId, from.identity), tag(o, callId, to.identity), save(o, callId, m)]);
    if (!inserted) throw new ConflictError('This message wasn’t confirmed. Retry privately.');
    return DirectEnvelopeSchema.parse({ ...m, order: inserted.seq });
  });
}

/** Bounded pages for this connection's keyed blind tag, never a scan of somebody else's payloads. */
export async function sync(v: Viewer, callId: string, acknowledge: readonly string[], after: number): Promise<DirectSync> {
  const o = v.organizer;
  return tx(o.pool, async (db) => {
    const { row, state } = await load(o, db, callId, true);
    if (row.state !== 'live') throw new ConflictError('This call has ended.');
    const s = settle(state, row);
    const me = mine(v, s);
    const mineTag = tag(o, callId, me.identity);
    const acks = await rows(db, Row, 'SELECT message_id, seq, ciphertext FROM call_private_messages WHERE owner_id = $1 AND call_id = $2 AND recipient_tag = $3 AND message_id = ANY($4::text[]) AND NOT delivered', [o.ownerId, callId, mineTag, acknowledge]);
    for (const raw of acks) {
      const m = opened(o, callId, raw);
      if (m.to === me.identity && canDeliver(s, m, row.mls_generation)) await exec(db, 'UPDATE call_private_messages SET ciphertext = $4, delivered = true WHERE owner_id = $1 AND call_id = $2 AND message_id = $3', [o.ownerId, callId, m.id, save(o, callId, { ...m, delivered: true })]);
    }
    const page = await rows(db, Row, 'SELECT message_id, seq, ciphertext FROM call_private_messages WHERE owner_id = $1 AND call_id = $2 AND (sender_tag = $3 OR recipient_tag = $3) AND seq > $4 ORDER BY seq LIMIT 101', [o.ownerId, callId, mineTag, after]);
    const read = page.slice(0, 100);
    const shown = read.flatMap((raw) => {
      const m = opened(o, callId, raw);
      return m.from === me.identity || (m.to === me.identity && canDeliver(s, m, row.mls_generation)) ? [DirectEnvelopeSchema.parse(m)] : [];
    });
    const receipts = await rows(db, z.object({ message_id: z.string() }), 'SELECT message_id FROM call_private_messages WHERE owner_id = $1 AND call_id = $2 AND sender_tag = $3 AND delivered ORDER BY seq', [o.ownerId, callId, mineTag]);
    return { peers: s.people.filter((p) => p.identity !== me.identity && current(s, p.identity) && placeOf(s, p) === placeOf(s, me)).map((p) => p.identity), messages: shown, delivered: receipts.map((r) => r.message_id), after: read.at(-1)?.seq ?? after, more: page.length > 100 };
  });
}
