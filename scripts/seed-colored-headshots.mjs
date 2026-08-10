#!/usr/bin/env node
/**
 * Upload distinct colored-circle PNGs as speaker headshots on dogfood (or any API).
 *
 * Usage (names only — secrets via with-secrets / env):
 *   scripts/with-secrets.sh node scripts/seed-colored-headshots.mjs
 *
 * Env:
 *   SPEAKEROPS_API_URL   default https://www.speakerops.org
 *   SPEAKEROPS_API_KEY   required (scopes: speakers:write, files:write, speakers:read)
 *   SPEAKEROPS_EVENT_ID  default evt_dogfood
 *   HEADSHOT_LIMIT       max speakers to update (default 150)
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base =
  process.env.SPEAKEROPS_API_URL?.replace(/\/$/, "") ||
  "https://www.speakerops.org";
const apiKey = process.env.SPEAKEROPS_API_KEY?.trim();
const eventId = process.env.SPEAKEROPS_EVENT_ID?.trim() || "evt_dogfood";
const limit = Number(process.env.HEADSHOT_LIMIT || "150");

if (!apiKey) {
  console.error("SPEAKEROPS_API_KEY required (speakers:write,files:write,speakers:read)");
  process.exit(1);
}

const outDir = mkdtempSync(join(tmpdir(), "speakerops-heads-"));
const py = spawnSync(
  "python3",
  [join(root, "scripts/seed-colored-headshots.py"), outDir, String(limit)],
  { encoding: "utf8" },
);
if (py.status !== 0) {
  console.error(py.stderr || py.stdout);
  process.exit(py.status || 1);
}

async function api(method, path, { json, raw, contentType } = {}) {
  const headers = {
    authorization: `Bearer ${apiKey}`,
    accept: "application/json",
  };
  let body;
  if (raw) {
    headers["content-type"] = contentType || "application/octet-stream";
    body = raw;
  } else if (json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(json);
  }
  const res = await fetch(`${base}${path}`, { method, headers, body });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

const list = await api(
  "GET",
  `/api/events/${encodeURIComponent(eventId)}/speakers`,
);
if (!list.ok) {
  console.error("Speakers.List failed", list.status, list.body);
  process.exit(1);
}
const speakers = (list.body?.speakers || []).slice(0, limit);
const files = readdirSync(outDir)
  .filter((f) => f.endsWith(".png"))
  .sort();

let ok = 0;
let fail = 0;
for (let i = 0; i < speakers.length; i++) {
  const part = speakers[i].participation;
  const pngPath = join(outDir, files[i % files.length]);
  const bytes = readFileSync(pngPath);

  const presign = await api("POST", "/api/files/presign", {
    json: {
      eventId,
      purpose: "headshot",
      mime: "image/png",
      size: bytes.byteLength,
      filename: `circle-${part.id}.png`,
      ownerParticipationId: part.id,
    },
  });
  if (!presign.ok) {
    console.error("presign fail", part.id, presign.status, presign.body);
    fail += 1;
    continue;
  }
  const { fileId, url } = presign.body;
  const uploadPath = url.startsWith("http") ? new URL(url).pathname + (new URL(url).search || "") : url;
  const upload = await api("PUT", uploadPath, {
    raw: bytes,
    contentType: "image/png",
  });
  if (!upload.ok) {
    console.error("upload fail", part.id, upload.status, upload.body);
    fail += 1;
    continue;
  }
  await api("POST", `/api/files/${encodeURIComponent(fileId)}/complete`, {
    json: {
      eventId,
      filename: `circle-${part.id}.png`,
      checksum: `seed-size-${bytes.byteLength}`,
    },
  });

  const detail = await api(
    "GET",
    `/api/events/${encodeURIComponent(eventId)}/speakers/${encodeURIComponent(part.id)}`,
  );
  const version = detail.body?.participation?.version;
  if (!version) {
    console.error("detail fail", part.id, detail.status);
    fail += 1;
    continue;
  }
  const patch = await api(
    "PATCH",
    `/api/events/${encodeURIComponent(eventId)}/speakers/${encodeURIComponent(part.id)}`,
    {
      json: {
        headshotFileId: fileId,
        expectedVersion: version,
      },
    },
  );
  if (!patch.ok) {
    console.error("patch fail", part.id, patch.status, patch.body);
    fail += 1;
    continue;
  }
  ok += 1;
  if (ok % 25 === 0) console.error(`progress ${ok}/${speakers.length}`);
}

console.log(JSON.stringify({ eventId, ok, fail, total: speakers.length }, null, 2));
process.exit(fail > 0 && ok === 0 ? 1 : 0);
