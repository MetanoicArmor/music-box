import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { PATHS } from "../config.js";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    if (!fs.existsSync(PATHS.data)) {
      fs.mkdirSync(PATHS.data, { recursive: true });
    }
    db = new Database(PATHS.db);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.function("fold", { deterministic: true }, (value: unknown) => foldSearch(value));
    const hasTracks = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tracks'").get();
    if (hasTracks) {
      migrateDb(db);
    }
    const schemaPath = path.join(PATHS.root, "server", "db", "schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf-8");
    db.exec(schema);
    migrateDb(db);
  }
  return db;
}

export type DownloadStatus = "pending" | "downloading" | "ready" | "failed";

export function foldSearch(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е");
}

function migrateDb(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(tracks)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "played_at")) {
    db.exec("ALTER TABLE tracks ADD COLUMN played_at INTEGER");
  }
  if (!cols.some((c) => c.name === "download_status")) {
    db.exec("ALTER TABLE tracks ADD COLUMN download_status TEXT NOT NULL DEFAULT 'ready'");
  }
  if (!cols.some((c) => c.name === "download_error")) {
    db.exec("ALTER TABLE tracks ADD COLUMN download_error TEXT");
  }
  if (!cols.some((c) => c.name === "duration_sec")) {
    db.exec("ALTER TABLE tracks ADD COLUMN duration_sec INTEGER");
  }
  db.exec("UPDATE tracks SET download_status = 'ready' WHERE source = 'local' AND (download_status IS NULL OR download_status = '')");
  db.exec("UPDATE tracks SET download_status = 'pending' WHERE source IN ('youtube', 'spotify') AND file_path IS NULL AND status IN ('queued', 'playing') AND download_status = 'ready'");
  db.exec("UPDATE tracks SET download_status = 'pending' WHERE download_status = 'downloading'");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tracks_played ON tracks(status, played_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tracks_download ON tracks(status, download_status)");
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_index (
      file_path TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT NOT NULL DEFAULT 'Unknown',
      album TEXT NOT NULL DEFAULT '',
      filename TEXT NOT NULL DEFAULT '',
      mtime REAL NOT NULL
    )
  `);
  const mediaCols = db.prepare("PRAGMA table_info(media_index)").all() as { name: string }[];
  if (mediaCols.length > 0 && !mediaCols.some((c) => c.name === "duration_sec")) {
    db.exec("ALTER TABLE media_index ADD COLUMN duration_sec INTEGER");
  }
  const sessionCols = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
  if (sessionCols.length > 0 && !sessionCols.some((c) => c.name === "emoji")) {
    db.exec("ALTER TABLE sessions ADD COLUMN emoji TEXT");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_media_title ON media_index(title)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_media_artist ON media_index(artist)");
}

export interface TrackRow {
  id: string;
  title: string;
  artist: string;
  source: "local" | "youtube" | "spotify";
  source_ref: string | null;
  file_path: string | null;
  added_by_session: string | null;
  vote_score: number;
  status: "queued" | "playing" | "played" | "removed";
  created_at: number;
  played_at: number | null;
  download_status: DownloadStatus;
  download_error: string | null;
  duration_sec: number | null;
}

export interface SessionRow {
  id: string;
  ip: string;
  color: string;
  banned: number;
  last_seen: number;
}

export interface VoteRow {
  track_id: string;
  session_id: string;
  direction: number;
  created_at: number;
}
