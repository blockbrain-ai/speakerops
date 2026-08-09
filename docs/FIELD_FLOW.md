# Field flow (forms & portal)

> **Soul:** **S-DOCS** · **Owner prose:** section **9.4** · **IA:** [9.1](./sections/9.1-docs-ia.md)  
> **Highlight:** initiative **I16** (forms → submission → portal tasks)

## Purpose

Operator-facing highlights of how **form builder fields** flow into public CFP submissions, evaluation, accept/reject decisions, and speaker portal tasks — including file uploads (R2) and status surfaces. Complements deep architecture without replacing schema contracts.

## Status (section 9.1)

**Stub.** Full I16 narrative lands in **9.4** (must not remain unowned — assigned in [0.5](./governance/0.5-docs-onboarding-outline.md)). Implementation spans phases 3–4 (form builder, public CFP, portal, R2).

## Flow sketch (orientation)

```text
Form builder (admin) → publish
        ↓
Public CFP submit (+ Turnstile)
        ↓
Evaluation / scoring
        ↓
Decision (accept / reject) → speaker tasks
        ↓
Portal complete tasks + uploads (R2)
        ↓
Readiness / schedule consumers
```

## Related contracts & docs

| Topic | Doc |
|-------|-----|
| Schema | [SCHEMA.md](../KMS-competition/initiative/contracts/SCHEMA.md) |
| Commands | [COMMANDS.md](../KMS-competition/initiative/contracts/COMMANDS.md) |
| Architecture | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| E2E journeys | [E2E.md](./E2E.md) · inventory A*/D*/E*/F*/G* |
| Human demo path | [ONBOARDING.md](./ONBOARDING.md) |
| Troubleshooting | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) |
| Design tokens | [0.2 Lumen lock](./governance/0.2-lumen-lock.md) |

## Section notes (implementation)

- Form builder API/UI: [3.1](./sections/3.1-form-builder-api.md) · [3.2](./sections/3.2-form-builder-ui.md)  
- Public CFP: [3.3](./sections/3.3-public-cfp.md)  
- Evaluation / decisions: [3.4](./sections/3.4-evaluation.md) · [3.5](./sections/3.5-decisions.md)  
- Portal + R2: [4.1](./sections/4.1-portal-api.md) · [4.2](./sections/4.2-r2-uploads.md) · [4.3](./sections/4.3-portal-ui.md)
