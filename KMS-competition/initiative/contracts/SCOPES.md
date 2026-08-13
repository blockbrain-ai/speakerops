# API key scopes

| Scope | Commands allowed (summary) |
|-------|----------------------------|
| `events:read` / `events:write` | Event list/get / create update |
| `cfp:read` / `cfp:write` | Forms admin (not public submit) |
| `submissions:read` / `submissions:write` | List/get/assign |
| `decisions:write` | Decision.Record — **default deny on new keys** |
| `speakers:read` / `speakers:write` | Portal-equivalent admin edits |
| `files:write` | Presign/complete |
| `schedule:read` / `schedule:write` | List / place move unschedule |
| `comms:draft` / `comms:send` | Preview / send — **send default deny** |
| `design:read` / `design:write` | Design get/set/publish |
| `reports:read` | Readiness, exports |
| `airtable:read` | Projection status |
| `integrations:read` | Integrations hub status (Accelevents + Airtable cards) |
| `integrations:write` | Save Accelevents connection + enqueue verify (no request-path HTTP) |
| `members:write` | Auth.CreateInvite + setMemberRole (Team) — treat as high-risk |
| `keys:admin` | Mint/revoke — **default deny** |

Browser roles map: admin ⊂ most scopes; evaluator ⊂ score only; speaker ⊂ portal; public ⊂ submit only.
