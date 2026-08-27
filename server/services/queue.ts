import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { getDb, TrackRow, DownloadStatus, foldSearch } from "../db/index.js";
import type { AppConfig } from "../config.js";
import { broadcast } from "../ws/broadcast.js";

const SESSION_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16",
];

export function getOrCreateSession(sessionId: string | undefined, ip: string): { id: string; color: string; banned: boolean } {
  const db = getDb();
  const now = Date.now();

  if (sessionId) {
    const existing = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as { id: string; color: string; banned: number } | undefined;
    if (existing) {
      db.prepare("UPDATE sessions SET last_seen = ?, ip = ? WHERE id = ?").run(now, ip, sessionId);
      return { id: existing.id, color: existing.color, banned: existing.banned === 1 };
    }
  }

  const cutoff = now - 5 * 60 * 1000;
  const recentSameIp = db.prepare(`
    SELECT id, color, banned FROM sessions
    WHERE ip = ? AND banned = 0 AND last_seen > ?
    ORDER BY last_seen DESC LIMIT 1
  `).get(ip, cutoff) as { id: string; color: string; banned: number } | undefined;

  if (recentSameIp) {
    db.prepare("UPDATE sessions SET last_seen = ? WHERE id = ?").run(now, recentSameIp.id);
    return { id: recentSameIp.id, color: recentSameIp.color, banned: recentSameIp.banned === 1 };
  }

  const id = uuidv4();
  const color = SESSION_COLORS[Math.floor(Math.random() * SESSION_COLORS.length)];
  db.prepare("INSERT INTO sessions (id, ip, color, banned, last_seen) VALUES (?, ?, ?, 0, ?)").run(id, ip, color, now);
  return { id, color, banned: false };
}

export function isSessionBanned(sessionId: string): boolean {
  const row = getDb().prepare("SELECT banned FROM sessions WHERE id = ?").get(sessionId) as { banned: number } | undefined;
  return row?.banned === 1;
}

export function isIpBanned(ip: string): boolean {
  const row = getDb().prepare("SELECT COUNT(*) as c FROM sessions WHERE ip = ? AND banned = 1").get(ip) as { c: number };
  return row.c > 0;
}

export function getActiveUserCount(): number {
  const cutoff = Date.now() - 5 * 60 * 1000;
  const row = getDb()
    .prepare("SELECT COUNT(DISTINCT ip) as c FROM sessions WHERE last_seen > ? AND banned = 0")
    .get(cutoff) as { c: number };
  return row.c;
}

export function checkVoteRateLimit(sessionId: string, config: AppConfig): boolean {
  const cutoff = Date.now() - config.voteRateWindowSec * 1000;
  const row = getDb()
    .prepare("SELECT COUNT(*) as c FROM votes WHERE session_id = ? AND created_at > ?")
    .get(sessionId, cutoff) as { c: number };
  return row.c < config.voteRateLimit;
}

export interface TrackInput {
  title: string;
  artist?: string;
  source: "local" | "youtube" | "spotify";
  sourceRef?: string;
  filePath?: string;
  sessionId: string;
  durationSec?: number | null;
}

export function addTrack(input: TrackInput): TrackRow {
  const db = getDb();
  const id = uuidv4();
  const now = Date.now();
  const artist = input.artist ?? "Unknown";
  const durationSec = input.durationSec ?? durationFromMedia(input.filePath);

  db.prepare(`
    INSERT INTO tracks (id, title, artist, source, source_ref, file_path, added_by_session, vote_score, status, created_at, download_status, duration_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'queued', ?, ?, ?)
  `).run(
    id,
    input.title,
    artist,
    input.source,
    input.sourceRef ?? null,
    input.filePath ?? null,
    input.sessionId,
    now,
    input.filePath ? "ready" : input.source === "local" ? "ready" : "pending",
    durationSec ?? null,
  );

  return db.prepare("SELECT * FROM tracks WHERE id = ?").get(id) as TrackRow;
}

function durationFromMedia(filePath?: string | null): number | null {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  const row = getDb()
    .prepare("SELECT duration_sec FROM media_index WHERE file_path = ? OR file_path = ?")
    .get(filePath, resolved) as { duration_sec: number | null } | undefined;
  return row?.duration_sec ?? null;
}

export function getQueuedTracks(): TrackRow[] {
  return getDb()
    .prepare("SELECT * FROM tracks WHERE status = 'queued' ORDER BY vote_score DESC, created_at ASC")
    .all() as TrackRow[];
}

export function getCurrentTrack(): TrackRow | null {
  const row = getDb().prepare("SELECT * FROM tracks WHERE status = 'playing' LIMIT 1").get();
  return (row as TrackRow) ?? null;
}

export function getPlayedTracks(limit = 50): TrackRow[] {
  return getDb()
    .prepare(`
      SELECT * FROM tracks
      WHERE status = 'played'
      ORDER BY COALESCE(played_at, created_at) DESC
      LIMIT ?
    `)
    .all(limit) as TrackRow[];
}

export function searchPlayedTracks(query: string, limit = 40): TrackRow[] {
  const q = `%${foldSearch(query.trim())}%`;
  if (query.trim().length < 2) return getPlayedTracks(limit);
  return getDb()
    .prepare(`
      SELECT t.* FROM tracks t
      LEFT JOIN media_index m ON m.file_path = t.file_path
      WHERE t.status = 'played' AND (
        fold(t.title) LIKE ? OR fold(t.artist) LIKE ?
        OR fold(IFNULL(m.title, '')) LIKE ? OR fold(IFNULL(m.artist, '')) LIKE ?
        OR fold(IFNULL(m.album, '')) LIKE ? OR fold(IFNULL(m.filename, '')) LIKE ?
      )
      ORDER BY COALESCE(t.played_at, t.created_at) DESC
      LIMIT ?
    `)
    .all(q, q, q, q, q, q, limit) as TrackRow[];
}

export function readdPlayedTrack(trackId: string, sessionId: string): TrackRow {
  const src = getTrackById(trackId);
  if (!src) {
    throw Object.assign(new Error("Track not found"), { statusCode: 404 });
  }
  if (src.status === "removed") {
    throw Object.assign(new Error("Track removed"), { statusCode: 400 });
  }

  const filePath = src.file_path && fs.existsSync(src.file_path) ? src.file_path : null;
  if (src.source === "local" && !filePath) {
    throw Object.assign(new Error("File missing"), { statusCode: 400 });
  }

  return addTrack({
    title: src.title,
    artist: src.artist,
    source: src.source,
    sourceRef: src.source_ref ?? undefined,
    filePath: filePath ?? undefined,
    sessionId,
    durationSec: src.duration_sec,
  });
}

export function getTrackById(id: string): TrackRow | null {
  const row = getDb().prepare("SELECT * FROM tracks WHERE id = ?").get(id);
  return (row as TrackRow) ?? null;
}

export function voteTrack(trackId: string, sessionId: string, direction: 1 | -1, config: AppConfig): TrackRow | null {
  const db = getDb();
  const track = getTrackById(trackId);
  if (!track || (track.status !== "queued" && track.status !== "playing")) return null;

  const existing = db.prepare("SELECT direction FROM votes WHERE track_id = ? AND session_id = ?").get(trackId, sessionId) as { direction: number } | undefined;

  if (existing) {
    if (existing.direction === direction) return track;
    db.prepare("UPDATE votes SET direction = ?, created_at = ? WHERE track_id = ? AND session_id = ?").run(direction, Date.now(), trackId, sessionId);
    const delta = direction * 2;
    db.prepare("UPDATE tracks SET vote_score = vote_score + ? WHERE id = ?").run(delta, trackId);
  } else {
    db.prepare("INSERT INTO votes (track_id, session_id, direction, created_at) VALUES (?, ?, ?, ?)").run(trackId, sessionId, direction, Date.now());
    db.prepare("UPDATE tracks SET vote_score = vote_score + ? WHERE id = ?").run(direction, trackId);
  }

  const updated = getTrackById(trackId)!;

  if (updated.status === "queued" && updated.vote_score <= config.kickThreshold) {
    removeTrack(trackId, "kicked");
    return null;
  }

  return updated;
}

export function removeTrack(trackId: string, reason = "removed"): void {
  getDb().prepare("UPDATE tracks SET status = 'removed' WHERE id = ?").run(trackId);
  getDb().prepare("DELETE FROM votes WHERE track_id = ?").run(trackId);
}

export function removeTracksByArtist(artist: string): number {
  const db = getDb();
  const tracks = db.prepare("SELECT id FROM tracks WHERE artist = ? AND status = 'queued'").all(artist) as { id: string }[];
  for (const t of tracks) {
    removeTrack(t.id, "artist_removed");
  }
  return tracks.length;
}

export function clearQueue(): number {
  const db = getDb();
  const tracks = db.prepare("SELECT id FROM tracks WHERE status = 'queued'").all() as { id: string }[];
  for (const t of tracks) {
    removeTrack(t.id, "queue_cleared");
  }
  return tracks.length;
}

/** Fresh party session: nothing playing, empty queue. History stays for re-add. */
export function resetToEmptySession(): { clearedQueue: number; stoppedPlaying: boolean } {
  const db = getDb();
  const playing = db.prepare("SELECT id FROM tracks WHERE status = 'playing' LIMIT 1").get() as { id: string } | undefined;
  if (playing) {
    db.prepare("UPDATE tracks SET status = 'played', played_at = ? WHERE id = ?").run(Date.now(), playing.id);
  }
  const clearedQueue = clearQueue();
  return { clearedQueue, stoppedPlaying: Boolean(playing) };
}

export function setTrackPlaying(trackId: string): void {
  const db = getDb();
  const now = Date.now();
  db.prepare("UPDATE tracks SET status = 'played', played_at = ? WHERE status = 'playing'").run(now);
  db.prepare("UPDATE tracks SET status = 'playing' WHERE id = ?").run(trackId);
}

export function markCurrentPlayed(): void {
  getDb().prepare("UPDATE tracks SET status = 'played', played_at = ? WHERE status = 'playing'").run(Date.now());
}

export function getNextTrack(): TrackRow | null {
  const row = getDb()
    .prepare(`
      SELECT * FROM tracks
      WHERE status = 'queued' AND download_status = 'ready' AND file_path IS NOT NULL
      ORDER BY vote_score DESC, created_at ASC
      LIMIT 1
    `)
    .get();
  return (row as TrackRow) ?? null;
}

export function setTrackDownload(
  id: string,
  status: DownloadStatus,
  extra?: { filePath?: string | null; error?: string | null; durationSec?: number | null },
): void {
  getDb()
    .prepare("UPDATE tracks SET download_status = ?, file_path = COALESCE(?, file_path), download_error = ?, duration_sec = COALESCE(?, duration_sec) WHERE id = ?")
    .run(status, extra?.filePath ?? null, extra?.error ?? null, extra?.durationSec ?? null, id);
}

export function setTrackDuration(id: string, durationSec: number): void {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return;
  getDb().prepare("UPDATE tracks SET duration_sec = ? WHERE id = ? AND (duration_sec IS NULL OR duration_sec = 0)").run(Math.round(durationSec), id);
}

export function countDownvotes(trackId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) as c FROM votes WHERE track_id = ? AND direction = -1")
    .get(trackId) as { c: number };
  return row.c;
}

export function getDownloadQueue(): TrackRow[] {
  return getDb()
    .prepare(`
      SELECT * FROM tracks
      WHERE status IN ('queued', 'playing')
        AND download_status IN ('pending', 'downloading')
        AND source IN ('youtube', 'spotify')
      ORDER BY
        CASE WHEN status = 'playing' THEN 0 ELSE 1 END,
        vote_score DESC,
        created_at ASC
    `)
    .all() as TrackRow[];
}

export function searchLocalTracks(query: string, limit = 5): TrackRow[] {
  const q = `%${foldSearch(query.trim())}%`;
  if (query.trim().length < 2) return [];
  return getDb()
    .prepare(`
      SELECT t.* FROM tracks t
      LEFT JOIN media_index m ON m.file_path = t.file_path
      WHERE t.status != 'removed' AND (
        fold(t.title) LIKE ? OR fold(t.artist) LIKE ?
        OR fold(IFNULL(m.title, '')) LIKE ? OR fold(IFNULL(m.artist, '')) LIKE ?
        OR fold(IFNULL(m.album, '')) LIKE ? OR fold(IFNULL(m.filename, '')) LIKE ?
      )
      ORDER BY t.created_at DESC
      LIMIT ?
    `)
    .all(q, q, q, q, q, q, limit) as TrackRow[];
}

export function getSessionIp(sessionId: string | null): string | null {
  if (!sessionId) return null;
  const row = getDb().prepare("SELECT ip FROM sessions WHERE id = ?").get(sessionId) as { ip: string } | undefined;
  return row?.ip ?? null;
}

export function getLastPlayedTrack(): TrackRow | null {
  return getPlayedTracks(1)[0] ?? null;
}

export function getPreviousTrack(excludeId?: string | null): TrackRow | null {
  if (excludeId) {
    const row = getDb()
      .prepare(`
        SELECT * FROM tracks
        WHERE status = 'played' AND id != ?
        ORDER BY COALESCE(played_at, created_at) DESC
        LIMIT 1
      `)
      .get(excludeId);
    return (row as TrackRow) ?? null;
  }
  return getLastPlayedTrack();
}

export function requeueCurrentTrack(): TrackRow | null {
  const current = getCurrentTrack();
  if (!current) return null;

  const db = getDb();
  const maxRow = db.prepare("SELECT MAX(vote_score) as m FROM tracks WHERE status = 'queued'").get() as { m: number | null };
  const score = (maxRow.m ?? 0) + 1;
  db.prepare("UPDATE tracks SET status = 'queued', vote_score = ? WHERE id = ?").run(score, current.id);
  return current;
}

export function getSessionColor(sessionId: string | null): string | null {
  if (!sessionId) return null;
  const row = getDb().prepare("SELECT color FROM sessions WHERE id = ?").get(sessionId) as { color: string } | undefined;
  return row?.color ?? null;
}

export function enrichTrack(t: TrackRow) {
  return {
    ...t,
    sessionColor: getSessionColor(t.added_by_session),
    addedByIp: getSessionIp(t.added_by_session),
  };
}

export interface AppState {
  current: (TrackRow & { sessionColor: string | null; addedByIp: string | null }) | null;
  queue: (TrackRow & { sessionColor: string | null; addedByIp: string | null })[];
  history: (TrackRow & { sessionColor: string | null; addedByIp: string | null })[];
  activeUsers: number;
  eventMode: boolean;
}

export function buildState(eventMode: boolean): AppState {
  const current = getCurrentTrack();
  const queue = getQueuedTracks();
  const history = getPlayedTracks(50);

  return {
    current: current ? enrichTrack(current) : null,
    queue: queue.map(enrichTrack),
    history: history.map(enrichTrack),
    activeUsers: getActiveUserCount(),
    eventMode,
  };
}

export function notifyStateChange(eventMode: boolean): AppState {
  const state = buildState(eventMode);
  broadcast("state", state);
  return state;
}

export function banSession(sessionId: string): void {
  getDb().prepare("UPDATE sessions SET banned = 1 WHERE id = ?").run(sessionId);
}

export function banIp(ip: string): void {
  getDb().prepare("UPDATE sessions SET banned = 1 WHERE ip = ?").run(ip);
}

export function unbanSession(sessionId: string): void {
  getDb().prepare("UPDATE sessions SET banned = 0 WHERE id = ?").run(sessionId);
}

export function unbanIp(ip: string): void {
  getDb().prepare("UPDATE sessions SET banned = 0 WHERE ip = ?").run(ip);
}

const MAX_ADMIN_LOG_ENTRIES = 500;

export function logAdminAction(action: string, details?: string): void {
  const db = getDb();
  db.prepare("INSERT INTO admin_log (action, details, created_at) VALUES (?, ?, ?)").run(action, details ?? null, Date.now());

  const { c: total } = db.prepare("SELECT COUNT(*) as c FROM admin_log").get() as { c: number };
  if (total > MAX_ADMIN_LOG_ENTRIES) {
    db.prepare(`
      DELETE FROM admin_log WHERE id IN (
        SELECT id FROM admin_log ORDER BY created_at ASC LIMIT ?
      )
    `).run(total - MAX_ADMIN_LOG_ENTRIES);
  }
}

export function getAdminLog(limit = 50): { action: string; details: string | null; created_at: number }[] {
  return getDb().prepare("SELECT action, details, created_at FROM admin_log ORDER BY created_at DESC LIMIT ?").all(limit) as { action: string; details: string | null; created_at: number }[];
}

export function getUserVote(trackId: string, sessionId: string): 1 | -1 | null {
  const row = getDb().prepare("SELECT direction FROM votes WHERE track_id = ? AND session_id = ?").get(trackId, sessionId) as { direction: number } | undefined;
  if (!row) return null;
  return row.direction as 1 | -1;
}

export function getUserVotes(sessionId: string): Record<string, 1 | -1> {
  const rows = getDb().prepare("SELECT track_id, direction FROM votes WHERE session_id = ?").all(sessionId) as { track_id: string; direction: number }[];
  const result: Record<string, 1 | -1> = {};
  for (const r of rows) {
    result[r.track_id] = r.direction as 1 | -1;
  }
  return result;
}
