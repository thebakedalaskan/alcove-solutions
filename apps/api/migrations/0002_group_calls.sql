-- Group calls on LiveKit (docs: Calls and recordings). Anyone with a call's link can look it up, not only its
-- organizer, so codes get an index: a keyed hash under KMASTER, never the code itself. A call also knows its
-- LiveKit room, the organizer's current connection, when that connection left, and whether it's locked.

CREATE TABLE call_codes (
  code_hash bytea PRIMARY KEY,
  owner_id alcove_owner_id NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  meeting_item_id alcove_id128 NOT NULL,
  UNIQUE (owner_id, meeting_item_id),
  FOREIGN KEY (owner_id, meeting_item_id) REFERENCES items(owner_id, item_id) ON DELETE CASCADE
);

ALTER TABLE calls
  ADD COLUMN room_name text,
  ADD COLUMN host_identity text,
  ADD COLUMN host_left_at timestamptz,
  ADD COLUMN locked boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX calls_room ON calls(room_name) WHERE room_name IS NOT NULL;
