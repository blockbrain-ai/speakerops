# SpeakerOps FULL dogfood (150-speaker seed)

Web: http://127.0.0.1:5173
API: http://127.0.0.1:8787
DB:  /Users/qualitycontrol/Documents/speakerops/.data/speakerops.local.sqlite (seeded)

## Login (magic link — no password; single-use)

### admin
- Email: `admin@demo.speakerops.local`
- **Login URL:** http://127.0.0.1:5173/login?token=

### evaluator
- Email: `evaluator@demo.speakerops.local`
- **Login URL:** http://127.0.0.1:5173/login?token=

### speaker
- Email: `speaker@demo.speakerops.local`
- **Login URL:** http://127.0.0.1:5173/login?token=
- Lands on `/portal?eventId=evt_dogfood` after exchange
- **Intentional incomplete onboarding:** bio task often still pending; headshot may exist for seed speaker 000. Tabs: Home · Profile · Tasks · Sessions (one programme page with active section nav).
- **CLI note:** `speakerops submissions decision --decision accept` creates participation/tasks; speaker still finishes profile/files/tasks in the portal SPA (no CLI task-complete).


<!-- Local only — gitignored. Never commit magic-link tokens. -->
