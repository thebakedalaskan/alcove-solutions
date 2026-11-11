import { OPERATION_HEADER } from '@alcove/api';
import { Hono } from 'hono';
import { z } from 'zod';
import { equalBytes, mac, operationCommitKey, operationResultKey, openJson, sealJson, utf8 } from '../crypto';
import { bytea, exec, maybeOne } from '../db';
import { ConflictError, ValidationError } from '../errors';
import { MUTATING } from './middleware';
import { type Env } from './context';
import type { HttpRuntime } from './runtime';

/**
 * Mutations that keep no stored receipt. Searching, asking, translating captions and reading who's busy only read. Audio
 * pieces and transcript clips are already idempotent by their place in the recording (and their
 * answers carry the live transcript, which shouldn't be copied into receipts). Proposing a decision or
 * follow-up, changing a note's decisions, open questions, follow-ups and transcript lines, sharing it,
 * and having it written again each set an explicit state (the same words proposed again add nothing),
 * so a retry changes nothing; and their answer is the whole note, which a receipt kept under someone
 * it was given to would still hold after the organizer deleted it. Saying whether you're coming to a
 * call is the same: it sets one value, and what comes back is the organizer's call. Someone's own
 * notes, and what they add to the shared notes (from them, or written straight in), keep none either:
 * deleting them must leave no copy of what they said for a day. Deleting the account deletes its receipts, so there is no account left to
 * keep one under. Answering a ring sets an explicit state too, and a receipt's clear method and time
 * would say an account was rung for a day after the ring had gone. What a guest can reach of a workspace
 * comes before receipts altogether, so it isn't listed here: see the routes.
 */
const NO_RECEIPT = [
  /^\/v1\/drive(?:\/.*)?$/,
  /^\/v1\/agents\/tokens$/, /^\/v1\/agents\/authorization\/[^/]+$/,
  /^\/v1\/calendar\/busy$/,
  /^\/v1\/notes\/search$/, /^\/v1\/notes\/(?:[^/]+\/)?ask$/, /^\/v1\/series\/[^/]+\/ask$/, /^\/v1\/live\/calls\/[^/]+\/(?:catch-up|ask|series\/ask|translate|notes\/watch)$/,
  /^\/v1\/(?:live\/calls|recordings)\/[^/]+\/(?:audio|transcribe)$/, /^\/v1\/live\/calls\/[^/]+\/shares\/[^/]+\/video$/,
  /^\/v1\/notes\/[^/]+\/(?:(?:decisions|questions|actions|lines)(?:\/[^/]+)?|revisits\/[^/]+|share|rewrite)$/, /^\/v1\/meetings\/[^/]+\/answer$/, /^\/v1\/account$/, /^\/v1\/rings\/[^/]+\/answer$/,
  /^\/v1\/notes\/[^/]+\/(?:personal(?:\/[^/]+(?:\/(?:preview|add))?)?|additions(?:\/[^/]+)?)$/
];

const keepsReceipt = (path: string) => !NO_RECEIPT.some((r) => r.test(path));

const StoredResult = z.object({ status: z.number(), body: z.string() });

export function registerReceiptMiddleware(app: Hono<Env>, runtime: HttpRuntime): void {
  const { d } = runtime;

  /* Mutations are idempotent by operation ID (docs: Network and API contract). */
  app.use('/v1/*', async (c, next) => {
    const opId = c.req.header(OPERATION_HEADER);
    if (!opId || !MUTATING.has(c.req.method) || !keepsReceipt(c.req.path)) return next();
    if (!/^[A-Za-z0-9_-]{22}$/.test(opId)) throw new ValidationError('Malformed operation ID.');
    const o = c.get('owner');
    const reqBytes = new Uint8Array(await c.req.raw.clone().arrayBuffer());
    const commitment = mac(operationCommitKey(o.root, o.ownerId), new Uint8Array([...utf8(`${c.req.method} ${c.req.path}\n`), ...reqBytes]));
    const hdr = { v: 1 as const, kind: 'operation-result', ownerId: o.ownerId, operationId: opId };
    const prior = await maybeOne(d.pool, z.object({ request_commitment: bytea, result_ciphertext: bytea }), 'SELECT request_commitment, result_ciphertext FROM operations WHERE owner_id = $1 AND operation_id = $2', [o.ownerId, opId]);
    if (prior) {
      if (!equalBytes(prior.request_commitment, commitment)) throw new ConflictError('That operation ID was already used for a different request.');
      const r = openJson(operationResultKey(o.root, o.ownerId), hdr, prior.result_ciphertext, StoredResult);
      return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json' } });
    }
    await next();
    if (c.res.ok && (c.res.headers.get('content-type') ?? '').includes('application/json')) {
      const text = c.get('receipt') ?? await c.res.clone().text();
      await exec(d.pool, `INSERT INTO operations (owner_id, operation_id, method, request_commitment, result_ciphertext, completed_at) VALUES ($1,$2,$3,$4,$5,now()) ON CONFLICT DO NOTHING`,
        [o.ownerId, opId, `${c.req.method} ${c.req.routePath}`, commitment, sealJson(operationResultKey(o.root, o.ownerId), hdr, { status: c.res.status, body: text })]);
    }
    return undefined;
  });
}
