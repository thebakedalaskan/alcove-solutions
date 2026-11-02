-- Objects waiting to be deleted from O01 (failed deletes are retried; docs: Restart, failure, and acceptance).
CREATE TABLE object_gc (
  object_id mvp_id128 PRIMARY KEY,
  owner_id text NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  last_error text
);
