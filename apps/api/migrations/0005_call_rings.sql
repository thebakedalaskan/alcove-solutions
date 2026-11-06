-- Someone the organizer rang into a call: one row per person per call, in the organizer's vault, found by a keyed hash
-- of the address rung (its own purpose, so it joins to no other table without KMASTER). Whom it's for and what they
-- said are sealed under the organizer's keys. `deliver_at` and `expires_at` are when the ring shows: a ring coming
-- back later has a `deliver_at` still to come, and an answer ends it at once. What the card says isn't kept: it's read
-- from the call as it's delivered. Deleted when the person is let in, when the organizer stops ringing them, when the
-- call ends, and a day after it ran out.
CREATE TABLE call_rings (
  owner_id alcove_owner_id NOT NULL,
  ring_id alcove_id128 NOT NULL,
  meeting_item_id alcove_id128 NOT NULL,
  email_index bytea NOT NULL,
  deliver_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  ring_ciphertext bytea NOT NULL,
  PRIMARY KEY (owner_id, ring_id),
  UNIQUE (owner_id, meeting_item_id, email_index),
  FOREIGN KEY (owner_id, meeting_item_id) REFERENCES items(owner_id, item_id) ON DELETE CASCADE
);
CREATE INDEX call_rings_to ON call_rings(email_index);
CREATE INDEX call_rings_expiry ON call_rings(expires_at);
