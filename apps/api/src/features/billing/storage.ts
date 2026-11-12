/*
 * What an account stores, for its plan (docs: Plans and usage › Storage): its own recordings (call audio and shared
 * screens, counted on its own owner row) and every file in the workspaces it pays for (`workspaces.payer_owner_id`: the
 * shared ones it made, and its calls' own). Only sizes and counts are read here, never what's stored. Which shared
 * workspaces are read-only (`frozen_at`) is kept here too, and set again whenever what an account may have changes.
 */
import { z } from 'zod';
import { exec, maybeOne, rows, type Db } from '../../db';
import { log } from '../../log';

const slog = log.child({ component: 'storage' });
const bigintText = z.coerce.number().int().nonnegative();

/** What an account stores: its own row's bytes and those of every workspace it pays for. */
export async function usedBytes(db: Db, ownerId: string): Promise<number> {
  const r = await maybeOne(db, z.object({ bytes: bigintText }), `
    SELECT (SELECT coalesce(stored_bytes, 0) FROM owners WHERE owner_id = $1)
         + (SELECT coalesce(sum(o.stored_bytes), 0) FROM workspaces w JOIN owners o ON o.owner_id = w.owner_id WHERE w.payer_owner_id = $1) AS bytes`, [ownerId]);
  return r?.bytes ?? 0;
}

/** How many shared workspaces an account has made and pays for (a call's own don't count). */
export async function sharedMade(db: Db, ownerId: string): Promise<number> {
  const r = await maybeOne(db, z.object({ n: z.number().int() }), 'SELECT count(*)::int AS n FROM workspaces WHERE payer_owner_id = $1 AND NOT home', [ownerId]);
  return r?.n ?? 0;
}

/** Who pays for a workspace, by its owner row: null while nobody does (its payer deleted their account, until upkeep settles it). */
export async function payerOf(db: Db, workspaceOwnerId: string): Promise<string | null> {
  const r = await maybeOne(db, z.object({ payer_owner_id: z.string().nullable() }), 'SELECT payer_owner_id FROM workspaces WHERE owner_id = $1', [workspaceOwnerId]);
  return r?.payer_owner_id ?? null;
}

/**
 * Makes the account's shared workspaces past the oldest `allowed` read-only, and those within it as usual again (null:
 * every one is as usual). Each one that changes moves on a version, so whoever has it open reads it again. Returns the
 * workspaces' IDs that changed, to tell whoever's in them.
 */
export async function setFrozen(db: Db, ownerId: string, allowed: number | null): Promise<string[]> {
  const changed = await rows(db, z.object({ workspace_id: z.string(), frozen: z.boolean() }), `
    WITH ranked AS (
      SELECT owner_id, row_number() OVER (ORDER BY created_at, workspace_id) AS n FROM workspaces WHERE payer_owner_id = $1 AND NOT home
    )
    UPDATE workspaces w SET frozen_at = CASE WHEN $2::int IS NOT NULL AND r.n > $2::int THEN coalesce(w.frozen_at, now()) END, version = w.version + 1
    FROM ranked r
    WHERE w.owner_id = r.owner_id AND (w.frozen_at IS NOT NULL) <> ($2::int IS NOT NULL AND r.n > $2::int)
    RETURNING w.workspace_id, w.frozen_at IS NOT NULL AS frozen`, [ownerId, allowed]);
  for (const c of changed) slog.info(c.frozen ? 'workspace read-only, over its payer’s plan' : 'workspace as usual again', { workspaceId: c.workspace_id });
  return changed.map((c) => c.workspace_id);
}

/** Whether a workspace is read-only for everyone in it, because its payer has more shared workspaces than their plan. */
export async function frozen(db: Db, workspaceOwnerId: string): Promise<boolean> {
  const r = await maybeOne(db, z.object({ frozen: z.boolean() }), 'SELECT frozen_at IS NOT NULL AS frozen FROM workspaces WHERE owner_id = $1', [workspaceOwnerId]);
  return r?.frozen ?? false;
}

/**
 * Settles who pays for every workspace nobody does: one the previous release made while this one was deploying, or one
 * whose payer deleted their account. A shared one is paid for by whoever made it, if they're still here; anything else by
 * its first admin (a call's own: its organizer). Says how many it settled.
 */
export async function settlePayers(db: Db): Promise<number> {
  return exec(db, `
    UPDATE workspaces w SET
      home = NOT EXISTS (SELECT 1 FROM workspace_authors a WHERE a.owner_id = w.owner_id AND a.made_workspace),
      payer_owner_id = COALESCE(
        (SELECT i.owner_id FROM workspace_authors a JOIN identities i ON i.email_index = a.email_index
         WHERE a.owner_id = w.owner_id AND a.made_workspace ORDER BY i.created_at LIMIT 1),
        (SELECT i.owner_id FROM workspace_members m JOIN identities i ON i.email_index = m.email_index
         WHERE m.owner_id = w.owner_id AND m.role = 'admin' ORDER BY m.created_at, i.created_at LIMIT 1))
    WHERE w.payer_owner_id IS NULL`);
}
