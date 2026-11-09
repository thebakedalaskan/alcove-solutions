-- Shared screens kept for the notes as video (docs: Calls and recordings › Shared screens). Each share a presenter
-- starts while a call's recording exists gets a row: whether they said it goes in the notes (`keep`), and when it
-- started and ended, as milliseconds into the call and the recording's segment then. Whose it was and what to call it
-- are sealed in `meta_ciphertext`. Deleting the recording (with its note) removes every row.
CREATE TABLE screen_shares (
  owner_id alcove_owner_id NOT NULL,
  recording_id alcove_id128 NOT NULL,
  share_id alcove_id128 NOT NULL,
  keep boolean NOT NULL,
  meta_ciphertext bytea NOT NULL,
  started_ms bigint NOT NULL CHECK (started_ms >= 0),
  started_segment integer NOT NULL CHECK (started_segment >= 0),
  ended_ms bigint CHECK (ended_ms >= 0),
  ended_segment integer CHECK (ended_segment >= 0),
  PRIMARY KEY (owner_id, recording_id, share_id),
  FOREIGN KEY (owner_id, recording_id) REFERENCES recordings(owner_id, recording_id) ON DELETE CASCADE
);

-- A kept share's video as its presenter's browser sent it, one row per piece, found by its place (segment, seq), so
-- a piece sent again is stored once. at_ms is where it starts in its segment, pauses not counted, as for audio. The
-- piece is a sealed object under a random name, under the recording's key. Once the call is over the pieces are
-- joined into screen_videos and deleted.
CREATE TABLE screen_pieces (
  owner_id alcove_owner_id NOT NULL,
  recording_id alcove_id128 NOT NULL,
  share_id alcove_id128 NOT NULL,
  segment integer NOT NULL CHECK (segment >= 0),
  seq integer NOT NULL CHECK (seq >= 0),
  at_ms integer NOT NULL CHECK (at_ms >= 0),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  object_id alcove_id128 NOT NULL UNIQUE,
  cipher_sha256 bytea NOT NULL,
  cipher_bytes bigint NOT NULL CHECK (cipher_bytes > 0),
  mime_type text NOT NULL,
  PRIMARY KEY (owner_id, recording_id, share_id, segment, seq),
  FOREIGN KEY (owner_id, recording_id, share_id) REFERENCES screen_shares(owner_id, recording_id, share_id) ON DELETE CASCADE
);

-- A kept share's video in one segment, joined into one file a browser can seek and sealed in chunks of at most
-- 4 MiB (each a sealed object under a random name, under the recording's key), so replay opens only the chunks a
-- range needs. Every chunk row of a segment repeats the video's own facts: its type, its plaintext length, where it
-- starts in its segment (at_ms) and how long it runs.
CREATE TABLE screen_videos (
  owner_id alcove_owner_id NOT NULL,
  recording_id alcove_id128 NOT NULL,
  share_id alcove_id128 NOT NULL,
  segment integer NOT NULL CHECK (segment >= 0),
  chunk integer NOT NULL CHECK (chunk >= 0),
  object_id alcove_id128 NOT NULL UNIQUE,
  cipher_sha256 bytea NOT NULL,
  cipher_bytes bigint NOT NULL CHECK (cipher_bytes > 0),
  plain_bytes integer NOT NULL CHECK (plain_bytes > 0),
  total_bytes bigint NOT NULL CHECK (total_bytes > 0),
  chunks integer NOT NULL CHECK (chunks > 0),
  at_ms integer NOT NULL CHECK (at_ms >= 0),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  mime_type text NOT NULL,
  PRIMARY KEY (owner_id, recording_id, share_id, segment, chunk),
  FOREIGN KEY (owner_id, recording_id, share_id) REFERENCES screen_shares(owner_id, recording_id, share_id) ON DELETE CASCADE
);
