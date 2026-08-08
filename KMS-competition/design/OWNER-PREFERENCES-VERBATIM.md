# Owner preferences — frontend, testing, and design flexibility

**Captured:** 2026-08-08  
**Status:** Canonical input for later planning / Section Runner packs. Do not paraphrase away intent.

---

## Verbatim capture (owner)

I'm gathering some more information and then we'll do a bit more planning. We're going to build with Section Runner. Now one thing Section Runner doesn't do very well or the agents in it. To be honest, I haven't had much luck with you, Grock, Claude or Codex is design a really good front end. So there's always issues between the back end and the front end not lining up properly. So in this, when we get to the planning and build stage, there's got to be a lot of end-to-end testing of absolutely every single map of every single function that needs to be shown on the front end and also what settings will the users need to be able to edit and then what permissions might they need on their end in terms of admin etc for who gets to edit things. And then for the front end itself we want a really modern easy to use high quality product. So what you can do right now is go out and get some screenshots and images of the incumbent SAS provider and any other of their direct competitors. And we're talking like something really nice, beautiful, easy to use, curvy. Think Apple, with Apple level product. We're not talking about some dark dingy, vibe coated slop. It's got to be a really nice, easy to use tasteful product. So how I would probably prefer to work this is doing actually a design brief before we get too far into the planning and trying to agree on that, but then in the actual plans themselves, making the front end so flexible that if we decide to build it with section runner and while that build that could take 10 or 12 hours, that also gives us time to play around a little bit more and refine the design. If we build it flexible enough stack, that at the other end we could do that. And I also like the idea of having a almost design kit dashboard that is the colors, branding, all of the things that we want in a finished product to give them a bit of flexibility over customizing the front end. So that would be my preference, is we design it in a way where it's not an absolute pain in the ass to make it more beautiful. So just record that verbatim as we're going to use that in the later planning steps.

---

## Structured implications (for planning; not a rewrite of intent)

1. **Build system:** Section Runner.
2. **Known agent weakness:** High-quality frontend design; backend↔frontend contract drift.
3. **Mandatory at plan/build time:** Exhaustive end-to-end testing of every UI-mapped function; settings surface; role/permission matrix (admin etc.).
4. **Product bar:** Modern, easy, high quality — Apple-like, curvy, tasteful. Not dark dingy vibe-coded slop.
5. **Process:** Design brief + agreement first; then plans that keep the frontend **flexible** so design can be refined during/after a long SR build (10–12h).
6. **Design kit / theming dashboard:** Colors, branding, tokens — customer can customize without a painful rebuild.
7. **Architecture preference:** Flexible stack so beauty is not frozen into hard-coded UI.

---

## Verbatim capture (owner) — agentic CLI / API keys · 2026-08-08

Also, I wanted to add a personal requirement of my own. We should build a CLI tool that allows the team to administer this platform agentically if they so choose. So things like the CLI, they might get their own agent to tweak the design, but they'll be doing that through the existing commands and features rather than having to manually do it. So the idea, think of it from a software 3.0 perspective, let's add a CLI tool with secure auth so that they could agentically manage the platform, including the uploading and changing of information, any kind of reporting, all the things that they would need to do. We want them to be able to manage that agentically through a CLI tool and API keys with different permissions so that different people or departments could have agents with limited permissions.

---

## Structured implications — agentic CLI (for planning)

1. **Ship a first-party CLI** for administering the platform (not only a web UI).
2. **Software 3.0 posture:** the customer's agents drive the product via CLI/API; we do not require a built-in multi-agent control plane product.
3. **Same command surface as the app:** CLI invokes existing domain commands/features (design tokens, uploads, mutations, reporting) — no side door that bypasses validation/audit.
4. **Secure auth:** API keys (or equivalent machine credentials) with **scoped permissions**.
5. **Least privilege:** different people/departments can mint keys limited by role/scope (e.g. read-only reporting vs schedule write vs design-kit only).
6. **Auditable:** CLI/API actions attributed to key identity; same audit trail as human UI actions.


---

## Verbatim capture (owner) — full browser E2E · 2026-08-08

And when I say end-to-end testing, we want full end-to-end browser testing as well. So we need a headless browser clicking through every single function on the website and performing every single function to make sure it works. So we should be able to have a list in advance of everything that should be tested and Make sure there's nothing left out.

---

## Verbatim capture (owner) — final phase onboarding + docs · 2026-08-08

Make the last phase a full onboarding path and full documentation sweep. Beautiful HTML reports and a very clear document structure and onboarding structure so that someone or their agents could easily get this thing set up.

---

## Structured implications — E2E + docs phase

1. **Exhaustive predeclared browser inventory** before/during build; every UI function has a Playwright (or equivalent) journey.
2. **Nothing left out** — inventory is the gate; unlisted controls are bugs or DEFER with owner.
3. **Last SR phase** = onboarding path + documentation sweep + HTML reports for humans and agents.
4. **Setup must be agent-operable** — clear docs tree, CLI setup, env names, Cloudflare/Airtable steps.
