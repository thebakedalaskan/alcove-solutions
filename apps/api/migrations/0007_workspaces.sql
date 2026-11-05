-- The in-call workspace (docs: Data and storage › Workspaces). A workspace is an owner: a row in `owners` with its own
-- root key and no sign-in, so sealing, `owner_id` scoping and deleting work as they do for an account. Its name and tree
-- are one sealed record here, changed under this row's lock. Nothing readable lands in any of these tables: people are
-- keyed hashes, and who they are is sealed beside the hash, so it goes with the row.
CREATE TABLE workspaces (
  owner_id alcove_owner_id PRIMARY KEY REFERENCES owners(owner_id) ON DELETE CASCADE,
  -- The public handle: the owner ID stays on the server.
  workspace_id alcove_id128 NOT NULL UNIQUE,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  state_ciphertext bytea NOT NULL,
  -- When the oldest thing in its Trash went there, so maintenance finds what's due without opening every workspace.
  trash_since timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspaces_trash ON workspaces(trash_since) WHERE trash_since IS NOT NULL;

-- Who's in a workspace, by the keyed hash of their address. `member_id` is what the API calls them, so no address or
-- hash ever reaches a URL or a browser.
CREATE TABLE workspace_members (
  owner_id alcove_owner_id NOT NULL REFERENCES workspaces(owner_id) ON DELETE CASCADE,
  member_id alcove_id128 NOT NULL,
  email_index bytea NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'edit', 'read')),
  person_ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, email_index),
  UNIQUE (owner_id, member_id)
);
CREATE INDEX workspace_members_email ON workspace_members(email_index);

-- Everything in the tree that holds content (a document or a board) has a row here. What it holds comes in later
-- tables that hang off this one, so deleting the row deletes all of it.
CREATE TABLE documents (
  owner_id alcove_owner_id NOT NULL REFERENCES workspaces(owner_id) ON DELETE CASCADE,
  document_id alcove_id128 NOT NULL,
  next_seq bigint NOT NULL DEFAULT 1 CHECK (next_seq >= 1),
  updates_since_snapshot integer NOT NULL DEFAULT 0 CHECK (updates_since_snapshot >= 0),
  bytes_since_snapshot bigint NOT NULL DEFAULT 0 CHECK (bytes_since_snapshot >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, document_id)
);

-- One document opened for one person beyond what the workspace gives them: an address, by its keyed hash, or a seat in
-- a call, by a keyed hash of the seat (`call_id` says which call; it belongs to another owner, so there's no foreign
-- key, and the entry ends with the call).
CREATE TABLE document_access (
  owner_id alcove_owner_id NOT NULL,
  document_id alcove_id128 NOT NULL,
  access_id alcove_id128 NOT NULL,
  principal_index bytea NOT NULL,
  kind text NOT NULL CHECK (kind IN ('email', 'seat')),
  role text NOT NULL CHECK (role IN ('edit', 'read')),
  call_id alcove_id128,
  person_ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, document_id, principal_index),
  UNIQUE (owner_id, document_id, access_id),
  CHECK ((kind = 'seat') = (call_id IS NOT NULL)),
  FOREIGN KEY (owner_id, document_id) REFERENCES documents(owner_id, document_id) ON DELETE CASCADE
);
CREATE INDEX document_access_principal ON document_access(principal_index);
CREATE INDEX document_access_call ON document_access(call_id) WHERE call_id IS NOT NULL;
