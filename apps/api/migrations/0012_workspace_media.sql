-- Files in a workspace's documents and boards (docs: Data and storage › Media). A file belongs to the workspace, as an
-- owner, and is sealed like everything else: what it's called and what it is in `info_ciphertext`, its bytes in pieces
-- of 4 MiB, each an object under a random name. Nothing here says what's in one, only how much of it there is.
CREATE TABLE workspace_media (
  owner_id alcove_owner_id NOT NULL REFERENCES workspaces(owner_id) ON DELETE CASCADE,
  media_id alcove_id128 NOT NULL,
  state text NOT NULL CHECK (state IN ('uploading', 'ready')),
  -- What its pieces take up in the object store so far, and how many the whole file comes to.
  bytes bigint NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  pieces integer NOT NULL CHECK (pieces > 0),
  info_ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, media_id)
);
-- Maintenance finds an upload nobody finished without reading every file.
CREATE INDEX workspace_media_uploading ON workspace_media(created_at) WHERE state = 'uploading';

-- One row per stored piece, found by its place in the file, so a piece sent again is stored once. The object is the
-- sealed piece; `sha256` and `length` are the object's, so what comes back from the store can be checked before it's opened.
CREATE TABLE workspace_media_pieces (
  owner_id alcove_owner_id NOT NULL,
  media_id alcove_id128 NOT NULL,
  seq integer NOT NULL CHECK (seq >= 0),
  object_id alcove_id128 NOT NULL UNIQUE,
  sha256 bytea NOT NULL,
  length bigint NOT NULL CHECK (length > 0),
  PRIMARY KEY (owner_id, media_id, seq),
  FOREIGN KEY (owner_id, media_id) REFERENCES workspace_media(owner_id, media_id) ON DELETE CASCADE
);

-- Which documents and boards have a file: a file is reached only through one of these, because a guest's seat covers one
-- document. A row goes only with its document, so a version or something in Trash never loses a picture.
CREATE TABLE workspace_media_uses (
  owner_id alcove_owner_id NOT NULL,
  media_id alcove_id128 NOT NULL,
  document_id alcove_id128 NOT NULL,
  PRIMARY KEY (owner_id, media_id, document_id),
  FOREIGN KEY (owner_id, media_id) REFERENCES workspace_media(owner_id, media_id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, document_id) REFERENCES documents(owner_id, document_id) ON DELETE CASCADE
);
CREATE INDEX workspace_media_uses_document ON workspace_media_uses(owner_id, document_id);
