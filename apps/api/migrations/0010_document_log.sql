-- What documents and boards hold (docs: Data and storage › Documents). Content is a Yjs document: each update browsers send
-- is sealed into an append-only log, which compacts into one sealed snapshot, and whole states are kept now and then as
-- versions. Nothing readable lands here: every row is a sealed record bound to its document and its place.

-- What its snapshot comes to, so a document's size is known without opening it: in bytes, in items, which is what its memory
-- follows, and in how deep its types nest. The same for what's in the log since, which is an upper bound until it compacts.
-- When the newest version was kept, and how far through the log it reaches, so a version is kept at most every ten minutes of
-- editing, and never of nothing new. `held_until`: something is restoring it, and nothing lands until that's done.
-- `closed_until`: it couldn't be opened in the time or memory a worker has, so nobody tries again until then.
ALTER TABLE documents
  ADD COLUMN snapshot_bytes bigint NOT NULL DEFAULT 0 CHECK (snapshot_bytes >= 0),
  ADD COLUMN snapshot_items bigint NOT NULL DEFAULT 0 CHECK (snapshot_items >= 0),
  ADD COLUMN items_since_snapshot bigint NOT NULL DEFAULT 0 CHECK (items_since_snapshot >= 0),
  ADD COLUMN snapshot_nesting integer NOT NULL DEFAULT 1 CHECK (snapshot_nesting >= 0),
  ADD COLUMN nesting_since_snapshot integer NOT NULL DEFAULT 0 CHECK (nesting_since_snapshot >= 0),
  ADD COLUMN version_at timestamptz,
  ADD COLUMN version_seq bigint NOT NULL DEFAULT 0 CHECK (version_seq >= 0),
  ADD COLUMN held_until timestamptz,
  ADD COLUMN closed_until timestamptz;

-- The log since the snapshot. `seq` is taken from `documents.next_seq` under that row's lock, so rows commit in order and
-- whoever reads past a `seq` misses nothing. Beside it, how much each row adds to the figures on `documents`.
CREATE TABLE document_updates (
  owner_id alcove_owner_id NOT NULL,
  document_id alcove_id128 NOT NULL,
  seq bigint NOT NULL CHECK (seq >= 1),
  update_ciphertext bytea NOT NULL,
  bytes integer NOT NULL CHECK (bytes >= 0),
  items integer NOT NULL CHECK (items >= 0),
  nesting integer NOT NULL CHECK (nesting >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, document_id, seq),
  FOREIGN KEY (owner_id, document_id) REFERENCES documents(owner_id, document_id) ON DELETE CASCADE
);

-- Every Yjs client that has written to a document, and how far: what an update is checked against under the row's lock,
-- without opening the document. `people`: keyed hashes of who it belongs to, each bound to this client and this document, so
-- rows can't be linked to each other or to anyone. Empty for what the server wrote, which no browser can write as.
CREATE TABLE document_clients (
  owner_id alcove_owner_id NOT NULL,
  document_id alcove_id128 NOT NULL,
  client_id bigint NOT NULL CHECK (client_id >= 0),
  next_clock bigint NOT NULL CHECK (next_clock >= 0),
  people bytea NOT NULL,
  PRIMARY KEY (owner_id, document_id, client_id),
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

-- A document as it stood at one moment: a whole state, so it opens whatever has happened to the log since. It's kept in
-- parts, so it can go to a reader a little at a time.
CREATE TABLE document_versions (
  owner_id alcove_owner_id NOT NULL,
  document_id alcove_id128 NOT NULL,
  version_id alcove_id128 NOT NULL,
  info_ciphertext bytea NOT NULL,
  bytes bigint NOT NULL CHECK (bytes >= 0),
  parts integer NOT NULL CHECK (parts >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, document_id, version_id),
  FOREIGN KEY (owner_id, document_id) REFERENCES documents(owner_id, document_id) ON DELETE CASCADE
);
CREATE INDEX document_versions_newest ON document_versions(owner_id, document_id, created_at DESC);
CREATE TABLE document_version_parts (
  owner_id alcove_owner_id NOT NULL,
  document_id alcove_id128 NOT NULL,
  version_id alcove_id128 NOT NULL,
  part integer NOT NULL CHECK (part >= 0),
  state_ciphertext bytea NOT NULL,
  PRIMARY KEY (owner_id, document_id, version_id, part),
  FOREIGN KEY (owner_id, document_id, version_id) REFERENCES document_versions(owner_id, document_id, version_id) ON DELETE CASCADE
);
