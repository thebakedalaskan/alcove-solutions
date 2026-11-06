/* A committed pending reservation survives crashes: an uncertain creation is never silently repeated. */
import { AgentResourceIdSchema } from '@alcove/api';
import { z } from 'zod';
import { equalBytes, jcs, mac, openJson, sealJson, stateKey, toJson, utf8 } from '../../../crypto';
import { bytea, exec, maybeOne } from '../../../db';
import { ConflictError, InternalError } from '../../../errors';
import type { AgentPrincipal } from '../service';

const Receipt = z.object({ id: AgentResourceIdSchema });
const Row = z.object({ args_hash: bytea, state: z.enum(['pending', 'complete']), result_sealed: bytea.nullable() });

/** Stores only a created ID; replay runs the current domain access check before revealing that ID again. */
export async function created<T>(principal: AgentPrincipal, tool: string, operationId: string, args: unknown,
  make: () => Promise<string>, read: (id: string) => Promise<T>): Promise<T> {
  const { owner: o, connection } = principal;
  const key = stateKey(o.root, o.ownerId, `agent-operations:${connection.id}`);
  const header = { v: 1, kind: 'agent-operation', ownerId: o.ownerId, grantId: connection.id, operationId } as const;
  try {
    const hash = mac(key, utf8(jcs(toJson({ tool, args }))));
    const expires = new Date(Math.min(Date.now() + 86_400_000, new Date(connection.expiresAt).getTime()));
    const reserved = await exec(o.pool, `INSERT INTO agent_operations (owner_id, grant_id, operation_id, args_hash, state, created_at, expires_at)
      VALUES ($1,$2,$3,$4,'pending',now(),$5) ON CONFLICT (grant_id,operation_id) DO NOTHING`, [o.ownerId, connection.id, operationId, hash, expires]);
    if (!reserved) {
      const row = await maybeOne(o.pool, Row, 'SELECT args_hash,state,result_sealed FROM agent_operations WHERE owner_id=$1 AND grant_id=$2 AND operation_id=$3 AND expires_at>now()', [o.ownerId, connection.id, operationId]);
      if (!row) throw new ConflictError('This operation expired. Check whether it completed before starting another.');
      if (!equalBytes(hash, row.args_hash)) throw new ConflictError('That operation ID was already used with different arguments.');
      if (row.state !== 'complete' || !row.result_sealed) throw new ConflictError('This operation is pending or its outcome is uncertain. Check the current resource before starting another.');
      const receipt = openJson(key, header, row.result_sealed, Receipt);
      return read(receipt.id);
    }
    // The reservation commits before any domain mutation, including external Calendar requests.
    const id = AgentResourceIdSchema.parse(await make());
    const sealed = sealJson(key, header, { id });
    const completed = await exec(o.pool, `UPDATE agent_operations SET state='complete',result_sealed=$4 WHERE owner_id=$1 AND grant_id=$2 AND operation_id=$3 AND state='pending'`, [o.ownerId, connection.id, operationId, sealed]);
    if (!completed) throw new InternalError('The connection ended before the operation could be acknowledged.');
    return read(id);
  } finally { key.fill(0); }
}
