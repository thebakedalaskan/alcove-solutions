-- Alcove D01 schema (explained in docs/engineering/data-and-storage.md). Content tables follow the original spec:
-- clear columns hold only opaque IDs, relationships, byte counts, states and sequence numbers;
-- everything else is an authenticated ciphertext record.

CREATE DOMAIN mvp_id128 AS text CHECK (VALUE ~ '^[A-Za-z0-9_-]{22}$');
CREATE DOMAIN mvp_owner_id AS text CHECK (VALUE ~ '^[A-Za-z0-9_-]{43}$');

CREATE TABLE owners (
  owner_id mvp_owner_id PRIMARY KEY,
  -- COSE public key of the first passkey; ownerId = H("MVP/owner/v1", auth_public_key).
  auth_public_key bytea NOT NULL UNIQUE,
  -- WebAuthn user handle shared by every passkey of this owner.
  webauthn_user_id bytea NOT NULL UNIQUE,
  -- HMAC proving a delegated root belongs to this owner, so a wrong key never opens an empty vault.
  root_check bytea NOT NULL,
  stored_bytes bigint NOT NULL DEFAULT 0 CHECK (stored_bytes >= 0),
  reserved_bytes bigint NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE passkeys (
  credential_id text PRIMARY KEY CHECK (credential_id ~ '^[A-Za-z0-9_-]+$'),
  owner_id mvp_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  public_key bytea NOT NULL,
  counter bigint NOT NULL CHECK (counter >= 0),
  transports text[] NOT NULL DEFAULT '{}',
  -- Owner root wrapped under a key derived from this passkey's secret (PRF output or device secret).
  root_envelope bytea NOT NULL,
  uses_prf boolean NOT NULL,
  label_ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX passkeys_owner ON passkeys(owner_id);

CREATE TABLE items (
  owner_id mvp_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  item_id mvp_id128 NOT NULL,
  kind text NOT NULL CHECK (kind IN ('page','file','transcript','chat','profile','meeting','note')),
  current_revision_id mvp_id128 NOT NULL,
  deleted_at timestamptz,
  version bigint NOT NULL CHECK (version >= 0),
  PRIMARY KEY (owner_id, item_id),
  UNIQUE (owner_id, item_id, current_revision_id)
);
CREATE INDEX items_live ON items(owner_id, kind) WHERE deleted_at IS NULL;

CREATE TABLE revisions (
  owner_id mvp_owner_id NOT NULL,
  item_id mvp_id128 NOT NULL,
  revision_id mvp_id128 NOT NULL,
  parent_revision_id mvp_id128,
  key_envelope bytea NOT NULL,
  manifest_ciphertext bytea NOT NULL,
  index_state text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, revision_id),
  UNIQUE (owner_id, item_id, revision_id),
  FOREIGN KEY (owner_id, item_id) REFERENCES items(owner_id, item_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (owner_id, item_id, parent_revision_id) REFERENCES revisions(owner_id, item_id, revision_id) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE items ADD CONSTRAINT items_head FOREIGN KEY (owner_id, item_id, current_revision_id)
  REFERENCES revisions(owner_id, item_id, revision_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE object_refs (
  owner_id mvp_owner_id NOT NULL,
  revision_id mvp_id128 NOT NULL,
  object_id mvp_id128 NOT NULL,
  cipher_sha256 bytea NOT NULL,
  cipher_bytes bigint NOT NULL CHECK (cipher_bytes > 0),
  PRIMARY KEY (owner_id, object_id),
  FOREIGN KEY (owner_id, revision_id) REFERENCES revisions(owner_id, revision_id) ON DELETE CASCADE
);

CREATE TABLE uploads (
  owner_id mvp_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  upload_id mvp_id128 NOT NULL,
  state text NOT NULL,
  reserved_bytes bigint NOT NULL CHECK (reserved_bytes >= 0),
  state_ciphertext bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  version bigint NOT NULL,
  PRIMARY KEY (owner_id, upload_id)
);
CREATE TABLE upload_parts (
  owner_id mvp_owner_id NOT NULL,
  upload_id mvp_id128 NOT NULL,
  part_index integer NOT NULL CHECK (part_index BETWEEN 0 AND 99),
  object_id mvp_id128 NOT NULL,
  cipher_sha256 bytea NOT NULL,
  cipher_bytes bigint NOT NULL CHECK (cipher_bytes > 0),
  PRIMARY KEY (owner_id, upload_id, part_index),
  FOREIGN KEY (owner_id, upload_id) REFERENCES uploads(owner_id, upload_id) ON DELETE CASCADE
);
CREATE INDEX uploads_expiry ON uploads(expires_at);

CREATE TABLE operations (
  owner_id mvp_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  operation_id mvp_id128 NOT NULL,
  method text NOT NULL,
  request_commitment bytea NOT NULL,
  result_ciphertext bytea NOT NULL,
  completed_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, operation_id)
);

CREATE TABLE content_jobs (
  owner_id mvp_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  job_id mvp_id128 NOT NULL,
  revision_id mvp_id128 NOT NULL,
  kind text NOT NULL,
  state text NOT NULL,
  lease_until timestamptz,
  attempt integer NOT NULL CHECK (attempt BETWEEN 0 AND 3),
  job_ciphertext bytea NOT NULL,
  PRIMARY KEY (owner_id, job_id),
  UNIQUE (owner_id, revision_id, kind)
);
CREATE INDEX content_jobs_queued ON content_jobs(state, lease_until);

-- Calls: one row per call; the encrypted state holds notes settings, chat and presentation state.
CREATE TABLE calls (
  owner_id mvp_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  call_id mvp_id128 NOT NULL,
  meeting_item_id mvp_id128 NOT NULL,
  state text NOT NULL CHECK (state IN ('live','ended')),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  version bigint NOT NULL CHECK (version >= 0),
  state_ciphertext bytea NOT NULL,
  PRIMARY KEY (owner_id, call_id),
  FOREIGN KEY (owner_id, meeting_item_id) REFERENCES items(owner_id, item_id) ON DELETE CASCADE
);
CREATE INDEX calls_live ON calls(owner_id) WHERE state = 'live';

-- Recordings: Krec is random per recording and stored only wrapped under the owner wrap key.
CREATE TABLE recordings (
  owner_id mvp_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  recording_id mvp_id128 NOT NULL,
  note_item_id mvp_id128 NOT NULL,
  state text NOT NULL CHECK (state IN ('recording','paused','stopped')),
  key_envelope bytea NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  version bigint NOT NULL CHECK (version >= 0),
  PRIMARY KEY (owner_id, recording_id),
  FOREIGN KEY (owner_id, note_item_id) REFERENCES items(owner_id, item_id) ON DELETE CASCADE
);
CREATE TABLE recording_pieces (
  owner_id mvp_owner_id NOT NULL,
  recording_id mvp_id128 NOT NULL,
  segment integer NOT NULL CHECK (segment >= 0),
  seq integer NOT NULL CHECK (seq >= 0),
  object_id mvp_id128 NOT NULL UNIQUE,
  cipher_sha256 bytea NOT NULL,
  cipher_bytes bigint NOT NULL CHECK (cipher_bytes > 0),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  mime_type text NOT NULL,
  PRIMARY KEY (owner_id, recording_id, segment, seq),
  FOREIGN KEY (owner_id, recording_id) REFERENCES recordings(owner_id, recording_id) ON DELETE CASCADE
);

-- Billing: balance and history live only inside the Kservice-sealed state (docs/engineering/payments-and-usage.md).
CREATE TABLE billing_accounts (
  owner_id mvp_owner_id PRIMARY KEY REFERENCES owners(owner_id) ON DELETE CASCADE,
  state_ciphertext bytea NOT NULL,
  version bigint NOT NULL CHECK (version >= 0)
);
