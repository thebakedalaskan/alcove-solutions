-- What the listener service hears (docs: Calls and recordings › The listener): one row for each part of a live call
-- with notes on or paused, the main room's for now. The API asks LiveKit to send a listener to it (`dispatches`, when
-- last, and the one-time invite that went with it), and LiveKit's webhooks say when that listener came into the room
-- and when it left. A row isn't deleted when hearing ends: it's ended (`ended_at`, and why), so what happened can be
-- looked into, and maintenance deletes it a week later, or with the call. Each stretch of notes being on is its own task.
-- `holder` is the listener that joined with the latest invite (its call identity: a random ID, as every connection's
-- is). `heard_at` is when what it sent was last taken, and in which MLS generation and notes segment: only while
-- that's this generation and segment is it hearing that part of the call. `seen_at` is when it last asked the API
-- anything (it asks every few seconds), so one that's gone quiet without LiveKit saying so is found. `failures` counts
-- listeners in a row that left without ever being heard: each waits longer before another is sent.
-- Nothing here is readable: IDs, times and counts.
CREATE TABLE listen_tasks (
  owner_id alcove_owner_id NOT NULL,
  task_id alcove_id128 NOT NULL,
  call_id alcove_id128 NOT NULL,
  place text NOT NULL,
  dispatches int NOT NULL DEFAULT 0,
  dispatched_at timestamptz,
  invite_id text,
  holder text,
  joined_at timestamptz,
  heard_at timestamptz,
  heard_generation int,
  heard_segment int,
  seen_at timestamptz,
  failures int NOT NULL DEFAULT 0,
  left_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  ended_why text CHECK (ended_why IN ('notes-off', 'call-ended')),
  PRIMARY KEY (owner_id, task_id),
  FOREIGN KEY (owner_id, call_id) REFERENCES calls(owner_id, call_id) ON DELETE CASCADE
);
-- One task at a time for each part of a call; turning notes off and on again starts a new one, and the old one stays.
CREATE UNIQUE INDEX listen_tasks_one_open ON listen_tasks(owner_id, call_id, place) WHERE ended_at IS NULL;
-- What the supervisor reads: only what's still to be heard.
CREATE INDEX listen_tasks_open ON listen_tasks(created_at) WHERE ended_at IS NULL;
CREATE INDEX listen_tasks_ended ON listen_tasks(ended_at) WHERE ended_at IS NOT NULL;
