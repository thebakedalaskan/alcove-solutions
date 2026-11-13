/*
 * What an account stores, for its plan (docs: Plans and usage › Storage): its own recordings (call audio and shared
 * screens, counted on its own owner row) and every file in the workspaces it pays for (`workspaces.payer_owner_id`: the
 * shared ones it made, its calls' own, and any whose payment moved to it as their admin). Only sizes and counts are read
 * here, never what's stored.
 */
import { z } from 'zod';
import type { Config } from '../../config';
import type { Deps } from '../../context';
import { bigintText, maybeOne, rows, timestamp, tx, type Db } from '../../db';
import { limitsNow } from '../../limits';
import { publish } from '../../live/hub';
import { log } from '../../log';
import { TREE_NOTICE } from '../workspaces/access';

type Service = Pick<Deps, 'pool'> & { cfg: Pick<Config, 'LIMITS_CACHE_MS'> };
const slog = log.child({ component: 'storage' });

/** What an account stores: its own row's bytes and those of every workspace it pays for. */
export async function usedBytes(db: Db, ownerId: string): Promise<number> {
  const r = await maybeOne(db, z.object({ bytes: bigintText }), `
    SELECT (SELECT coalesce(stored_bytes, 0) FROM owners WHERE owner_id = $1)
         + (SELECT coalesce(sum(o.stored_bytes), 0) FROM workspaces w JOIN owners o ON o.owner_id = w.owner_id WHERE w.payer_owner_id = $1) AS bytes`, [ownerId]);
  return r?.bytes ?? 0;
}

/**
 * What's on top of an account's storage at `now` (or a team's pool, everyone licensed on it now) for workspaces whose
 * payment moved to it from someone who left them: the bytes each held as it moved, at most what it holds now, until its
 * grace ends; and the soonest end of those (null: none runs). What's been added since counts as anything else does.
 */
export async function takenOver(db: Db, whose: { ownerId: string } | { teamId: string }, now = Date.now()): Promise<{ bytes: number; until: number | null }> {
  const payers = 'ownerId' in whose
    ? 'w.payer_owner_id = $1'
    : 'w.payer_owner_id IN (SELECT account_owner_id FROM team_members WHERE team_id = $1 AND licensed_from <= $2 AND licensed_until > $2)';
  const r = await maybeOne(db, z.object({ bytes: bigintText, until: timestamp.nullable() }), `
    SELECT coalesce(sum(least(w.payer_grace_bytes, o.stored_bytes)), 0) AS bytes, min(w.payer_grace_until) AS until
    FROM workspaces w JOIN owners o ON o.owner_id = w.owner_id
    WHERE ${payers} AND w.payer_grace_until > $2`, ['ownerId' in whose ? whose.ownerId : whose.teamId, new Date(now)]);
  const bytes = r?.bytes ?? 0;
  return { bytes, until: bytes > 0 && r?.until ? r.until.getTime() : null };
}

/**
 * Who pays for a workspace, by its owner row: null while nobody does, when none of its admins has an account (or its payer
 * just deleted theirs, until upkeep settles it). Then it takes no files, and its AI is paid for by whoever asks.
 */
export async function payerOf(db: Db, workspaceOwnerId: string): Promise<string | null> {
  const r = await maybeOne(db, z.object({ payer_owner_id: z.string().nullable() }), 'SELECT payer_owner_id FROM workspaces WHERE owner_id = $1', [workspaceOwnerId]);
  return r?.payer_owner_id ?? null;
}

/**
 * A change of who pays for a workspace, by its owner row and its ID: from whom (null: nobody did) to whom (null: none of
 * its admins has an account), and until when its files don't count against them (null: no grace runs).
 */
export interface PayerMove { workspaceOwnerId: string; workspaceId: string; from: string | null; to: string | null; graceUntil: Date | null }
const Held = z.object({ workspace_id: z.string(), payer_owner_id: z.string().nullable(), still_in: z.boolean() });

/**
 * Settles who pays for one workspace, in the caller's transaction, holding its row: nothing changes while whoever pays is
 * in it, so nobody keeps paying for a workspace they can't open. Otherwise (its payer left or was taken out, deleted their
 * account, or nobody paid yet) it's paid for by its longest-standing admin with an account (for a new one, whoever made
 * it, or a call's organizer for its own), else by nobody, and then it takes no files (features/workspaces/media.ts). An
 * admin whose account is being deleted at that moment, its row held for that, is passed over rather than waited for: the
 * deletion may be waiting for this workspace. When payment moves from someone to someone else, its files don't count
 * against the new payer for `workspaces.payer_grace_seconds`: what it holds then is on top of their storage until that ends
 * (`takenOver`). A grace still running when it moves again goes on as it was, to the same end and over the same bytes, so
 * passing a workspace back and forth makes no more room than moving it once. A team's workspace whose payment moves to
 * someone who isn't on its team, or to nobody, stops being the team's (`offTeam`). Says what moved (null: nothing did), for
 * the caller to refuse or tell (plans.ts `tellPayers`) once it has committed.
 */
export async function settlePayer(d: Service, c: Db, workspaceOwnerId: string): Promise<PayerMove | null> {
  const w = await maybeOne(c, Held, `
    SELECT w.workspace_id, w.payer_owner_id, EXISTS (
      SELECT 1 FROM workspace_members m JOIN identities i ON i.email_index = m.email_index
      WHERE m.owner_id = w.owner_id AND i.owner_id = w.payer_owner_id) AS still_in
    FROM workspaces w WHERE w.owner_id = $1 FOR NO KEY UPDATE`, [workspaceOwnerId]);
  if (!w || (w.payer_owner_id !== null && w.still_in)) return null;
  const admins = await rows(c, z.object({ owner_id: z.string() }), `
    SELECT i.owner_id FROM workspace_members m JOIN identities i ON i.email_index = m.email_index
    WHERE m.owner_id = $1 AND m.role = 'admin' ORDER BY m.created_at, i.created_at, m.member_id`, [workspaceOwnerId]);
  let payer: string | null = null;
  for (const a of admins) {
    // Held here, the payer's row can't go before this commits; held for deleting, it's passed over.
    if (await maybeOne(c, z.object({ n: z.number() }), 'SELECT 1 AS n FROM owners WHERE owner_id = $1 FOR KEY SHARE SKIP LOCKED', [a.owner_id])) { payer = a.owner_id; break; }
  }
  if (payer === w.payer_owner_id) return null;
  const moved = w.payer_owner_id !== null && payer !== null;
  const graceSeconds = (await limitsNow(d, c)).get('workspaces.payer_grace_seconds');
  const r = await maybeOne(c, z.object({ payer_grace_until: timestamp.nullable() }), `
    UPDATE workspaces SET payer_owner_id = $2,
      payer_grace_until = CASE WHEN NOT $3::boolean THEN NULL WHEN payer_grace_until > now() THEN payer_grace_until ELSE now() + make_interval(secs => $4) END,
      payer_grace_bytes = CASE WHEN NOT $3::boolean THEN NULL WHEN payer_grace_until > now() THEN payer_grace_bytes
        ELSE (SELECT coalesce(o.stored_bytes, 0) FROM owners o WHERE o.owner_id = $1) END
    WHERE owner_id = $1 RETURNING payer_grace_until`, [workspaceOwnerId, payer, moved, graceSeconds]);
  await offTeam(c, workspaceOwnerId);
  return { workspaceOwnerId, workspaceId: w.workspace_id, from: w.payer_owner_id, to: payer, graceUntil: r?.payer_grace_until ?? null };
}

/**
 * A team's workspace counts against the team's pool through whoever pays for it (docs: Plans and usage › Team), so it's the
 * team's only while they're on that team. Paid for now by someone who isn't on it (its payer left it, and an admin who isn't
 * on the team is in charge of it now), or by nobody, it stops being the team's, in the caller's transaction: it stays its own
 * people's, nobody is in it through the team any more, and its readers look again. Someone leaving a team takes what they pay
 * for off it at once (teams.ts `leftWith`); this is the rest. Says whether it did.
 */
async function offTeam(c: Db, workspaceOwnerId: string): Promise<boolean> {
  const off = await maybeOne(c, z.object({ workspace_id: z.string() }), `UPDATE workspaces w SET team_id = NULL, team_access = NULL, version = version + 1
    WHERE w.owner_id = $1 AND w.team_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = w.team_id AND m.account_owner_id = w.payer_owner_id)
    RETURNING w.workspace_id`, [workspaceOwnerId]);
  if (!off) return false;
  await publish(c, off.workspace_id, TREE_NOTICE);
  slog.info('workspace off its team: paid for by someone not on it', { workspaceId: off.workspace_id });
  return true;
}

/**
 * Upkeep's pass over every workspace: settles each whose payer isn't in it any more, and each nobody pays for that one of
 * its admins with an account could now (`settlePayer`), each in a transaction of its own, so one that fails waits for the
 * next pass and holds up none of the others. One that's still nobody's isn't looked at again until an admin signs in.
 * Says what moved.
 */
export async function settlePayers(d: Service): Promise<PayerMove[]> {
  const due = await rows(d.pool, z.object({ owner_id: z.string(), workspace_id: z.string() }), `
    SELECT w.owner_id, w.workspace_id FROM workspaces w
    WHERE CASE WHEN w.payer_owner_id IS NULL
      THEN EXISTS (SELECT 1 FROM workspace_members m JOIN identities i ON i.email_index = m.email_index WHERE m.owner_id = w.owner_id AND m.role = 'admin')
      ELSE NOT EXISTS (SELECT 1 FROM workspace_members m JOIN identities i ON i.email_index = m.email_index WHERE m.owner_id = w.owner_id AND i.owner_id = w.payer_owner_id) END
    ORDER BY w.owner_id`);
  const moves: PayerMove[] = [];
  for (const w of due) {
    try {
      const moved = await tx(d.pool, (c) => settlePayer(d, c, w.owner_id));
      if (moved) moves.push(moved);
    } catch (e) {
      slog.warn('workspace payer not settled; it is next pass', { workspaceId: w.workspace_id, err: e });
    }
  }
  return moves;
}
