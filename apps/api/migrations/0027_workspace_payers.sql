-- Whose plan a workspace counts against (docs: Plans and usage › Storage). `payer_owner_id`: the account whose storage
-- its files take and whose plan says how many shared workspaces it may make: the one who made it, or for a call's own
-- workspace (`home`), the call's organizer. `frozen_at`: when it became read-only for everyone in it, because its payer's
-- grace ran out with more shared workspaces than their plan has; null while it works as usual.
ALTER TABLE workspaces ADD COLUMN payer_owner_id alcove_owner_id REFERENCES owners(owner_id) ON DELETE SET NULL;
ALTER TABLE workspaces ADD COLUMN home boolean NOT NULL DEFAULT false;
ALTER TABLE workspaces ADD COLUMN frozen_at timestamptz;
CREATE INDEX workspaces_payer ON workspaces(payer_owner_id);

-- Every workspace there is: a shared one is paid for by whoever made it (`made_workspace`), a call's own by its first
-- admin, the organizer, who makes it. Those the previous release makes while this one deploys, and those whose payer
-- deletes their account, are settled the same way by upkeep (features/billing/storage.ts).
UPDATE workspaces w SET
  home = NOT EXISTS (SELECT 1 FROM workspace_authors a WHERE a.owner_id = w.owner_id AND a.made_workspace),
  payer_owner_id = COALESCE(
    (SELECT i.owner_id FROM workspace_authors a JOIN identities i ON i.email_index = a.email_index
     WHERE a.owner_id = w.owner_id AND a.made_workspace ORDER BY i.created_at LIMIT 1),
    (SELECT i.owner_id FROM workspace_members m JOIN identities i ON i.email_index = m.email_index
     WHERE m.owner_id = w.owner_id AND m.role = 'admin' ORDER BY m.created_at, i.created_at LIMIT 1));
