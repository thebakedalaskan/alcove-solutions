/*
 * What an account stores, for its plan (docs: Plans and usage › Storage): its own recordings (call audio and shared
 * screens, counted on its own owner row) and every file in the workspaces it pays for (`workspaces.payer_owner_id`: the
 * shared ones it made, and its calls' own). Only sizes and counts are read here, never what's stored.
 */
import { z } from 'zod';
import { exec, maybeOne, type Db } from '../../db';

const bigintText = z.coerce.number().int().nonnegative();

/** What an account stores: its own row's bytes and those of every workspace it pays for. */
export async function usedBytes(db: Db, ownerId: string): Promise<number> {
  const r = await maybeOne(db, z.object({ bytes: bigintText }), `
    SELECT (SELECT coalesce(stored_bytes, 0) FROM owners WHERE owner_id = $1)
         + (SELECT coalesce(sum(o.stored_bytes), 0) FROM workspaces w JOIN owners o ON o.owner_id = w.owner_id WHERE w.payer_owner_id = $1) AS bytes`, [ownerId]);
  return r?.bytes ?? 0;
}

/** Who pays for a workspace, by its owner row: null while nobody does (its payer deleted their account, until upkeep settles it). */
export async function payerOf(db: Db, workspaceOwnerId: string): Promise<string | null> {
  const r = await maybeOne(db, z.object({ payer_owner_id: z.string().nullable() }), 'SELECT payer_owner_id FROM workspaces WHERE owner_id = $1', [workspaceOwnerId]);
  return r?.payer_owner_id ?? null;
}

/**
 * Settles who pays for every workspace nobody does: one the previous release made while this one was deploying, or one
 * whose payer deleted their account. A shared one is paid for by whoever made it, if they're still here; anything else by
 * its first admin (a call's own: its organizer). Says how many it settled.
 */
export async function settlePayers(db: Db): Promise<number> {
  return exec(db, `
    UPDATE workspaces w SET
      payer_owner_id = COALESCE(
        (SELECT i.owner_id FROM workspace_authors a JOIN identities i ON i.email_index = a.email_index
         WHERE a.owner_id = w.owner_id AND a.made_workspace ORDER BY i.created_at LIMIT 1),
        (SELECT i.owner_id FROM workspace_members m JOIN identities i ON i.email_index = m.email_index
         WHERE m.owner_id = w.owner_id AND m.role = 'admin' ORDER BY m.created_at, i.created_at LIMIT 1))
    WHERE w.payer_owner_id IS NULL`);
}
