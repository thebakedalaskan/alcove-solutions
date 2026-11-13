-- A time someone invited to a call has asked to move it to, in their own row of its invite (docs: Privacy, keys and
-- sessions › Who can see a call). Sealed under the organizer's keys as a record of kind meeting-proposal, bound to the
-- call and that person's hash, like their answer beside it; a clear column would show when they'd rather meet. Null
-- until they ask, and again once the organizer answers or the call moves. It goes with the row: when they're taken
-- off the invite, when the call is over and when it's cancelled. Rows written before this column read as no request.
ALTER TABLE meeting_access ADD COLUMN proposal_ciphertext bytea;
