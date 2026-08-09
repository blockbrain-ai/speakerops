# G3 validation evidence — Phase 10–11 packs

**Date:** 2026-08-09  
**Command:** `validate-run-pack.sh <each spo-10.*|spo-11.*> /tmp/phase10-11-manifest.json`  
**Manifest flags:** multi_component, ui, database, security, high_risk = true  

## Result

| Pack | Result |
|------|--------|
| spo-10.1 … spo-10.7 | **PASS** (17 packs total 10.x+11.x) |
| spo-11.0 … spo-11.9 | **PASS** |

Aggregate: **fail=0** after G4 fold (invariants, E9, security negatives, path fixes, named ACs on sampled packs).

## Snapshot

- Readable copy: `evidence/packs-snapshot/`  
- Hashes: `evidence/packs-snapshot.SHA256`  
- Design authority snapshot: `evidence/design-pack-snapshot/` + `.SHA256`  

## Consistency

- ACTIVE-RUNS-10 order matches spo-10.1→10.7  
- ACTIVE-RUNS-11 order matches spo-11.0→11.9  
- SECTION_ORDER.proposed.txt includes 10.1–11.9  
- Livability v2 maps every soul to section + playwright path  
