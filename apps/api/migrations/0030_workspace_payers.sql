-- Whose storage a workspace counts against (docs: Plans and usage › Storage). `payer_owner_id`: the account whose storage
-- its files take and whose plan pays for its AI, its longest-standing admin with an account: for a new one whoever made it,
-- or for a call's own, the call's organizer. Every workspace there is gets one in 0032_workspace_payers_backfill.sql, in a
-- transaction of its own, so this file holds its locks only as long as new columns, an index and two new tables take.
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

-- What people other than an account add to its storage in a day (UTC), through the workspaces it pays for, for the limits on
-- it (features/workspaces/media.ts): each signed-in person apart (`media_others_days`), and every guest in its calls
-- together (`media_guest_payer_days`), since a guest is someone new each time they join. IDs, days and sizes only; upkeep
-- keeps today and yesterday, and each account's rows go with it.
CREATE TABLE media_others_days (
  payer_owner_id alcove_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  owner_id alcove_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  day date NOT NULL,
  bytes bigint NOT NULL CHECK (bytes >= 0),
  PRIMARY KEY (payer_owner_id, owner_id, day)
);
CREATE INDEX media_others_days_owner ON media_others_days(owner_id);
CREATE TABLE media_guest_payer_days (
  payer_owner_id alcove_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  day date NOT NULL,
  bytes bigint NOT NULL CHECK (bytes >= 0),
  PRIMARY KEY (payer_owner_id, day)
);
