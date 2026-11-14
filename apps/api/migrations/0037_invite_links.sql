-- Your own invite link (docs: Privacy, keys and sessions › Invite links): the link a company's Team page copies and its
-- invitations carry, `<web app>/invite#<secret>`, the same every time it's asked for until its owner makes a new one. The
-- secret is worked out from its owner's root key and the link's `generation` (one more for each new link) and never stored:
-- only its SHA-256 is a column, which finds the row for whoever opens the link, and a new link replaces it, so the old one
-- leads nowhere. Who the link is from (their name, address and photo) is sealed under a key worked out from the secret
-- (record kind `invite-link-from`), so only someone holding the link, or its owner, opens it. One row for each account,
-- deleted with it. Nothing readable is in a column.
CREATE TABLE invite_links (
  owner_id alcove_owner_id PRIMARY KEY REFERENCES owners(owner_id) ON DELETE CASCADE,
  secret_sha256 bytea NOT NULL UNIQUE,
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  from_ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Who joined Alcove from someone's invite link, any of its generations: an account that said so within an hour of being
-- made, once for each sender. Who they are and when they joined are sealed under the sender's own keys (record kind
-- `invite-link-join`, state key `invite-link-joins`), so nobody holding the link reads them, and the row keeps no time.
-- `joiner_index` (blind index 'invite-joiner' of the joiner's account ID) finds a joiner's rows without opening anything, so
-- they go when that account is deleted, or at upkeep after a release that didn't take them. They go with the sender's
-- account too.
CREATE TABLE invite_link_joins (
  owner_id alcove_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  joiner_index bytea NOT NULL,
  who_ciphertext bytea NOT NULL,
  PRIMARY KEY (owner_id, joiner_index)
);
CREATE INDEX invite_link_joins_joiner ON invite_link_joins(joiner_index);
