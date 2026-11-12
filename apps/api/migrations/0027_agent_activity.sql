-- What agents did (docs: Agents and MCP › What your agents did). One row for each tool call an agent completed, for its
-- owner alone: which tool, the note or call it was about and how many it found are sealed in body_ciphertext under the
-- owner's state key 'agent-activity' (record kind agent-activity, bound to the owner and the row's ID). No title, name
-- or text is kept: a title is read when the list is, from what the owner can still open. Deleted with its connection
-- (disconnected, run out or revoked by a refresh replay) and so with the account, after 30 days, and past each
-- connection's newest 1,000 (upkeep).
CREATE TABLE agent_activity (
  owner_id alcove_owner_id NOT NULL,
  grant_id alcove_id128 NOT NULL,
  id alcove_id128 NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  body_ciphertext bytea NOT NULL,
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, grant_id) REFERENCES agent_grants(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX agent_activity_newest ON agent_activity(owner_id, created_at DESC, id DESC);
CREATE INDEX agent_activity_age ON agent_activity(created_at);
