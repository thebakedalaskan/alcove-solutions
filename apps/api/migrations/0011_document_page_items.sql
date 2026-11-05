-- How many of a document's items aren't on its page: what's been deleted or overwritten, and what's in retired blocks. It
-- still has to hold them, but its limit is on what's on the page. Exact as of its snapshot, like the figures beside it, so a
-- row from before this says nothing is retired, which is how every row was counted, and the next compaction finds out.
ALTER TABLE documents ADD COLUMN snapshot_retired_items bigint NOT NULL DEFAULT 0;

-- A keyed hash of what a row deletes, so the same deletes arriving again, as a browser retrying does, are known without
-- opening anything, and cost no row. Rows from before have none, and are never matched.
ALTER TABLE document_updates ADD COLUMN deletes_tag bytea;
