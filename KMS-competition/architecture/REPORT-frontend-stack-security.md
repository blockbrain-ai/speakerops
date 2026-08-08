# Frontend stack & security considerations

**Date:** 2026-08-08  
**Status:** Planning input (pairs with design kits + data-architecture report)  
**Scope:** Choose a frontend stack that can deliver Apple-level UI *without* baking in a fragile or chronically exposed client/edge surface.

This is **not** a final stack lock. It is a security-aware filter so design work (tokens, role UIs, theming) lands on a stack we are willing to operate.

---

## 1. Why this sits next to design

Design and security overlap in practice:

| Design choice | Security implication |
|---------------|----------------------|
| Customer **brand kit** (colors, logo, fonts) | Safe if CSS variables / allow-listed fonts. Unsafe if freeform CSS/JS or raw HTML logos. |
| Speaker **bios / abstracts** (rich text?) | XSS if rendered as HTML without sanitization. Prefer markdown → sanitized HTML or plain text. |
| **Status pills / dynamic labels** | Never `innerHTML` user-controlled strings; React/Svelte text binding is fine. |
| **Embeds / public schedule** (later) | CSP, clickjacking, open redirects, third-party script policy. |
| **“Flexible frontend” during SR builds** | Flexibility must mean **tokens + components**, not “inject whatever the agent invents.” |
| **E2E every UI → API map** | Also a security control: no orphan mutations, no client-only permission checks. |

Owner bar (verbatim intent): high-quality UI, flexible theming, exhaustive FE↔BE mapping.  
Security bar: **do not design around a known-bad or high-blast-radius frontend platform.**

---

## 2. Baseline we already agreed (server side)

From the data-architecture work (keep these; they shrink frontend risk):

- **Canonical API on Cloudflare Workers** — all writes as authenticated domain commands  
- **D1** system of record; **R2** for files; **Queues** for side effects  
- **No secrets in the browser** (Airtable tokens, email provider keys stay server-side)  
- **Roles:** public submitter / speaker / evaluator / admin — enforced on the Worker, not only in the UI  

The frontend is a **privileged view + input device**. It is never the security boundary.

---

## 3. Threat model (frontend-focused)

| Threat | Why it matters for this product | Severity if ignored |
|--------|----------------------------------|---------------------|
| **Stored XSS** in abstracts, bios, form answers, task notes | Speakers and submitters are untrusted; admins open their content all day | High (session theft, admin actions) |
| **Public CFP abuse** | Unauthenticated write path; spam, injection, DoS at deadline | High |
| **Broken access control** | UI hides buttons but API still allows; classic FE/BE drift | Critical |
| **Auth token theft** | Magic links / session cookies stolen via XSS or localStorage | High |
| **Supply-chain / dependency compromise** | npm ecosystem; build-time or runtime package poison | High |
| **Framework protocol RCE** | Server-side rendering protocols (notably RSC Flight) | Critical when present |
| **Unsafe theming** | Customer “custom CSS” or HTML logo → persistent XSS | High |
| **File upload abuse** | Headshots/slides: malware, SVG XSS, oversized objects | Medium–High |
| **Clickjacking / open redirect** | Magic-link landing, OAuth-less redirects | Medium |
| **CSRF** | Cookie sessions without SameSite / CSRF tokens on mutating POSTs | Medium–High |

OWASP alignment (2025 framing): **broken access control** and **supply-chain failures** dominate; XSS remains the frontend blast-radius multiplier.

---

## 4. Hard lesson: do not ignore 2025–2026 React/Next RSC risk

In December 2025, critical **unauthenticated RCE** issues were disclosed in **React Server Components** and **Next.js App Router** (industry coverage under names like React2Shell; e.g. CVE-2025-55182 / Next-side tracking around CVE-2025-66478), with follow-on RSC DoS issues into early 2026.

**Implication for us:**

- A “just use Next.js on Cloudflare” default is **not free** from a vulnerability-design perspective.  
- If we use **RSC / App Router**, we must:
  - pin **patched** framework versions,
  - automate advisory scanning,
  - treat the Flight/RSC endpoint as a high-value attack surface,
  - document upgrade SLAs.  
- If we want a **smaller edge attack surface** for a weekend + keepable product, prefer architectures where the **browser talks JSON to a Worker API** and the UI is a **static or lightly SSR app without RSC protocol** in the critical path.

This is not “never React.” It is “**do not casually inherit RSC** because a template is trendy.”

---

## 5. Stack options scored for *this* product

Criteria: security surface, Cloudflare fit, design-system flexibility, Section Runner agentability, ship speed.

Scale 1–5 (higher is better). Security is weighted in the notes, not only the number.

| Option | CF fit | Design system | SR/agent ease | Security posture | Verdict |
|--------|--------|---------------|---------------|------------------|---------|
| **A. React + Vite SPA → Hono Worker API** | 5 | 5 | 5 | **4–5** (if no RSC; CSP + cookie auth) | **Preferred default** |
| **B. Remix / React Router framework mode on CF** | 4 | 5 | 4 | **3–4** (SSR complexity; keep deps patched) | Acceptable if loaders stay thin |
| **C. Next.js App Router (RSC) on CF** | 3–4 | 5 | 4 | **2–3** unless strictly patched & minimized | **Avoid as default** for this project |
| **D. SvelteKit on CF** | 4 | 5 | 3–4 | **4** (smaller ecosystem, still need XSS hygiene) | Strong alternative |
| **E. SolidStart / Vue + Vite SPA** | 4 | 4 | 3 | **4** | Fine; weaker SR familiarity risk |
| **F. “v0 / shadcn dump + random UI kits”** | 3 | 2 | 5 | **1–2** | **Reject** — supply chain + a11y + inconsistent CSP |
| **G. Heavy client CMS / no-code embed** | 2 | 2 | 2 | **1** | Out of scope |

### Preferred shape (security-first, design-friendly)

```
Browser (React + Vite SPA, tokenized CSS)
    │  HTTPS only
    │  session: HttpOnly Secure SameSite cookies
    ▼
Cloudflare Worker (Hono)
    │  authz on every command
    │  validate with zod/valibot
    │  rate limit + Turnstile on public CFP
    ▼
D1 / R2 / Queues  (as already designed)
```

Optional: Worker serves the SPA assets (or Cloudflare Pages + same-origin API) so cookies stay first-party and CSP is simple.

---

## 6. Security controls that must ship with the UI

### 6.1 XSS & content rendering

| Rule | Practice |
|------|----------|
| Default encoding | Framework text binding only (`{value}` / `{text}`) |
| Ban untrusted HTML | No `dangerouslySetInnerHTML` / `{@html}` without a reviewed sanitizer path |
| Rich text | If needed: Markdown → **DOMPurify** (or isomorphic sanitizer) with strict allow-list |
| SVG uploads | Rasterize or serve with `Content-Disposition: attachment` / sanitize; never inline raw user SVG as HTML |
| URLs | Allow-list `https:` for links; block `javascript:` |

### 6.2 Content Security Policy (baseline)

Ship a **strict CSP** from day one (nonces or hashes for any inline bootstrap):

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-{N}';
  style-src 'self' 'nonce-{N}';
  img-src 'self' data: blob: https:;
  font-src 'self';
  connect-src 'self';
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
  object-src 'none';
  upgrade-insecure-requests
```

Notes:

- Prefer **self-hosted fonts** (or tightly pinned Google Fonts with CSP `font-src` / `style-src` updates) so design kits don’t force `unsafe-inline`.  
- Theming via **CSS variables** does **not** require `unsafe-inline` if variables are set from a small controlled stylesheet generated server-side.  
- Avoid runtime `eval`, string-built scripts, and random analytics tags in MVP.

Also set: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/mic/geolocation off), `Cross-Origin-Opener-Policy` as appropriate.

### 6.3 Auth & sessions (frontend-relevant)

| Do | Don’t |
|----|--------|
| Magic-link → **HttpOnly + Secure + SameSite=Lax/Strict** session cookie | JWT / session in `localStorage` or `sessionStorage` |
| Short session TTL; rotate on privilege change | Eternal tokens |
| CSRF defense if cookie auth on non-SameSite flows (double-submit or origin checks) | Trust `Origin`-less cross-site POSTs |
| Server-side role checks on every mutation | “Hide the button” as authz |

Roles already sketched in design kits: **submitter / speaker / evaluator / admin**. E2E matrix should assert **API denial**, not only missing UI.

### 6.4 Public CFP (unauthenticated write)

- Cloudflare **Turnstile** (or equivalent) on submit  
- Rate limits by IP + form id  
- Payload size caps; file type allow-list  
- Server-side schema validation (form version pinned)  
- No reflection of raw POST body into HTML error pages  

### 6.5 File uploads (R2)

- Presigned **PUT** with content-type + max size enforced server-side  
- Store **content-hash**; virus scan post-win if required  
- Serve downloads via **auth-checked** Worker redirects, not permanent public R2 URLs for private assets  
- Never treat user-uploaded HTML/SVG as trusted app chrome  

### 6.6 Supply chain & build

| Control | MVP | Post-win |
|---------|-----|----------|
| Lockfile committed (`pnpm-lock` / `package-lock`) | Required | Required |
| `npm audit` / `pnpm audit` in CI (fail on high/critical) | Required | Required |
| Pin framework major; dependabot/renovate | Required | Required |
| Prefer few UI deps (own design tokens + small primitives) | Required | — |
| SRI for any third-party scripts | If any | Required |
| SBOM optional | — | Nice |

**Explicit anti-pattern:** “install 40 shadcn blocks + 12 animation libs + random chart kit” for a weekend demo. That is both design-slop risk and supply-chain risk.

### 6.7 Dependency surface budget (guideline)

Aim for a **thin** client dependency set, for example:

- React (or Svelte) + router  
- Query client (optional)  
- Validation shared with server (zod)  
- Sanitizer only if rich text exists  
- Drag-and-drop: prefer one maintained lib or HTML DnD with care  

Avoid: heavy CMS runtimes, client-side Airtable SDKs with API keys, analytics tag managers in MVP.

---

## 7. Design-kit features that are security-safe vs not

### Safe (encouraged)

- CSS variables for brand color, radius, spacing, fonts  
- Logo as **image upload** (PNG/SVG sanitized) rendered as `<img>`, not inline script  
- Theme preview in admin that writes **validated** token JSON → server → CSS custom properties  
- Component gallery as static HTML/React Storybook later  

### Unsafe (reject or heavily gate)

- Freeform **custom CSS** from organizers (unless sandboxed; usually not worth it)  
- Freeform **custom HTML** in public form chrome  
- “Paste your GTM/Hotjar snippet” without CSP redesign  
- Client-side evaluation of theme JS  

**Rule of thumb:** if a theming control can execute code or inject styles that rewrite login chrome, it is a vulnerability dressed as a product feature.

---

## 8. Overlap with Section Runner & E2E (owner concern)

Owner correctly flags FE/BE drift. Security version of the same requirement:

1. **UI contract doc** per surface: route → component → API command → role → validation  
2. **E2E tests** assert:
   - happy path UI  
   - **403/401** when role is wrong (not just empty screen)  
   - XSS payloads in abstract/bio render as text  
   - CSP does not break critical flows  
3. **No “admin-only” features** that are only gated in React state  
4. Agents building UI must consume **typed API clients** generated from OpenAPI/Zod — not invent fetch URLs  

This turns “exhaustive E2E mapping” into both quality and security.

---

## 9. Recommendation for planning (opinionated)

### Default proposal

| Layer | Choice | Why |
|-------|--------|-----|
| UI | **React 19 + Vite + TypeScript SPA** | Design-system friendly, SR-familiar, **no RSC Flight surface** if we don’t enable it |
| API | **Hono on Cloudflare Workers** | Small, explicit, easy CSP/auth middleware |
| Hosting | **Pages or Worker assets** same site as API | First-party cookies, simple CSP |
| Styling | **CSS variables + small utility layer** (Tailwind *only if* purged & disciplined) | Matches design-kit theming; avoid runtime CSS-in-JS that forces weak CSP |
| Auth | Magic link + **HttpOnly session cookie** | Speakers + admins without localStorage tokens |
| Bot defense | Turnstile on public CFP | Required for open write path |
| Content | Plain text / Markdown + sanitizer | Blocks stored XSS class |
| Scanning | CI audit + lockfile | Supply chain hygiene |

### Explicit non-defaults

- **Do not** default to Next.js App Router/RSC for this competition codebase unless someone owns patch cadence and can justify SSR benefits over SPA+Worker.  
- **Do not** put Airtable API keys in the browser.  
- **Do not** implement “custom CSS” theming in MVP.  
- **Do not** use `dangerouslySetInnerHTML` for speaker content.

### If the team prefers SvelteKit

Acceptable security-wise if:

- form actions / endpoints enforce the same authz as a separate API would,  
- HTML escaping defaults are respected,  
- dependency audit discipline matches React path.

### Tailwind note

Tailwind is fine **if** build-time only and not an excuse for class soup that agents cannot theme. Prefer:

- semantic components (Button, Input, Badge) wrapping tokens  
- brand color as CSS variables consumed by utilities  

That keeps the design-kit dashboard meaningful.

---

## 10. Security checklist (use at design freeze + before SR “frontend done”)

- [ ] No RSC/Flight (or documented patched version + monitoring)  
- [ ] Session cookies HttpOnly Secure; no auth in localStorage  
- [ ] Strict CSP in production; no `unsafe-eval`; minimize `unsafe-inline`  
- [ ] All mutations server-authorized by role  
- [ ] Public CFP: captcha + rate limit + schema validation  
- [ ] User HTML path sanitized or nonexistent  
- [ ] Uploads type/size constrained; private files not world-readable  
- [ ] Theme controls = tokens only  
- [ ] Lockfile + audit in CI  
- [ ] E2E includes negative authz + XSS render cases  
- [ ] Dependency count reviewed (no kitchen-sink UI kit)  

---

## 11. What this means for the design kits

Keep the visual system (light, curvy, tokenized). Adjust implementation assumptions:

1. **Theming dashboard** → writes validated token JSON, not arbitrary CSS.  
2. **Component gallery** → becomes the allowed primitive set for SR agents (smaller surface = fewer vuln vectors).  
3. **Public CFP polish** → captcha and progressive enhancement must not break the calm UX (design for Turnstile placement).  
4. **Markdown bios** (if any) → design “rich” as *styled sanitized subset*, not full HTML.  
5. **No dark-slop aesthetic** does **not** require insecure client-side flair libraries.

---

## 12. One-paragraph decision for later planning

**We will implement the Apple-level design system as a tokenized React (Vite) SPA on Cloudflare, talking only to a Hono Worker API that owns authz, validation, and secrets. We deliberately avoid React Server Components / Next App Router as the default to keep the edge attack surface small after 2025–2026 RSC RCEs; if SSR is needed later, it must be an explicit, patched decision. Design flexibility means CSS variables and component primitives—not freeform HTML/CSS injection—and every UI control remains E2E-mapped to a server command and role.**

---

## Related artifacts

| File | Role |
|------|------|
| `architecture/REPORT-data-architecture.md` | SoR, Airtable projection, agent write path |
| `design/OWNER-PREFERENCES-VERBATIM.md` | FE quality, E2E, theming intent |
| `design/design-kit-REPORT-*.html` | Visual system / components |
| **This file** | Stack filter + vulnerability considerations |

---

*— Planning note for KMS-competition; revisit at stack freeze before Section Runner packs.*
