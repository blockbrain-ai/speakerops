# Execution manifest — Phase 10–11 FROZEN

**Status:** FROZEN 2026-08-09T12:36:04Z  
**Owner execute authorization:** 2026-08-09 — kick box after dual auditor ADEQUATE; full completion no stubs/residuals; monitor; commit+push; independent eval.

| Field | Value |
|-------|-------|
| Product repo | `/Users/qualitycontrol/Documents/speakerops` |
| Branch | `section-runner/speakerops` |
| Commit SHA (control plane authoring baseline) | `f2f4d985b406350f40aa49d8b6f56c77d9dd4bb3` |
| Worktree | **DIRTY** (153 entries) — box builds from `/data/speakerops-build`; dirty local is WIP/evidence not the box baseline unless synced |
| Control plane packs | `/Users/qualitycontrol/Documents/nood-factory/plans/runs/speakerops/spo-10.*` + `spo-11.*` |
| Pack snapshot hash-of-SHA256-file | `4b9b88930db60bcbd77ec16de7ed2cab1965a3ba7f8b97242d89d526d0f4959f` |
| Design snapshot hash-of-SHA256-file | `e70ee1d89ed7039a1f9eee035ca12b3f15ddd0ba6426e962b1fa23d5663ff933` |
| Remote host | `made-pilot` |
| RUNS_DIR | `/data/ClawdSpeakerOpsRuns` |
| ENV_FILE | `/data/section-runner-saas/.env.speakerops` |
| Product on box | `/data/speakerops-build` |
| Section range | `10.1` → `11.9` |
| SECTION_ORDER append | `10.1 10.2 10.3 10.4 10.5 10.6 10.7 11.0 11.1 11.2 11.3 11.4 11.5 11.6 11.7 11.8 11.9` |
| Builder | grok / grok-4.5 |
| Phase auditor | codex / gpt-5.6-sol / xhigh |
| Section audit | false |
| MAX_FINAL_AUDIT_ITERATIONS | 8 |
| FINAL_AUDIT_ON_NONCONVERGE | fail |
| Gates | typecheck + test:ci + test:e2e + test:e2e:inventory |
| Dogfood URL | https://www.speakerops.org |
| Side effects | product code on box; dogfood deploy in 11.9; **commit+push after complete authorized** |
| Non-goals | no stubs; no residuals; no sbek harness edits; no struck features |

## Completion contract

Owner order FULL. Exit claim dogfood_ready. DEFER empty. Agent-incomplete forbidden.
