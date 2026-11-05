-- A call's shared live notes, a row for each view of each part of the call that has had some (docs: Notes and
-- inference › Live notes). `place` is 'main', or a breakout room's random ID. `view` is 'all' for the notes of everyone
-- who may read everything they read, or for someone who may not, a digest of the random IDs of the lines they can't: they
-- get notes written only from the rest, shared with whoever can't read the same lines. Beside the call's sealed state,
-- not in it: notes run to tens of kilobytes, which every request about the call would otherwise open, and a refresh takes
-- the notes model up to a minute, which must never hold the call's row. Only `notes_ciphertext` and `lines_ciphertext`
-- say anything about the call. A refresh is claimed under this row's lock: `lease_until` says one is under way, `looked_at`
-- when the last one began, which keeps them 30 seconds apart however many are watching, and `clips_seen` how many clips
-- the note had then, so a look with nothing new opens nothing. Deleted when the call ends, once what was ticked is in the note.
CREATE TABLE call_notes (
  owner_id alcove_owner_id NOT NULL,
  call_id alcove_id128 NOT NULL,
  place text NOT NULL CHECK (place ~ '^(?:main|[A-Za-z0-9_-]{22})$'),
  view text NOT NULL DEFAULT 'all' CHECK (view ~ '^(?:all|[A-Za-z0-9_-]{43})$'),
  clips_seen integer NOT NULL DEFAULT 0,
  looked_at timestamptz,
  lease_until timestamptz,
  notes_ciphertext bytea,
  lines_ciphertext bytea,
  PRIMARY KEY (owner_id, call_id, place, view),
  FOREIGN KEY (owner_id, call_id) REFERENCES calls(owner_id, call_id) ON DELETE CASCADE
);
