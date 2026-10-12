import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Ordered, append-only schema migrations. Never edit a shipped migration — add a new one.
 * The applied version is tracked with SQLite's user_version pragma.
 */
const MIGRATIONS: string[] = [
  /* 1: initial schema */ `
  CREATE TABLE opportunities (
    id            TEXT PRIMARY KEY,
    source        TEXT NOT NULL,
    external_id   TEXT NOT NULL,
    url           TEXT NOT NULL,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    buyer         TEXT,
    country       TEXT,
    type          TEXT NOT NULL,
    category      TEXT,
    reference_no  TEXT,
    published_at  TEXT,
    deadline      TEXT,
    documents     TEXT NOT NULL DEFAULT '[]',
    meta          TEXT NOT NULL DEFAULT '{}',
    content_hash  TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'new',
    notes         TEXT NOT NULL DEFAULT '',
    owner         TEXT,
    score         INTEGER NOT NULL DEFAULT 0,
    tier          TEXT NOT NULL DEFAULT 'cold',
    breakdown     TEXT NOT NULL DEFAULT '{}',
    profile_version TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    UNIQUE (source, external_id)
  );
  CREATE INDEX idx_opp_score ON opportunities (score DESC);
  CREATE INDEX idx_opp_deadline ON opportunities (deadline);
  CREATE INDEX idx_opp_status ON opportunities (status);
  CREATE INDEX idx_opp_first_seen ON opportunities (first_seen_at DESC);

  CREATE VIRTUAL TABLE opportunities_fts USING fts5(
    title, description, buyer, country,
    content='opportunities', content_rowid='rowid', tokenize='porter unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER opp_ai AFTER INSERT ON opportunities BEGIN
    INSERT INTO opportunities_fts(rowid, title, description, buyer, country)
    VALUES (new.rowid, new.title, new.description, new.buyer, new.country);
  END;
  CREATE TRIGGER opp_ad AFTER DELETE ON opportunities BEGIN
    INSERT INTO opportunities_fts(opportunities_fts, rowid, title, description, buyer, country)
    VALUES ('delete', old.rowid, old.title, old.description, old.buyer, old.country);
  END;
  CREATE TRIGGER opp_au AFTER UPDATE OF title, description, buyer, country ON opportunities BEGIN
    INSERT INTO opportunities_fts(opportunities_fts, rowid, title, description, buyer, country)
    VALUES ('delete', old.rowid, old.title, old.description, old.buyer, old.country);
    INSERT INTO opportunities_fts(rowid, title, description, buyer, country)
    VALUES (new.rowid, new.title, new.description, new.buyer, new.country);
  END;

  CREATE TABLE analyses (
    opportunity_id TEXT PRIMARY KEY REFERENCES opportunities(id) ON DELETE CASCADE,
    model          TEXT NOT NULL,
    payload        TEXT NOT NULL,
    input_tokens   INTEGER NOT NULL DEFAULT 0,
    output_tokens  INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL
  );

  CREATE TABLE activity (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    action         TEXT NOT NULL,
    detail         TEXT,
    actor          TEXT,
    at             TEXT NOT NULL
  );
  CREATE INDEX idx_activity_opp ON activity (opportunity_id, at DESC);

  CREATE TABLE scrape_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source      TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    status      TEXT NOT NULL,
    fetched     INTEGER NOT NULL DEFAULT 0,
    created     INTEGER NOT NULL DEFAULT 0,
    updated     INTEGER NOT NULL DEFAULT 0,
    rejected    INTEGER NOT NULL DEFAULT 0,
    error       TEXT
  );
  CREATE INDEX idx_runs_source ON scrape_runs (source, started_at DESC);
  `,
  /* 2: cross-source de-duplication by URL */ `
  CREATE INDEX idx_opp_url ON opportunities (url);
  `,
];

export type Db = DatabaseSync;

export function openDatabase(file: string): Db {
  if (file !== ":memory:") mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;");
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const { user_version: current } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = current; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
