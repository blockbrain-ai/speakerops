/**
 * Section 10.4 — DEMO persona session mint helper for agents / local ops.
 *
 * Mints real session cookies for admin / evaluator / speaker via
 * POST /api/auth/dev/role-switch (never invents a public email outbox).
 *
 * Modes:
 * - open bootstrap (local e2e API, default): unauthenticated role-switch OK
 * - controlled dogfood: pass --cookie "speakerops_session=…" from an existing
 *   event-admin session (ROLE_SWITCHER_ENABLED=1 required on the Worker)
 *
 * Usage:
 *   node scripts/sbek-mint-auth-states.mjs
 *   node scripts/sbek-mint-auth-states.mjs --base-url http://127.0.0.1:8787
 *   node scripts/sbek-mint-auth-states.mjs --base-url https://www.speakerops.org \
 *     --cookie "speakerops_session=<admin-token>"
 *
 * Env (names only — E10):
 *   SPEAKEROPS_API_BASE_URL — default http://127.0.0.1:8787
 *   SPEAKEROPS_MINT_COOKIE  — optional Cookie header for controlled dogfood
 *   SPEAKEROPS_EVENT_ID     — default evt_dogfood
 *
 * Writes redacted metadata to .data/mint-states/ (gitignored via .data/).
 * Session token values are written only under .data/ (never commit).
 *
 * Exit nonzero on failure. Does not log full session tokens.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const ROLES = /** @type {const} */ (["admin", "evaluator", "speaker"]);

const DEMO_EMAILS = {
  admin: "admin@demo.speakerops.local",
  evaluator: "evaluator@demo.speakerops.local",
  speaker: "speaker@demo.speakerops.local",
};

function parseArgs(argv) {
  /** @type {{ baseUrl: string; cookie: string | null; eventId: string; outDir: string }} */
  const out = {
    baseUrl:
      process.env.SPEAKEROPS_API_BASE_URL?.trim() || "http://127.0.0.1:8787",
    cookie: process.env.SPEAKEROPS_MINT_COOKIE?.trim() || null,
    eventId: process.env.SPEAKEROPS_EVENT_ID?.trim() || "evt_dogfood",
    outDir: join(root, ".data", "mint-states"),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base-url" && argv[i + 1]) {
      out.baseUrl = argv[++i];
    } else if (a === "--cookie" && argv[i + 1]) {
      out.cookie = argv[++i];
    } else if (a === "--event-id" && argv[i + 1]) {
      out.eventId = argv[++i];
    } else if (a === "--out-dir" && argv[i + 1]) {
      out.outDir = argv[++i];
    } else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/sbek-mint-auth-states.mjs [options]
  --base-url URL     API origin (default SPEAKEROPS_API_BASE_URL or :8787)
  --cookie HEADER    Cookie header for controlled dogfood admin session
  --event-id ID      Event id (default evt_dogfood)
  --out-dir PATH     Write states under PATH (default .data/mint-states)
`);
      process.exit(0);
    }
  }
  return out;
}

/**
 * @param {string} setCookie
 * @param {string} name
 * @returns {string | null}
 */
function cookieValue(setCookie, name) {
  if (!setCookie) return null;
  // Multi Set-Cookie may be joined with comma in some runtimes; match name=
  const re = new RegExp(
    `(?:^|,\\s*|\\n)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;,\n]+)`,
  );
  const m = setCookie.match(re);
  return m?.[1]?.trim() || null;
}

/**
 * @param {string} setCookie
 */
function assertCookieFlags(setCookie) {
  const lower = setCookie.toLowerCase();
  if (!lower.includes("httponly")) {
    throw new Error("Set-Cookie missing HttpOnly");
  }
  if (!/samesite=lax/.test(lower)) {
    throw new Error("Set-Cookie missing SameSite=Lax");
  }
  if (!/path=\//.test(setCookie)) {
    throw new Error("Set-Cookie missing Path=/");
  }
  if (/;\s*domain=/.test(lower)) {
    throw new Error("Set-Cookie must be host-only (no Domain=) for dogfood");
  }
}

async function mintRole(baseUrl, role, eventId, cookieHeader) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (cookieHeader) {
    headers.cookie = cookieHeader;
  }
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/auth/dev/role-switch`, {
    method: "POST",
    headers,
    body: JSON.stringify({ role, eventId }),
  });
  const setCookie =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie().join("\n")
      : res.headers.get("set-cookie") ?? "";
  const raw = await res.json().catch(() => null);
  if (!res.ok) {
    const err =
      raw && typeof raw === "object" && "error" in raw
        ? String(/** @type {{ error: unknown }} */ (raw).error)
        : `HTTP ${res.status}`;
    throw new Error(
      `role-switch ${role} failed: ${err} (status ${res.status}). ` +
        (res.status === 404
          ? "ROLE_SWITCHER_ENABLED may be off or route absent."
          : res.status === 401
            ? "Controlled dogfood needs --cookie with an admin session."
            : ""),
    );
  }
  assertCookieFlags(setCookie);
  const session = cookieValue(setCookie, "speakerops_session");
  if (!session) {
    throw new Error(`role-switch ${role}: no speakerops_session in Set-Cookie`);
  }
  const body = /** @type {{ ok: boolean; role: string; email: string; eventId: string; redirectTo: string }} */ (
    raw
  );
  return {
    role: body.role,
    email: body.email ?? DEMO_EMAILS[role],
    eventId: body.eventId ?? eventId,
    redirectTo: body.redirectTo,
    sessionToken: session,
    setCookieFlags: {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      secure: /(?:^|;\s*)secure(?:;|$)/i.test(setCookie),
      hostOnly: !/;\s*domain=/i.test(setCookie),
    },
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(opts.outDir, { recursive: true });

  /** @type {Record<string, unknown>} */
  const states = {
    mintedAt: new Date().toISOString(),
    baseUrl: opts.baseUrl,
    eventId: opts.eventId,
    note:
      "Session tokens under .data/ only — never commit. Dogfood has no public /dev outbox.",
    roles: {},
  };

  let cookieHeader = opts.cookie;
  for (const role of ROLES) {
    const minted = await mintRole(
      opts.baseUrl,
      role,
      opts.eventId,
      cookieHeader,
    );
    // Chain: after first mint, use that session for controlled multi-role if needed
    // (open bootstrap does not require it; controlled needs judge cookie).
    if (!cookieHeader) {
      cookieHeader = `speakerops_session=${minted.sessionToken}`;
    }
    const file = join(opts.outDir, `${role}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        {
          role: minted.role,
          email: minted.email,
          eventId: minted.eventId,
          redirectTo: minted.redirectTo,
          // Full token for agent automation only — directory is under .data/
          sessionToken: minted.sessionToken,
          cookieHeader: `speakerops_session=${minted.sessionToken}`,
          setCookieFlags: minted.setCookieFlags,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    /** @type {Record<string, unknown>} */ (states.roles)[role] = {
      email: minted.email,
      redirectTo: minted.redirectTo,
      stateFile: file,
      // Redacted proof for stdout / shared logs
      sessionTokenPreview: `${minted.sessionToken.slice(0, 4)}…(${minted.sessionToken.length} chars)`,
      setCookieFlags: minted.setCookieFlags,
    };
    console.log(
      `minted ${role} → ${minted.redirectTo} (${minted.email}) flags=${JSON.stringify(minted.setCookieFlags)}`,
    );
  }

  const summaryPath = join(opts.outDir, "summary.json");
  writeFileSync(summaryPath, JSON.stringify(states, null, 2) + "\n");
  console.log(`summary: ${summaryPath}`);
  console.log(
    "S-AUTH-ROLES mint complete. Use cookieHeader from each role file for API/browser; do not commit .data/.",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
