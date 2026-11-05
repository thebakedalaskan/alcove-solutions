-- What documents and boards hold (docs: Data and storage › Documents). Content is a Yjs document: each update browsers send
-- is sealed into an append-only log, which compacts into one sealed snapshot, and whole states are kept now and then as
-- versions. Nothing readable lands here: every row is a sealed record bound to its document and its place.

-- How big its snapshot is, so a document's size is known without opening it; when the newest version was kept, and how far
-- through the log it reaches, so a version is kept at most every ten minutes of editing, and never of nothing new.
ALTER TABLE documents
  ADD COLUMN snapshot_bytes bigint NOT NULL DEFAULT 0 CHECK (snapshot_bytes >= 0),
  ADD COLUMN version_at timestamptz,
  ADD COLUMN version_seq bigint NOT NULL DEFAULT 0 CHECK (version_seq >= 0);

-- The log since the snapshot. `seq` is taken from `documents.next_seq` under that row's lock, so rows commit in order and
-- whoever reads past a `seq` misses nothing.
CREATE TABLE document_updates (
  owner_id alcove_owner_id NOT NULL,
  document_id alcove_id128 NOT NULL,
  seq bigint NOT NULL CHECK (seq >= 1),
  update_ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, document_id, seq),
  FOREIGN KEY (owner_id, document_id) REFERENCES documents(owner_id, document_id) ON DELETE CASCADE
);

-- The state through `through_seq`, one row a document, replaced by each compaction, and who has edited since the last version.
CREATE TABLE document_snapshots (
  owner_id alcove_owner_id NOT NULL,
  document_id alcove_id128 NOT NULL,
  through_seq bigint NOT NULL CHECK (through_seq >= 0),
  snapshot_ciphertext bytea NOT NULL,
  editors_ciphertext bytea NOT NULL,
  PRIMARY KEY (owner_id, document_id),
  FOREIGN KEY (owner_id, document_id) REFERENCES documents(owner_id, document_id) ON DELETE CASCADE
);

-- A document as it stood at one moment: a whole state, so it opens whatever has happened to the log since.
CREATE TABLE document_versions (
  owner_id alcove_owner_id NOT NULL,
  document_id alcove_id128 NOT NULL,
  version_id alcove_id128 NOT NULL,
  info_ciphertext bytea NOT NULL,
  state_ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, document_id, version_id),
  FOREIGN KEY (owner_id, document_id) REFERENCES documents(owner_id, document_id) ON DELETE CASCADE
);
CREATE INDEX document_versions_newest ON document_versions(owner_id, document_id, created_at DESC);
