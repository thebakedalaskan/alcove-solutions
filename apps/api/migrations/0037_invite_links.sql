-- Your own invite link (docs: Privacy, keys and sessions › Invite links): the link a company's Team page copies and its
-- invitations carry, `<web app>/invite#<secret>`, the same every time it's asked for. The secret is worked out from its
-- owner's root key and never stored: only its SHA-256 is a column, which finds the row for whoever opens the link. Who the
-- link is from (their name, address and photo, as their account had them when it last asked for the link) is sealed under a
-- key worked out from the secret (record kind `invite-link-from`), so only someone holding the link, or its owner, opens it.
-- One row for each account, deleted with it. Nothing readable is in a column.
CREATE TABLE invite_links (
  secret_sha256 bytea PRIMARY KEY,
  owner_id alcove_owner_id NOT NULL UNIQUE REFERENCES owners(owner_id) ON DELETE CASCADE,
  from_ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Who joined Alcove from an invite link: an account that said so within an hour of being made, once for each link. Who they
-- are (their name, address and photo) is sealed under the link's key (record kind `invite-link-join`), so only someone
-- holding the link, or its owner, reads them. `joiner_index` (blind index 'invite-joiner' of the joiner's account ID) finds
-- a joiner's rows without opening anything, so they go when that account is deleted; they go with the link too. Nothing
-- readable is in a column.
CREATE TABLE invite_link_joins (
  secret_sha256 bytea NOT NULL REFERENCES invite_links(secret_sha256) ON DELETE CASCADE,
  joiner_index bytea NOT NULL,
  who_ciphertext bytea NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (secret_sha256, joiner_index)
);
CREATE INDEX invite_link_joins_joiner ON invite_link_joins(joiner_index);
