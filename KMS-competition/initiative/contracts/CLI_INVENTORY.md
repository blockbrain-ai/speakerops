# CLI coverage inventory (machine-facing)

| CLI ID | Command | Scopes required | Assert | Owner | Proof |
|--------|---------|-----------------|--------|-------|-------|
| CLI01 | `speakerops events list --json` | events:read | array of events | 7.2 | 7.4 |
| CLI02 | `speakerops reports readiness --event E --json` | reports:read | outstanding[] shape | 7.2 | 7.4 |
| CLI03 | `speakerops design get --event E --json` | design:read | draft+published | 7.2 | 7.4 |
| CLI04 | `speakerops design set --event E --brand '#4F46E5'` | design:write | draft updated | 7.2 | 7.4 |
| CLI05 | `speakerops design publish --event E` | design:write | contrast gate may 400 | 7.2 | 7.4 |
| CLI06 | `speakerops schedule place ...` | schedule:write | 0 or exit 3 conflict | 7.2 | 7.4 |
| CLI07 | `speakerops schedule place` with reports-only key | reports:read only | exit 2 | 7.2 | 7.4 |
| CLI08 | `speakerops files upload ...` | files:write | file id returned | 7.2 | 7.4 |
| CLI09 | `speakerops comms draft --preview` | comms:draft | recipients listed | 7.2 | 7.4 |
| CLI10 | `speakerops comms send` without comms:send | — | exit 2 | 7.2 | 7.4 |
| CLI11 | `speakerops keys create` without keys:admin | — | exit 2 | 7.2 | 7.4 |
| CLI12 | OpenAPI `GET /openapi.json` | authed admin | lists command paths | 7.2 | 7.4 |
