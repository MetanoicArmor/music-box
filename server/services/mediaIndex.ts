import fs from "fs";
import path from "path";
import { PATHS } from "../config.js";
import { getDb } from "../db/index.js";
import { log } from "../logger.js";
import { readFileTags } from "./tags.js";

const AUDIO_EXT = new Set([".mp3", ".mp4", ".m4a", ".ogg", ".wav", ".flac", ".webm", ".opus", ".m4b"]);

export interface MediaIndexRow {
  file_path: string;
  title: string;
  artist: string;
  album: string;
  filename: string;
  mtime: number;
}

export function upsertMediaIndex(row: MediaIndexRow): void {
  getDb()
    .prepare(`
      INSERT INTO media_index (file_path, title, artist, album, filename, mtime)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        title = excluded.title,
        artist = excluded.artist,
        album = excluded.album,
        filename = excluded.filename,
        mtime = excluded.mtime
    `)
    .run(row.file_path, row.title, row.artist, row.album, row.filename, row.mtime);
}

export function searchMediaIndex(query: string, limit = 8): MediaIndexRow[] {
  const q = `%${query.trim()}%`;
  if (query.trim().length < 2) return [];
  return getDb()
    .prepare(`
      SELECT file_path, title, artist, album, filename, mtime
      FROM media_index
      WHERE title LIKE ? OR artist LIKE ? OR album LIKE ? OR filename LIKE ?
      ORDER BY mtime DESC
      LIMIT ?
    `)
    .all(q, q, q, q, limit) as MediaIndexRow[];
}

export async function indexMediaFile(filePath: string, originalName?: string): Promise<MediaIndexRow | null> {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  const tags = await readFileTags(filePath, originalName);
  const row: MediaIndexRow = {
    file_path: path.resolve(filePath),
    title: tags.title,
    artist: tags.artist,
    album: tags.album,
    filename: originalName ? path.basename(originalName, path.extname(originalName)) : tags.filename,
    mtime: stat.mtimeMs,
  };
  upsertMediaIndex(row);
  return row;
}

export async function scanMediaLibrary(): Promise<void> {
  if (!fs.existsSync(PATHS.media)) return;

  const files = fs.readdirSync(PATHS.media)
    .map((name) => path.join(PATHS.media, name))
    .filter((p) => AUDIO_EXT.has(path.extname(p).toLowerCase()) && fs.statSync(p).isFile());

  const existing = new Map(
    (getDb().prepare("SELECT file_path, mtime FROM media_index").all() as { file_path: string; mtime: number }[])
      .map((r) => [path.resolve(r.file_path), r.mtime]),
  );

  const keep = new Set<string>();
  let indexed = 0;

  for (const file of files) {
    const resolved = path.resolve(file);
    keep.add(resolved);
    const mtime = fs.statSync(file).mtimeMs;
    const prev = existing.get(resolved);
    if (prev != null && Math.abs(prev - mtime) < 1) continue;
    await indexMediaFile(file);
    indexed++;
  }

  const stale = [...existing.keys()].filter((p) => !keep.has(p));
  if (stale.length > 0) {
    const del = getDb().prepare("DELETE FROM media_index WHERE file_path = ?");
    for (const p of stale) del.run(p);
  }

  log.info(`[media] indexed ${indexed} files, library size ${keep.size}`);
}
