-- Who pays for every workspace there is (docs: Plans and usage › Storage), apart from 0032's columns so it never runs under
-- their locks: this holds only the rows it writes, so the previous release, serving while this one deploys, keeps reading
-- workspaces and counting what's stored throughout. A workspace's payer is its longest-standing admin with an account
-- (whoever made a shared one; a call's organizer for its own), the rule upkeep settles one by (features/billing/storage.ts
-- `settlePayer`), so this, upkeep and new workspaces agree. One none of whose admins has an account is left to nobody,
-- and takes no files until one signs in; upkeep settles it then, and any the previous release makes while this one deploys.
UPDATE workspaces w SET payer_owner_id = (
  SELECT i.owner_id FROM workspace_members m JOIN identities i ON i.email_index = m.email_index
  WHERE m.owner_id = w.owner_id AND m.role = 'admin' ORDER BY m.created_at, i.created_at, m.member_id LIMIT 1)
WHERE w.payer_owner_id IS NULL;
