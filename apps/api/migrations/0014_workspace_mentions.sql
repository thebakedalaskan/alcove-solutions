-- Who's been tagged in a document and hasn't heard yet (docs: Data and storage › Tags). Each row waits for one person, by the
-- keyed hash access knows them by, and goes as soon as they've heard, or with its document. Who tagged them and the line are
-- sealed: in the clear there's only that someone was tagged in a document, and when.
CREATE TABLE workspace_mentions (
  owner_id alcove_owner_id NOT NULL,
  mention_id alcove_id128 NOT NULL,
  document_id alcove_id128 NOT NULL,
  principal_index bytea NOT NULL,
  info_ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, mention_id),
  FOREIGN KEY (owner_id, document_id) REFERENCES documents(owner_id, document_id) ON DELETE CASCADE
);

-- What's waiting for someone, the oldest first, in one workspace or across all of theirs.
CREATE INDEX workspace_mentions_for ON workspace_mentions (principal_index, created_at);
-- What's been waiting so long it goes.
CREATE INDEX workspace_mentions_age ON workspace_mentions (created_at);
