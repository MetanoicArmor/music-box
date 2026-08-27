import fs from "fs";
import path from "path";
import { PATHS } from "../config.js";
import { getDb, foldSearch } from "../db/index.js";
import { log } from "../logger.js";
import { readFileTags } from "./tags.js";
import { AUDIO_EXT } from "./mediaNames.js";

export interface MediaIndexRow {
  file_path: string;
  title: string;
  artist: string;
  album: string;
  filename: string;
  mtime: number;
  duration_sec: number | null;
}

export function upsertMediaIndex(row: MediaIndexRow): void {
  getDb()
    .prepare(`
      INSERT INTO media_index (file_path, title, artist, album, filename, mtime, duration_sec)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        title = excluded.title,
        artist = excluded.artist,
        album = excluded.album,
        filename = excluded.filename,
        mtime = excluded.mtime,
        duration_sec = excluded.duration_sec
    `)
    .run(row.file_path, row.title, row.artist, row.album, row.filename, row.mtime, row.duration_sec);
}

export function searchMediaIndex(query: string, limit = 8): MediaIndexRow[] {
  const q = `%${foldSearch(query.trim())}%`;
  if (query.trim().length < 2) return [];
  return getDb()
    .prepare(`
      SELECT file_path, title, artist, album, filename, mtime, duration_sec
      FROM media_index
      WHERE fold(title) LIKE ? OR fold(artist) LIKE ? OR fold(album) LIKE ? OR fold(filename) LIKE ?
      ORDER BY mtime DESC
      LIMIT ?
    `)
    .all(q, q, q, q, limit) as MediaIndexRow[];
}

export function listMediaLibrary(query = "", limit = 200): MediaIndexRow[] {
  const trimmed = query.trim();
  if (trimmed.length >= 2) {
    return searchMediaIndex(trimmed, limit);
  }
  return getDb()
    .prepare(`
      SELECT file_path, title, artist, album, filename, mtime, duration_sec
      FROM media_index
      ORDER BY artist ASC, album ASC, title ASC
      LIMIT ?
    `)
    .all(limit) as MediaIndexRow[];
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
    duration_sec: tags.durationSec,
  };
  upsertMediaIndex(row);
  return row;
}

function collectAudioFiles(dir: string): string[] {
  const out: string[] = [];
  const seenDirs = new Set<string>();

  const walk = (current: string) => {
    let real: string;
    try {
      real = fs.realpathSync(current);
    } catch {
      real = path.resolve(current);
    }
    if (seenDirs.has(real)) return;
    seenDirs.add(real);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (err) {
      log.warn("[media] cannot read", current, err instanceof Error ? err.message : err);
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink() || (!isDir && !isFile)) {
        try {
          const st = fs.statSync(full);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          continue;
        }
      }
      if (isDir) {
        walk(full);
      } else if (isFile && AUDIO_EXT.has(path.extname(entry.name).toLowerCase())) {
        out.push(full);
      }
    }
  };

  walk(dir);
  return out;
}

export async function scanMediaLibrary(): Promise<void> {
  if (!fs.existsSync(PATHS.media)) {
    log.warn(`[media] folder missing: ${PATHS.media}`);
    return;
  }

  const files = collectAudioFiles(PATHS.media);
  const existingRows = getDb().prepare("SELECT file_path, mtime, duration_sec FROM media_index").all() as {
    file_path: string;
    mtime: number;
    duration_sec: number | null;
  }[];
  const existing = new Map(existingRows.map((r) => [path.resolve(r.file_path), r]));

  const keep = new Set<string>();
  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const file of files) {
    const resolved = path.resolve(file);
    keep.add(resolved);
    let mtime: number;
    try {
      mtime = fs.statSync(file).mtimeMs;
    } catch (err) {
      failed++;
      log.warn("[media] stat failed", file, err instanceof Error ? err.message : err);
      continue;
    }
    const prev = existing.get(resolved);
    if (prev != null && Math.abs(prev.mtime - mtime) < 1 && prev.duration_sec != null && prev.duration_sec > 0) {
      unchanged++;
      continue;
    }
    try {
      await indexMediaFile(file);
      updated++;
    } catch (err) {
      failed++;
      log.warn("[media] index failed", file, err instanceof Error ? err.message : err);
    }
  }

  const stale = [...existing.entries()].filter(([resolved]) => !keep.has(resolved));
  if (stale.length > 0) {
    const del = getDb().prepare("DELETE FROM media_index WHERE file_path = ?");
    for (const [, row] of stale) {
      del.run(row.file_path);
      const resolved = path.resolve(row.file_path);
      if (resolved !== row.file_path) del.run(resolved);
    }
  }

  log.info(`[media] scan ${PATHS.media}`);
  log.info(`[media] indexed ${keep.size} local files for search (${updated} new/updated, ${unchanged} unchanged)`);
  if (failed > 0) {
    log.warn(`[media] ${failed} files failed to index`);
  }
  if (keep.size === 0) {
    log.warn("[media] no audio files found — put mp3/m4a/flac/wav in media/ (subfolders are scanned)");
  }
}

