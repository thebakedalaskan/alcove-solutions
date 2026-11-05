-- A call that repeats belongs to a series with an item of its own: how it repeats, its one link and its recurring
-- calendar event, sealed like every other item. Every row here already passed the narrower check, so the new one takes
-- NOT VALID and scans nothing while it holds the table. The release before this one writes none of these and reads
-- items by kind, so it doesn't see them.
ALTER TABLE items DROP CONSTRAINT items_kind_check;
ALTER TABLE items ADD CONSTRAINT items_kind_check CHECK (kind IN ('profile', 'meeting', 'note', 'connection', 'series')) NOT VALID;

-- Whose turn it is to change their series, and until when. A change goes to Google and back, too long to hold a row
-- lock: this says one is under way, and runs out by itself if its process dies. Empty the rest of the time.
ALTER TABLE owners ADD COLUMN series_turn_until timestamptz;
