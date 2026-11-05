-- Every address whose name is on something in a workspace (docs: Data and storage › Workspaces): it made something there
-- or restricted something, so deleting that account can reach the workspace after it has left. Only a keyed hash, like
-- `workspace_members`. `made_workspace` counts the workspaces an address has made, which stays true after it leaves.
CREATE TABLE workspace_authors (
  owner_id alcove_owner_id NOT NULL REFERENCES workspaces(owner_id) ON DELETE CASCADE,
  email_index bytea NOT NULL,
  made_workspace boolean NOT NULL DEFAULT false,
  PRIMARY KEY (owner_id, email_index)
);
CREATE INDEX workspace_authors_email ON workspace_authors(email_index);
