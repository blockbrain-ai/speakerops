# SpeakerOps local dogfood — login now

**Web UI:** http://127.0.0.1:5173
**API:** http://127.0.0.1:8787
**Health:** http://127.0.0.1:8787/health

Servers are running on **this Mac** (not the remote box).
Magic-link auth — **no password**. Tokens are single-use; refresh below if expired.

## Click to log in

### admin
- Email: `admin@demo.speakerops.local`
- **Open this URL:** http://127.0.0.1:5173/login?token=<single-use-token-redacted>

### evaluator
- Email: `evaluator@demo.speakerops.local`
- **Open this URL:** http://127.0.0.1:5173/login?token=<single-use-token-redacted>

### speaker
- Email: `speaker@demo.speakerops.local`
- **Open this URL:** http://127.0.0.1:5173/login?token=<single-use-token-redacted>

## After login
- Admin lands on `/admin` (shell, forms, schedule, etc.).
- Evaluator → `/eval`
- Speaker → `/portal`
- In dev chrome you should see a **role switcher** to hop between demo roles (dogfood only).

## If a link is used/expired
```bash
curl -s -X POST http://127.0.0.1:8787/api/auth/magic-link -H 'content-type: application/json' \
  -d '{"email":"admin@demo.speakerops.local","purpose":"admin"}'
curl -s 'http://127.0.0.1:8787/api/auth/dev/outbox?email=admin@demo.speakerops.local'
```
Then open: `http://127.0.0.1:5173/login?token=<single-use-token-redacted> from link.token>`

## Notes
- In-memory API: restart clears data (not the full 150-speaker seed graph).
- Not exposed on the public internet; localhost only on your machine.
- Processes: dogfood-local.mjs (8787) + vite (5173).

<!-- Local only — gitignored. Never commit magic-link tokens. -->
