-- Whose storage a workspace counts against (docs: Plans and usage › Storage). `payer_owner_id`: the account whose storage
-- its files take and whose plan pays for its AI, its longest-standing admin with an account: for a new one whoever made it,
-- or for a call's own, the call's organizer. Every workspace there is gets one in 0032_workspace_payers_backfill.sql, in a
-- transaction of its own, so this file holds its locks only as long as the columns and the index take.
--
-- When a workspace's payment moves to one of its admins because whoever paid for it isn't in it any more, its files don't
-- count against them until `payer_grace_until`: the bytes it held then (`payer_grace_bytes`, at most what it holds now)
-- are on top of their storage until that ends.
ALTER TABLE workspaces
  ADD COLUMN payer_owner_id alcove_owner_id REFERENCES owners(owner_id) ON DELETE SET NULL,
  ADD COLUMN payer_grace_until timestamptz,
  ADD COLUMN payer_grace_bytes bigint CHECK (payer_grace_bytes >= 0),
  ADD CONSTRAINT workspaces_payer_grace CHECK ((payer_grace_until IS NULL) = (payer_grace_bytes IS NULL));
CREATE INDEX workspaces_payer ON workspaces(payer_owner_id);
