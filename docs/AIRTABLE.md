# Airtable (one-way projection)

> **Soul:** **S-DOCS** · **Owner prose:** section **9.4** · **Implementation:** section **7.3**  
> **IA:** [9.1](./sections/9.1-docs-ia.md) · **Non-goal:** dual-write / Airtable as SoR

## Purpose

Operator and agent guide for **one-way** projection from D1 (system of record) → Airtable. Covers setup, scopes, lag expectations, and what never ships (writes back to D1 from Airtable).

## Status (section 9.1)

**Stub.** Full setup and lag runbook land in **9.4**. Projection worker and drain behaviour live under section **7.3** (see [sections/7.3-airtable-projection.md](./sections/7.3-airtable-projection.md)).

## Rules (locked)

| Rule | Detail |
|------|--------|
| Direction | D1 → Airtable only |
| SoR | **D1** always; Airtable is a read model for external workflows |
| Secrets | Env **names** only — `AIRTABLE_*` in [SECRETS.md](./SECRETS.md) |
| Pause | Projection may be paused when base/key unset (dogfood optional) |

## Related

- Architecture: [ARCHITECTURE.md](./ARCHITECTURE.md)  
- Operations: [OPERATIONS.md](./OPERATIONS.md)  
- Scopes / keys: [SCOPES.md](../KMS-competition/initiative/contracts/SCOPES.md) · [CLI.md](./CLI.md)  
- Programme non-goals: [0.1](./governance/0.1-programme-contract.md) · [COMPETITION.md](./COMPETITION.md)
