-- SpeakerOps schedule placements + conflict reservations — section 6.1 (S-SCHED)
-- SCHEMA.md: schedule_placements, room_block_reservations, speaker_block_reservations
-- Hard conflict detection via reservation uniqueness + application overlap checks.
-- No OR-Tools. Rollback: revert git commit; use D1 Time Travel for data recovery.

PRAGMA foreign_keys = ON;

-- Placements: one scheduled block per session (versioned aggregate)
CREATE TABLE IF NOT EXISTS schedule_placements (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

-- One placement per session prevents double-place without Move
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_placements_session
  ON schedule_placements(session_id);

CREATE INDEX IF NOT EXISTS idx_schedule_placements_event_id
  ON schedule_placements(event_id);

CREATE INDEX IF NOT EXISTS idx_schedule_placements_room
  ON schedule_placements(event_id, room_id);

-- Room reservations: unique exact block; overlap checked in domain before insert
CREATE TABLE IF NOT EXISTS room_block_reservations (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  placement_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (placement_id) REFERENCES schedule_placements(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_room_block_reservations_unique
  ON room_block_reservations(event_id, room_id, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_room_block_reservations_room
  ON room_block_reservations(event_id, room_id);

CREATE INDEX IF NOT EXISTS idx_room_block_reservations_placement
  ON room_block_reservations(placement_id);

-- Speaker reservations: unique exact block per participation; overlap in domain
CREATE TABLE IF NOT EXISTS speaker_block_reservations (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  participation_id TEXT NOT NULL,
  placement_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (placement_id) REFERENCES schedule_placements(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_speaker_block_reservations_unique
  ON speaker_block_reservations(event_id, participation_id, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_speaker_block_reservations_speaker
  ON speaker_block_reservations(event_id, participation_id);

CREATE INDEX IF NOT EXISTS idx_speaker_block_reservations_placement
  ON speaker_block_reservations(placement_id);
