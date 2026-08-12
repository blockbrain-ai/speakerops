#!/usr/bin/env node
/**
 * E3 — Idempotent remote seed of demo Resources + File Requests for dogfood.
 * Usage: scripts/with-secrets.sh node scripts/seed-dogfood-portal.mjs
 */
import { spawnSync } from "node:child_process";

const EVENT_ID = process.env.SEED_EVENT_ID || "evt_dogfood";
const DB = process.env.DOGFOOD_D1_NAME || "speakerops-demo";
const ENV = process.env.DOGFOOD_WRANGLER_ENV || "dogfood";
const now = new Date().toISOString();

function run(sql) {
  const r = spawnSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      DB,
      "--remote",
      "--env",
      ENV,
      "--command",
      sql,
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    throw new Error("wrangler d1 execute failed");
  }
  return r.stdout;
}

const esc = (s) => String(s).replace(/'/g, "''");

// Stable seed ids for idempotent upsert via ON CONFLICT
const resourceSql = `
INSERT INTO portal_resources (id, event_id, title, body_md, status, sort_order, created_at, updated_at, version)
VALUES (
  'resource_seed_coc',
  '${esc(EVENT_ID)}',
  'Code of conduct',
  'Be kind. Be curious. Respect every speaker and attendee.',
  'published',
  0,
  '${esc(now)}',
  '${esc(now)}',
  1
)
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  body_md = excluded.body_md,
  status = 'published',
  updated_at = excluded.updated_at;
`;

const fileReqSql = `
INSERT INTO file_requests (id, event_id, title, instructions, scope, status, purpose, created_at, updated_at, version)
VALUES (
  'file_request_seed_session_pdf',
  '${esc(EVENT_ID)}',
  'Session PDF',
  'Upload your final deck as PDF (max 10 MB).',
  'participation',
  'published',
  'other',
  '${esc(now)}',
  '${esc(now)}',
  1
)
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  instructions = excluded.instructions,
  status = 'published',
  updated_at = excluded.updated_at;
`;

console.log("Seeding portal library for", EVENT_ID);
run(resourceSql);
run(fileReqSql);
const verify = run(
  `SELECT id, title, status FROM portal_resources WHERE event_id='${esc(EVENT_ID)}' AND id LIKE 'resource_seed_%';
SELECT id, title, status FROM file_requests WHERE event_id='${esc(EVENT_ID)}' AND id LIKE 'file_request_seed_%';`,
);
console.log(verify);
console.log(JSON.stringify({ ok: true, eventId: EVENT_ID }, null, 2));
