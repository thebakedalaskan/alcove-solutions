-- A picture's preview (docs: Data and storage › Media): a small JPEG the uploading browser makes, so a picker shows
-- thumbnails without reading whole photos. Sealed like the file's pieces, under the file's own key with a header of its
-- own, in one object under a random name. A file has one at most, and it goes with the file. Pictures uploaded before
-- this have no row, and are drawn from the picture itself.
CREATE TABLE workspace_media_previews (
  owner_id alcove_owner_id NOT NULL,
  media_id alcove_id128 NOT NULL,
  object_id alcove_id128 NOT NULL UNIQUE,
  sha256 bytea NOT NULL,
  length integer NOT NULL CHECK (length > 0),
  PRIMARY KEY (owner_id, media_id),
  FOREIGN KEY (owner_id, media_id) REFERENCES workspace_media(owner_id, media_id) ON DELETE CASCADE
);
