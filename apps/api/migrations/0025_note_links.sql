-- Links to a call's notes (docs: Privacy, keys and sessions › Who can read a note). A link reads nothing by itself: opened
-- by someone signed in, it gives that account the notes, as shared by whoever made the link, with a note_access row like
-- sharing by address does. Found by the SHA-256 of its secret, which travels only in the link's fragment and POST bodies;
-- the secret itself is never stored. Who made it and when are sealed under the note's organizer's keys (record kind
-- note-link). `maker_index` (blind index 'note-link-maker' of the maker's account ID) finds a maker's links without opening
-- anything, so they go when the maker removes the note from theirs or deletes their account. Deleted when revoked, once
-- run out (upkeep), and with the note.
CREATE TABLE note_links (
  owner_id alcove_owner_id NOT NULL,
  note_item_id alcove_id128 NOT NULL,
  link_id alcove_id128 NOT NULL,
  secret_hash bytea NOT NULL UNIQUE,
  maker_index bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  body_ciphertext bytea NOT NULL,
  PRIMARY KEY (owner_id, note_item_id, link_id),
  FOREIGN KEY (owner_id, note_item_id) REFERENCES items(owner_id, item_id) ON DELETE CASCADE
);
CREATE INDEX note_links_expiry ON note_links(expires_at);
CREATE INDEX note_links_maker ON note_links(maker_index);
