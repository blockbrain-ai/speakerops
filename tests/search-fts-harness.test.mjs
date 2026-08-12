/**
 * H1 — real FTS5 harness (Node built-in SQLite).
 * Asserts bm25(table) works and bm25(alias) throws — the live Find 500 shape.
 * Run via: node --test tests/search-fts-harness.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

function openFtsDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE search_documents (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      owner_user_id TEXT,
      participation_id TEXT,
      status TEXT,
      route TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE search_documents_fts USING fts5(
      title,
      body,
      content = 'search_documents',
      content_rowid = 'rowid',
      tokenize = 'porter unicode61'
    );
  `);
  return db;
}

function seed(db) {
  const docs = [
    {
      id: "d1",
      title: "Keynote opening",
      body: "welcome remarks only",
      updated: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "d2",
      title: "Workshop alpha",
      body: "deep dive into alpha alpha alpha scheduling systems",
      updated: "2026-01-02T00:00:00.000Z",
    },
    {
      id: "d3",
      title: "Alpha panel discussion",
      body: "brief mention of tools",
      updated: "2026-01-03T00:00:00.000Z",
    },
  ];
  const ins = db.prepare(`
    INSERT INTO search_documents (
      id, entity_type, entity_id, event_id, title, body,
      owner_user_id, participation_id, status, route, updated_at
    ) VALUES (?, 'session', ?, 'evt_h1', ?, ?, NULL, NULL, 'ok', '/admin/schedule', ?)
  `);
  for (const d of docs) {
    ins.run(d.id, d.id, d.title, d.body, d.updated);
  }
  db.prepare(
    `INSERT INTO search_documents_fts(search_documents_fts) VALUES('rebuild')`,
  ).run();
}

describe("H1 real-FTS harness (node:sqlite)", () => {
  it("bm25(search_documents_fts) ranks without throw", () => {
    const db = openFtsDb();
    seed(db);
    const rows = db
      .prepare(
        `
      SELECT d.id, d.title, bm25(search_documents_fts) AS rank
      FROM search_documents_fts
      JOIN search_documents d ON d.rowid = search_documents_fts.rowid
      WHERE search_documents_fts MATCH ?
        AND d.event_id = ?
      ORDER BY bm25(search_documents_fts) ASC, d.updated_at DESC
      LIMIT 10
    `,
      )
      .all("alpha", "evt_h1");

    assert.ok(rows.length >= 2);
    const ids = rows.map((r) => r.id);
    assert.ok(ids.includes("d2"));
    assert.ok(ids.includes("d3"));
    assert.ok(!ids.includes("d1"));
    for (const r of rows) {
      assert.ok(Number.isFinite(r.rank));
    }
  });

  it("bm25(alias) is invalid FTS5 — production bug shape", () => {
    const db = openFtsDb();
    seed(db);
    assert.throws(() => {
      db.prepare(
        `
        SELECT d.id
        FROM search_documents_fts AS f
        JOIN search_documents d ON d.rowid = f.rowid
        WHERE f MATCH ?
        ORDER BY bm25(f) ASC
      `,
      ).all("alpha");
    }, /no such column|bm25|fts/i);
  });

  it("LIKE order differs from bm25 for asymmetric term density", () => {
    const db = openFtsDb();
    seed(db);
    const fts = db
      .prepare(
        `
      SELECT d.id
      FROM search_documents_fts
      JOIN search_documents d ON d.rowid = search_documents_fts.rowid
      WHERE search_documents_fts MATCH ?
      ORDER BY bm25(search_documents_fts) ASC, d.updated_at DESC
    `,
      )
      .all("alpha");

    const like = db
      .prepare(
        `
      SELECT id FROM search_documents
      WHERE event_id = ? AND (title LIKE ? OR body LIKE ?)
      ORDER BY updated_at DESC
    `,
      )
      .all("evt_h1", "%alpha%", "%alpha%");

    assert.notEqual(
      fts.map((r) => r.id).join(","),
      like.map((r) => r.id).join(","),
    );
  });
});
