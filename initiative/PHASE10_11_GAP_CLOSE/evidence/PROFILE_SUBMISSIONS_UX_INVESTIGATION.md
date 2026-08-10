# Speaker profile + submissions detail UX investigation

**Date:** 2026-08-10  
**Auditor:** independent explore agent **REVISE** (agreed with builder)

## Speaker profile — what we capture

| Field | In data model? | Speaker portal | Admin speakers detail |
|-------|----------------|----------------|------------------------|
| Name | Yes (`people`) | Display | Header |
| Email | Yes (`people`) | Display | Profile row |
| Bio | Yes | Edit + save | Profile row |
| Job title | Yes | Edit + save | Profile row |
| Company / org | Yes | Edit + save | Profile row |
| Headshot | Yes (`headshotFileId` + files) | Upload | “Photo on file / No photo” (bytes not re-fetched after refresh — no private download URL yet) |
| Slides | Files only | Upload | Files list |
| Phone / LinkedIn / social | **No** | — | — |

**Not a full CRM contact card** — programme profile: bio + affiliation + photo + tasks/sessions.

## Gaps closed this pass

1. **Submissions answers** — `Submission.Get` enriches `label` from form fields; SPA shows label (fallback humanized `track_pref` → “Track Pref”); never primary raw snake_case.
2. **Status vocabulary** — list + detail show “Submitted / Accepted / …” with `data-status` for e2e.
3. **Speakers detail** — structured Profile card (photo slot, labeled Email / Title / Company / Bio); files humanized.
4. **Profile readiness** — admin “profile ready” now requires **bio + (company|title) + headshot**, aligned with portal steps (not OR-any-single-field).
5. Tests: unit humanize + speakers readiness; e2e status attrs; decisions get expects labels when form has them.

## Residual (honest)

- Private headshot **image** after reload still needs an auth’d file GET (out of this pass; portal uses session blob URL only).
- Assign evaluator still by user id string.
- Portal company/title dedicated e2e not expanded this pass (portal keystone still covers bio/headshot/slides/tasks).
- Form builder DnD honesty unchanged (prior schedule investigation).

## Owner check

Hard-refresh dogfood → Submissions open a row → answers should read like “Talk Title”, not `talk_title`. Speakers open a row → Profile section with labeled fields.
