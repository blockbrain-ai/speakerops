/**
 * D1 store regressions against the real migration schema (sql.js shim).
 *
 * - 10.1 `?q=` 500: listPrimarySpeakerNames must chunk IN lists under the
 *   D1 100-bound-parameter limit when the search path passes >100 row ids.
 * - 7.1 Keys.List 500: api_keys rows minted before migration 0022 have NULL
 *   created_at — the D1 keys store must map them to the fixed fallback ISO
 *   so response validation never fails.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import type { Database, SqlJsStatic } from "sql.js";
import {
  ApiKeySchema,
  API_KEY_CREATED_AT_FALLBACK,
} from "../../packages/shared/src/keys.js";
import { migrate } from "../../packages/db/src/migrate.js";
import { SqlJsD1 } from "../helpers/sqljs-d1.js";
import { D1SubmissionsStore } from "../../apps/api/src/modules/publicCfp/store.js";
import { D1KeysStore } from "../../apps/api/src/modules/keys/store.js";
import { toApiKeyDto } from "../../apps/api/src/modules/keys/commands.js";

const require = createRequire(import.meta.url);

let SQL: SqlJsStatic;

beforeAll(async () => {
  const initSqlJs = require("sql.js") as (config?: {
    locateFile?: (file: string) => string;
  }) => Promise<SqlJsStatic>;
  let wasmDir: string;
  try {
    wasmDir = dirname(require.resolve("sql.js/dist/sql-wasm.js"));
  } catch {
    wasmDir = dirname(require.resolve("sql.js"));
  }
  SQL = await initSqlJs({ locateFile: (file: string) => join(wasmDir, file) });
});

/** Migrated database loaded into an in-memory sql.js handle. */
async function migratedDb(prefix: string): Promise<Database> {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const dbPath = join(dir, "d1.sqlite");
  try {
    await migrate({ dbPath });
    return new SQL.Database(new Uint8Array(readFileSync(dbPath)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("D1SubmissionsStore.listPrimarySpeakerNames (10.1 q search)", () => {
  it("chunks >100 submission ids under the D1 bound-parameter limit", async () => {
    const db = await migratedDb("spo-d1-subs-");
    try {
      const now = "2026-06-01T12:00:00.000Z";
      const ids: string[] = [];
      for (let i = 0; i < 120; i++) {
        const idx = String(i).padStart(3, "0");
        const subId = `sub_ck_${idx}`;
        const personId = `person_ck_${idx}`;
        ids.push(subId);
        db.run(
          `INSERT INTO people (id, org_id, email, name, created_at, updated_at)
           VALUES (?, 'org_ck', ?, ?, ?, ?)`,
          [personId, `ck${idx}@example.com`, `Chunk Speaker ${idx}`, now, now],
        );
        db.run(
          `INSERT INTO submissions (id, event_id, form_version_id, title, category, status, submitted_at, version)
           VALUES (?, 'evt_ck', 'fv_ck', ?, NULL, 'submitted', ?, 1)`,
          [subId, `Talk ${idx}`, now],
        );
        db.run(
          `INSERT INTO submission_speakers (submission_id, person_id, is_primary, sort_order)
           VALUES (?, ?, 1, 0)`,
          [subId, personId],
        );
      }

      const store = new D1SubmissionsStore(new SqlJsD1(db));
      // Pre-fix this threw: D1_ERROR too many SQL variables (120 > 100).
      const names = await store.listPrimarySpeakerNames(ids);
      expect(names.size).toBe(120);
      expect(names.get("sub_ck_000")).toBe("Chunk Speaker 000");
      expect(names.get("sub_ck_119")).toBe("Chunk Speaker 119");

      const rows = await store.listSubmissionsByIds(ids);
      expect(rows.size).toBe(120);
      expect(rows.get("sub_ck_042")?.title).toBe("Talk 042");
    } finally {
      db.close();
    }
  });
});

describe("D1KeysStore created_at tolerance (7.1 Keys.List)", () => {
  it("a row without created_at still lists (fallback ISO, DTO validates)", async () => {
    const db = await migratedDb("spo-d1-keys-");
    try {
      db.run(`INSERT INTO organizations (id, name, created_at, updated_at)
              VALUES ('org_keys', 'Keys Org', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`);
      // Pre-0022-backfill shape: created_at NULL
      db.run(
        `INSERT INTO api_keys (id, org_id, name, key_prefix, key_hash, scopes_json, event_id, expires_at, revoked_at, created_by, last_used_at, created_at)
         VALUES ('key_null', 'org_keys', 'legacy-key', 'spk_deadbeef', 'hash_null', ?, NULL, NULL, NULL, 'user_1', NULL, NULL)`,
        [JSON.stringify(["events:read"])],
      );
      db.run(
        `INSERT INTO api_keys (id, org_id, name, key_prefix, key_hash, scopes_json, event_id, expires_at, revoked_at, created_by, last_used_at, created_at)
         VALUES ('key_new', 'org_keys', 'fresh-key', 'spk_0badf00d', 'hash_new', ?, NULL, NULL, NULL, 'user_1', NULL, '2026-08-10T10:00:00.000Z')`,
        [JSON.stringify(["events:read"])],
      );

      const store = new D1KeysStore(new SqlJsD1(db));
      const rows = await store.listKeys({ orgId: "org_keys" });
      expect(rows).toHaveLength(2);

      const legacy = rows.find((r) => r.id === "key_null")!;
      expect(legacy.createdAt).toBe(API_KEY_CREATED_AT_FALLBACK);
      const fresh = rows.find((r) => r.id === "key_new")!;
      expect(fresh.createdAt).toBe("2026-08-10T10:00:00.000Z");

      // The DTO must pass response validation for both (live 500 regression)
      for (const row of rows) {
        const parsed = ApiKeySchema.safeParse(toApiKeyDto(row));
        expect(parsed.success, `row ${row.id} must validate`).toBe(true);
      }
    } finally {
      db.close();
    }
  });

  it("revokeKey reports the updated row (d1Changes reads the UPDATE result)", async () => {
    const db = await migratedDb("spo-d1-keys-rev-");
    try {
      db.run(`INSERT INTO organizations (id, name, created_at, updated_at)
              VALUES ('org_rev', 'Rev Org', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`);
      db.run(
        `INSERT INTO api_keys (id, org_id, name, key_prefix, key_hash, scopes_json, event_id, expires_at, revoked_at, created_by, last_used_at, created_at)
         VALUES ('key_rev', 'org_rev', 'revocable', 'spk_beefcafe', 'hash_rev', ?, NULL, NULL, NULL, 'user_1', NULL, '2026-08-10T10:00:00.000Z')`,
        [JSON.stringify(["events:read"])],
      );

      const store = new D1KeysStore(new SqlJsD1(db));
      const revoked = await store.revokeKey(
        "key_rev",
        "2026-08-10T11:00:00.000Z",
      );
      expect(revoked).not.toBeNull();
      expect(revoked!.revokedAt).toBe("2026-08-10T11:00:00.000Z");

      // Second revoke is a no-op → null (already revoked)
      const again = await store.revokeKey(
        "key_rev",
        "2026-08-10T12:00:00.000Z",
      );
      expect(again).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe("D1KeysStore demo quota (8.4 atomic INSERT...SELECT enforcement)", () => {
  const DEMO_UID = "user_demo_quota";

  function keyRow(id: string, overrides: Partial<import("../../apps/api/src/modules/keys/store.js").ApiKeyRow> = {}) {
    const nowIso = new Date().toISOString();
    return {
      id,
      orgId: "org_quota",
      name: id,
      keyPrefix: `spk_${id.slice(-8).padStart(8, "0")}`,
      keyHash: `hash_${id}`,
      scopesJson: JSON.stringify(["events:read"]),
      eventId: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      revokedAt: null,
      createdBy: DEMO_UID,
      createdAt: nowIso,
      lastUsedAt: null,
      ...overrides,
    };
  }

  function quota(overrides: Partial<import("../../apps/api/src/modules/keys/store.js").DemoMintQuota> = {}) {
    return {
      creatorIds: [DEMO_UID],
      nowIso: new Date().toISOString(),
      activeLimit: 2,
      mintWindowStartIso: new Date(
        Date.now() - 24 * 60 * 60 * 1000,
      ).toISOString(),
      mintLimit: 100,
      ...overrides,
    };
  }

  async function quotaDb(prefix: string) {
    const db = await migratedDb(prefix);
    db.run(`INSERT INTO organizations (id, name, created_at, updated_at)
            VALUES ('org_quota', 'Quota Org', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`);
    return db;
  }

  it("active cap enforced inside the INSERT statement; revoke frees it", async () => {
    const db = await quotaDb("spo-d1-quota-act-");
    try {
      const store = new D1KeysStore(new SqlJsD1(db));
      expect(
        await store.insertKeyWithinDemoQuota(keyRow("qa_1"), quota()),
      ).toBe("inserted");
      expect(
        await store.insertKeyWithinDemoQuota(keyRow("qa_2"), quota()),
      ).toBe("inserted");
      // Third insert loses inside the single statement — no row written.
      expect(
        await store.insertKeyWithinDemoQuota(keyRow("qa_3"), quota()),
      ).toBe("quota");
      expect(await store.findById("qa_3")).toBeNull();

      // Revocation frees the ACTIVE cap (releasing arm).
      await store.revokeKey("qa_1", new Date().toISOString());
      expect(
        await store.insertKeyWithinDemoQuota(keyRow("qa_3"), quota()),
      ).toBe("inserted");
      expect(await store.findById("qa_3")).not.toBeNull();
    } finally {
      db.close();
    }
  });

  it("rolling mint cap counts revoked rows too (non-releasing arm)", async () => {
    const db = await quotaDb("spo-d1-quota-mint-");
    try {
      const store = new D1KeysStore(new SqlJsD1(db));
      const q = () => quota({ activeLimit: 25, mintLimit: 3 });
      expect(await store.insertKeyWithinDemoQuota(keyRow("qm_1"), q())).toBe(
        "inserted",
      );
      // Revoke immediately — a create→revoke loop's residue.
      await store.revokeKey("qm_1", new Date().toISOString());
      expect(await store.insertKeyWithinDemoQuota(keyRow("qm_2"), q())).toBe(
        "inserted",
      );
      expect(await store.insertKeyWithinDemoQuota(keyRow("qm_3"), q())).toBe(
        "inserted",
      );
      // Only 2 active, but 3 mints in the window → blocked; nothing written.
      expect(await store.insertKeyWithinDemoQuota(keyRow("qm_4"), q())).toBe(
        "quota",
      );
      expect(await store.findById("qm_4")).toBeNull();
      expect(
        await store.countKeysCreatedSince([DEMO_UID], q().mintWindowStartIso),
      ).toBe(3);
    } finally {
      db.close();
    }
  });

  it("offset-form future expiry counts as ACTIVE (datetime(), not lexical)", async () => {
    const db = await quotaDb("spo-d1-quota-off-");
    try {
      const store = new D1KeysStore(new SqlJsD1(db));
      // Instant 2h in the future written as -10:00 — the string sorts BEFORE
      // now-Z, so a lexical compare would wrongly treat it as expired.
      const instant = Date.now() + 2 * 60 * 60 * 1000;
      const offsetIso = new Date(instant - 10 * 60 * 60 * 1000)
        .toISOString()
        .replace(/Z$/, "-10:00");
      const nowIso = new Date().toISOString();
      expect(offsetIso < nowIso).toBe(true); // the lexical trap is real
      expect(Date.parse(offsetIso)).toBe(instant); // same future instant

      await store.insertKey(keyRow("qo_1", { expiresAt: offsetIso }));
      expect(await store.countActiveKeysByCreators([DEMO_UID], nowIso)).toBe(1);

      // And an offset-form PAST expiry is correctly not active.
      const pastOffset = new Date(Date.now() - 30 * 60 * 1000 - 10 * 60 * 60 * 1000)
        .toISOString()
        .replace(/Z$/, "-10:00");
      await store.insertKey(
        keyRow("qo_2", { keyHash: "hash_qo_2b", expiresAt: pastOffset }),
      );
      expect(await store.countActiveKeysByCreators([DEMO_UID], nowIso)).toBe(1);
    } finally {
      db.close();
    }
  });
});
