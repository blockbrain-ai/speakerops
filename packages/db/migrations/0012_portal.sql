-- SpeakerOps portal support — section 4.1 (S-PORTAL / S-READY foundation)
-- Tables people (3.3), event_participations / task_templates / speaker_tasks (3.5)
-- already exist. This migration adds portal lookup indexes only (additive).
-- Rollback: revert git commit; use D1 Time Travel for data recovery.

PRAGMA foreign_keys = ON;

-- Portal.GetHome links speaker session user → participation by user_id
CREATE INDEX IF NOT EXISTS idx_event_participations_user_id
  ON event_participations(user_id);

-- Task.Complete / admin speaker detail load tasks by id
CREATE INDEX IF NOT EXISTS idx_speaker_tasks_id
  ON speaker_tasks(id);
