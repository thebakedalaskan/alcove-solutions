-- The calls a workspace is open to (docs: Privacy, keys and sessions › Who can open a workspace). While a call uses a
-- workspace, everyone let in to it can open and edit what's in it that isn't restricted, for as long as they're in the call.
-- `call_index` is the blind index 'call-workspace' of the call's ID and the workspace's handle, which is what a seat in that
-- call carries while the call uses this workspace: switching to another changes what every seat carries, so nothing here
-- has to move for this one to close. It counts only while `organizer_index` (the 'email' index of the call's organizer) can
-- edit the workspace, since a call adds to one on its organizer's word alone. `call_id` finds a call's rows when it ends,
-- when they're deleted; a seat stops opening anything the moment its call ends or its person leaves, whatever's here.
CREATE TABLE workspace_calls (
  owner_id alcove_owner_id NOT NULL REFERENCES workspaces(owner_id) ON DELETE CASCADE,
  call_index bytea NOT NULL,
  call_id alcove_id128 NOT NULL,
  organizer_index bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, call_index)
);
CREATE INDEX workspace_calls_call ON workspace_calls(call_id);
