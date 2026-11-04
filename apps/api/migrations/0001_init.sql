-- Alcove's database, as it is today. Edit this file in place and reset local databases when it
-- changes (AGENTS.md › No backwards compatibility). Readable content never lands here: titles,
-- names, emails, chat, notes and audio are sealed records; people are found by keyed hashes.

CREATE DOMAIN alcove_id128 AS text CHECK (VALUE ~ '^[A-Za-z0-9_-]{22}$');
CREATE DOMAIN alcove_owner_id AS text CHECK (VALUE ~ '^[A-Za-z0-9_-]{43}$');

-- One account. Its root key exists here only wrapped under the server's master key.
CREATE TABLE owners (
  owner_id alcove_owner_id PRIMARY KEY,
  root_envelope bytea NOT NULL,
  root_check bytea NOT NULL,
  stored_bytes bigint NOT NULL DEFAULT 0 CHECK (stored_bytes >= 0),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- How people sign in: the provider's account ID and the verified email, each only as a keyed hash.
CREATE TABLE identities (
  subject_index bytea PRIMARY KEY,
  owner_id alcove_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  email_index bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX identities_owner ON identities(owner_id);
CREATE INDEX identities_email ON identities(email_index);

-- Signed-in browsers. The cookie holds the only copy of a session ID; this table keeps its hash.
CREATE TABLE sessions (
  session_hash bytea PRIMARY KEY,
  owner_id alcove_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft', 'sso')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_owner ON sessions(owner_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

-- Encrypted items (profile, meetings, notes, connected accounts) and their immutable revisions.
CREATE TABLE items (
  owner_id alcove_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  item_id alcove_id128 NOT NULL,
  kind text NOT NULL CHECK (kind IN ('profile', 'meeting', 'note', 'connection')),
  current_revision_id alcove_id128 NOT NULL,
  deleted_at timestamptz,
  version bigint NOT NULL CHECK (version >= 0),
  PRIMARY KEY (owner_id, item_id),
  UNIQUE (owner_id, item_id, current_revision_id)
);
CREATE INDEX items_live ON items(owner_id, kind) WHERE deleted_at IS NULL;

CREATE TABLE revisions (
  owner_id alcove_owner_id NOT NULL,
  item_id alcove_id128 NOT NULL,
  revision_id alcove_id128 NOT NULL,
  parent_revision_id alcove_id128,
  key_envelope bytea NOT NULL,
  manifest_ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, revision_id),
  UNIQUE (owner_id, item_id, revision_id),
  FOREIGN KEY (owner_id, item_id) REFERENCES items(owner_id, item_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (owner_id, item_id, parent_revision_id) REFERENCES revisions(owner_id, item_id, revision_id) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE items ADD CONSTRAINT items_head FOREIGN KEY (owner_id, item_id, current_revision_id)
  REFERENCES revisions(owner_id, item_id, revision_id) DEFERRABLE INITIALLY DEFERRED;

-- Idempotency receipts for mutations: an HMAC commitment of the request and the sealed response.
CREATE TABLE operations (
  owner_id alcove_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  operation_id alcove_id128 NOT NULL,
  method text NOT NULL,
  request_commitment bytea NOT NULL,
  result_ciphertext bytea NOT NULL,
  completed_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, operation_id)
);

-- What was said while a note is still being recorded: one sealed row per transcribed clip. A
-- retried clip has the same keyed tag, so it is stored once. When the recording stops, the lines
-- move into the note and these rows are deleted.
CREATE TABLE transcript_clips (
  owner_id alcove_owner_id NOT NULL,
  note_item_id alcove_id128 NOT NULL,
  clip_tag bytea NOT NULL,
  clip_ciphertext bytea NOT NULL,
  PRIMARY KEY (owner_id, note_item_id, clip_tag),
  FOREIGN KEY (owner_id, note_item_id) REFERENCES items(owner_id, item_id) ON DELETE CASCADE
);

-- Notes waiting to be written from a finished recording's transcript. A worker claims a job by
-- setting it to writing with a lease; a failed attempt goes back to queued, not to be tried again
-- before lease_until. A job whose notes model didn't check out waits (waiting) without using up an
-- attempt. A job is deleted once its notes are written, or after its third attempt.
CREATE TABLE content_jobs (
  owner_id alcove_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  job_id alcove_id128 NOT NULL,
  revision_id alcove_id128 NOT NULL,
  kind text NOT NULL CHECK (kind IN ('notes')),
  state text NOT NULL CHECK (state IN ('queued', 'writing', 'waiting')),
  lease_until timestamptz,
  attempt integer NOT NULL CHECK (attempt BETWEEN 0 AND 3),
  job_ciphertext bytea NOT NULL,
  PRIMARY KEY (owner_id, job_id),
  UNIQUE (owner_id, revision_id, kind)
);
CREATE INDEX content_jobs_due ON content_jobs(state, lease_until);

CREATE TABLE calls (
  owner_id alcove_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  call_id alcove_id128 NOT NULL,
  meeting_item_id alcove_id128 NOT NULL,
  state text NOT NULL CHECK (state IN ('live', 'ended')),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  version bigint NOT NULL CHECK (version >= 0),
  state_ciphertext bytea NOT NULL,
  PRIMARY KEY (owner_id, call_id),
  FOREIGN KEY (owner_id, meeting_item_id) REFERENCES items(owner_id, item_id) ON DELETE CASCADE
);
CREATE INDEX calls_live ON calls(owner_id) WHERE state = 'live';

CREATE TABLE recordings (
  owner_id alcove_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  recording_id alcove_id128 NOT NULL,
  note_item_id alcove_id128 NOT NULL,
  state text NOT NULL CHECK (state IN ('recording', 'paused', 'stopped')),
  key_envelope bytea NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  version bigint NOT NULL CHECK (version >= 0),
  PRIMARY KEY (owner_id, recording_id),
  FOREIGN KEY (owner_id, note_item_id) REFERENCES items(owner_id, item_id) ON DELETE CASCADE
);

CREATE TABLE recording_pieces (
  owner_id alcove_owner_id NOT NULL,
  recording_id alcove_id128 NOT NULL,
  segment integer NOT NULL CHECK (segment >= 0),
  seq integer NOT NULL CHECK (seq >= 0),
  object_id alcove_id128 NOT NULL UNIQUE,
  cipher_sha256 bytea NOT NULL,
  cipher_bytes bigint NOT NULL CHECK (cipher_bytes > 0),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  mime_type text NOT NULL,
  PRIMARY KEY (owner_id, recording_id, segment, seq),
  FOREIGN KEY (owner_id, recording_id) REFERENCES recordings(owner_id, recording_id) ON DELETE CASCADE
);

-- Who else may read a note: everyone invited to its call and anyone it was shared with, each only
-- as a keyed hash of their email. Deleting the note removes every row.
CREATE TABLE note_access (
  owner_id alcove_owner_id NOT NULL,
  note_item_id alcove_id128 NOT NULL,
  email_index bytea NOT NULL,
  role text NOT NULL CHECK (role IN ('invited', 'shared')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, note_item_id, email_index),
  FOREIGN KEY (owner_id, note_item_id) REFERENCES items(owner_id, item_id) ON DELETE CASCADE
);
CREATE INDEX note_access_email ON note_access(email_index);

-- Credits, sealed under the service key: billing never sees owner keys.
CREATE TABLE billing_accounts (
  owner_id alcove_owner_id PRIMARY KEY REFERENCES owners(owner_id) ON DELETE CASCADE,
  state_ciphertext bytea NOT NULL,
  version bigint NOT NULL CHECK (version >= 0)
);

-- Object deletions that failed and are retried by maintenance.
CREATE TABLE object_gc (
  object_id alcove_id128 PRIMARY KEY,
  owner_id text NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  last_error text
);
