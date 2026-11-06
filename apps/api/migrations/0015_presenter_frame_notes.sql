-- What someone keeps beside each frame of a board for presenting it (docs: Data and storage › Presenter notes): one row for
-- each account, board and frame, sealed under the account's own keys, as their notes on a document are (0011), whoever else
-- can open the board. Which frame is a keyed hash under the same account's key, so nothing a browser named is kept in the
-- clear. It belongs to both, so it goes with either: the account by `owner_id`, and the board, or the workspace it's in, by
-- the foreign key.
CREATE TABLE presenter_frame_notes (
  owner_id alcove_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  workspace_owner_id alcove_owner_id NOT NULL,
  document_id alcove_id128 NOT NULL,
  frame_index bytea NOT NULL,
  body_ciphertext bytea NOT NULL,
  PRIMARY KEY (owner_id, workspace_owner_id, document_id, frame_index),
  FOREIGN KEY (workspace_owner_id, document_id) REFERENCES documents(owner_id, document_id) ON DELETE CASCADE
);
CREATE INDEX presenter_frame_notes_document ON presenter_frame_notes(workspace_owner_id, document_id);
