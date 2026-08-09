# Execution manifest — Phase 10–11 (DRAFT v1.1 — still **unfrozen**)

**Status:** DRAFT v1.1 after G4 fold — **not frozen**.  
**Freeze** = owner reviews this object + pin fields filled.  
**Execute go** = **separate** fresh authorization after freeze (never “freeze and execute” in one phrase).

## Pinned paths (canonical absolute)

| Field | Value |
|-------|-------|
| Product repo | `/Users/qualitycontrol/Documents/speakerops` |
| Control plane | `/Users/qualitycontrol/Documents/nood-factory/plans/runs/speakerops` |
| Pack snapshot (advisory/builder-readable) | `/Users/qualitycontrol/Documents/speakerops/initiative/PHASE10_11_GAP_CLOSE/evidence/packs-snapshot` |
| Design authority snapshot | `/Users/qualitycontrol/Documents/speakerops/initiative/PHASE10_11_GAP_CLOSE/evidence/design-pack-snapshot` |
| Constitution | `/Users/qualitycontrol/Documents/speakerops/initiative/PHASE10_11_GAP_CLOSE/00_CONSTITUTION.md` |
| Livability | `…/02_LIVABILITY_MATRIX.md` v2 |
| BUILD_CHECKLIST | `…/BUILD_CHECKLIST.md` |
| Remote host | `made-pilot` |
| RUNS_DIR | `/data/ClawdSpeakerOpsRuns` |
| ENV_FILE | `/data/section-runner-saas/.env.speakerops` |
| Product build path on box | `/data/speakerops-build` (verify preflight) |
| RUN_DIR_PREFIX | `spo` |
| Section range | `10.1` → `11.9` |
| SECTION_ORDER append | `10.1 10.2 10.3 10.4 10.5 10.6 10.7 11.0 11.1 11.2 11.3 11.4 11.5 11.6 11.7 11.8 11.9` |
| Dogfood URL | `https://www.speakerops.org` |

## To fill at freeze (G5a)

| Field | Value at freeze |
|-------|-----------------|
| Branch | |
| Commit SHA (clean tree or declared dirty with inventory) | |
| Worktree state | clean \| dirty+exclude list |
| Pack snapshot SHA256 of packs-snapshot.SHA256 | |
| Design snapshot SHA256 | |
| SECTION_ORDER before | (cat from live env) |
| SECTION_ORDER after | before + append (idempotent) |

## Model / audit env (must match live `.env.speakerops` at preflight)

```
BUILD_PROVIDER=grok
GROK_MODEL=grok-4.5
SECTION_AUDIT_ENABLED=false
PHASE_AUDIT_ENABLED=true
REQUIRE_INDEPENDENT_FINAL_AUDITOR=true
AUDIT_PROVIDER=codex
CODEX_MODEL=gpt-5.6-sol
CODEX_EFFORT=xhigh
FINAL_AUDIT_PROVIDER=codex
FINAL_AUDIT_CODEX_MODEL=gpt-5.6-sol
FINAL_AUDIT_CODEX_EFFORT=xhigh
MAX_FINAL_AUDIT_ITERATIONS=8
FINAL_AUDIT_ON_NONCONVERGE=fail
```

## Gates (non-discretionary)

| Gate | Command |
|------|---------|
| Typecheck | `pnpm typecheck` / `GATE_TYPECHECK_CMD` |
| Unit/integration | `pnpm test:ci` / `GATE_TEST_CMD` |
| Browser e2e | `pnpm test:e2e` |
| Inventory anti-shrinkage | `pnpm test:e2e:inventory` (**required for all 11.x and 10.x UI**) |
| Lockfile | no unapproved runtime deps vs freeze baseline hash |
| Visual/QA | 11.8 suite + LUMEN2_TASTE_SCORE ≥8.0 |

## Proof sequencing

| Checkpoint | What |
|------------|------|
| After 10.7 | Phase 10 souls **F** green |
| After 11.8 | Visual + taste **F** |
| After 11.9 | Dogfood deploy; Phase 10+11 souls **D** on www.speakerops.org; inventory green |

Mid-build: re-run Phase 10 F tests after 11.4 and 11.2 recomposes.

## Side effects (authorize explicitly)

- Product code changes on box worktree  
- Dogfood **Worker/Pages deploy** in 11.9  
- **Not** included: git push, merge to main, production DNS, third-party live creds beyond existing dogfood secrets channel  

## Rollback

- Backup SECTION_ORDER + env before mutate  
- Redeploy previous worker version  
- `git revert` section commits  
- Restore packs from control plane  

## Preflight checklist (G5c)

- [ ] Host identity made-pilot  
- [ ] No competing section-runner for speakerops group  
- [ ] Disk/capacity OK  
- [ ] Backup SECTION_ORDER + env  
- [ ] Env pins match table above  
- [ ] Design-pack snapshot present on builder path  
- [ ] Credentials channel available (names only in logs)  

## Owner freeze phrase (G5a only)

> “Freeze Phase 10–11 manifest at SHA &lt;sha&gt; with packs-snapshot hash &lt;h&gt;”

## Owner execute phrase (G5b only — after freeze)

> “Execute frozen Phase 10–11 manifest SHA &lt;sha&gt; from 10.1 to 11.9 on made-pilot .env.speakerops including dogfood deploy side effects”

## Dual advisory gate word

**ADEQUATE** (or ADOPT_WITH_NOTES with all MUST_FIX folded). Not “AGREE” as a separate vocabulary.
