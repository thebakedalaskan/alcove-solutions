-- What someone keeps beside a document for presenting it (docs: Data and storage › Presenter notes): one row for each
-- account and document, sealed under the account's own keys, whoever else can open the document. It belongs to both, so it
-- goes with either: the account by `owner_id`, and the document, or the workspace it's in, by the foreign key.
CREATE TABLE presenter_notes (
  owner_id alcove_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  workspace_owner_id alcove_owner_id NOT NULL,
  document_id alcove_id128 NOT NULL,
  body_ciphertext bytea NOT NULL,
  PRIMARY KEY (owner_id, workspace_owner_id, document_id),
  FOREIGN KEY (workspace_owner_id, document_id) REFERENCES documents(owner_id, document_id) ON DELETE CASCADE
);
CREATE INDEX presenter_notes_document ON presenter_notes(workspace_owner_id, document_id);
