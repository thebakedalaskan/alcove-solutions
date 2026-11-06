-- Who's invited to a call, so they can find it from their own account: one row per person, by a keyed hash of their
-- address with a purpose of its own, so these rows can't be joined to identities without KMASTER. Their answer is
-- sealed under the organizer's keys; a clear column would show who's coming. Calls scheduled before this table have no
-- rows: their guests are sealed, so the organizer's next read fills them in. Deleting the call removes every row.
CREATE TABLE meeting_access (
  owner_id alcove_owner_id NOT NULL,
  meeting_item_id alcove_id128 NOT NULL,
  email_index bytea NOT NULL,
  answer_ciphertext bytea,
  PRIMARY KEY (owner_id, meeting_item_id, email_index),
  FOREIGN KEY (owner_id, meeting_item_id) REFERENCES items(owner_id, item_id) ON DELETE CASCADE
);
CREATE INDEX meeting_access_email ON meeting_access(email_index);
