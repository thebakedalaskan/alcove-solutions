-- Someone's own notes on a call: what they wrote, the moments they bookmarked and the answers they kept. One row for
-- each person and note, however much is in it, so the rows don't say how many bookmarks anyone has. Sealed under the
-- person's own keys (owner_id), never the organizer's, so opening the organizer's account doesn't open it. Goes with
-- the note, with the person's account, and when the person no longer has the note.
CREATE TABLE personal_notes (
  owner_id alcove_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  note_owner_id alcove_owner_id NOT NULL,
  note_item_id alcove_id128 NOT NULL,
  body_ciphertext bytea NOT NULL,
  PRIMARY KEY (owner_id, note_owner_id, note_item_id),
  FOREIGN KEY (note_owner_id, note_item_id) REFERENCES items(owner_id, item_id) ON DELETE CASCADE
);
CREATE INDEX personal_notes_note ON personal_notes(note_owner_id, note_item_id);

-- What people chose to add to the shared notes from their own, sealed under the note's organizer's keys like the note
-- is, since everyone with the note reads it. Kept out of the note's manifest, whose revisions stay until the note is
-- deleted: taking an addition back deletes its row, so nothing of it is left. Who added it is sealed in the body, and
-- found only by a keyed hash: deleting their account takes every addition of theirs out of everyone's notes, whatever
-- became of their own notes meanwhile, with nobody else's keys opened.
CREATE TABLE note_additions (
  owner_id alcove_owner_id NOT NULL,
  note_item_id alcove_id128 NOT NULL,
  addition_id alcove_id128 NOT NULL,
  author_index bytea NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  body_ciphertext bytea NOT NULL,
  PRIMARY KEY (owner_id, note_item_id, addition_id),
  FOREIGN KEY (owner_id, note_item_id) REFERENCES items(owner_id, item_id) ON DELETE CASCADE
);
CREATE INDEX note_additions_author ON note_additions(author_index);
