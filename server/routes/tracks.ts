import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { v4 as uuidv4 } from "uuid";
import type { AppConfig } from "../config.js";
import { PATHS, isOverDurationLimit, getConfig } from "../config.js";
import {
  addTrack,
  voteTrack,
  buildState,
  notifyStateChange,
  getOrCreateSession,
  isSessionBanned,
  isIpBanned,
  checkVoteRateLimit,
  getUserVotes,
  getTrackById,
  searchLocalTracks,
  searchPlayedTracks,
  readdPlayedTrack,
  enrichTrack,
  countDownvotes,
  getMediaDuration,
  cycleSessionEmoji,
  getSessionEmoji,
} from "../services/queue.js";
import { resolveInput, isOnline, searchYouTubeMany, detectSource, resolveYouTubeUrl } from "../services/resolver.js";
import { player } from "../services/player.js";
import { kickDownloads } from "../services/downloader.js";
import { readFileTags } from "../services/tags.js";
import { indexMediaFile, listMediaLibrary, searchMediaIndex } from "../services/mediaIndex.js";
import { isAudioExt, uniqueMediaPath, moveUploadFile, safeMediaName } from "../services/mediaNames.js";
import { AVATAR_TAKEN } from "../services/sessionEmoji.js";
import { tErrorFromAccept, isErrorKey, type ErrorKey } from "../i18n/errors.js";

const SESSION_COOKIE = "mb_session";

function e(request: FastifyRequest, key: ErrorKey, vars?: Record<string, string | number>): string {
  return tErrorFromAccept(request.headers["accept-language"], key, vars);
}

function limitErr(request: FastifyRequest, durationSec: number | null | undefined, maxMinutes: number): string | null {
  if (!isOverDurationLimit(durationSec, maxMinutes)) return null;
  return e(request, "trackTooLong", { minutes: maxMinutes });
}

function localizeThrown(request: FastifyRequest, err: unknown, fallback: ErrorKey): string {
  const message = err instanceof Error ? err.message : fallback;
  if (!isErrorKey(message)) return e(request, fallback);
  if (message === "trackTooLong") return e(request, message, { minutes: getConfig().maxTrackMinutes });
  return e(request, message);
}

function getIp(request: FastifyRequest): string {
  const raw = (request.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? request.ip;
  return normalizeClientIp(raw);
}

export function normalizeClientIp(ip: string): string {
  if (!ip) return "unknown";
  if (ip === "::1" || ip === "0:0:0:0:0:0:0:1") return "127.0.0.1";
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  return ip;
}

function getSessionId(request: FastifyRequest): string | undefined {
  return request.cookies[SESSION_COOKIE];
}

function setSessionCookie(reply: FastifyReply, sessionId: string): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    path: "/",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
  });
}

function requireSession(request: FastifyRequest, reply: FastifyReply, config: AppConfig): string | null {
  const ip = getIp(request);
  if (isIpBanned(ip)) {
    reply.status(403).send({ error: e(request, "banned") });
    return null;
  }

  const session = getOrCreateSession(getSessionId(request), ip);
  setSessionCookie(reply, session.id);

  if (session.banned) {
    reply.status(403).send({ error: e(request, "banned") });
    return null;
  }

  return session.id;
}

export async function registerTrackRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  app.get("/api/state", async (request, reply) => {
    const sessionId = requireSession(request, reply, config);
    if (!sessionId) return;

    const state = buildState(config.eventMode);
    const userVotes = getUserVotes(sessionId);
    return { ...state, userVotes, sessionId, myEmoji: getSessionEmoji(sessionId) ?? "" };
  });

  app.post("/api/session/avatar", async (request, reply) => {
    const sessionId = requireSession(request, reply, config);
    if (!sessionId) return;
    try {
      const emoji = cycleSessionEmoji(sessionId);
      notifyStateChange(config.eventMode);
      return { emoji };
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 400;
      return reply.status(status).send({ error: localizeThrown(request, err, AVATAR_TAKEN) });
    }
  });

  app.post("/api/tracks", async (request, reply) => {
    const sessionId = requireSession(request, reply, config);
    if (!sessionId) return;

    if (config.eventMode) {
      return reply.status(403).send({ error: e(request, "eventMode") });
    }

    const body = request.body as {
      input?: string;
      title?: string;
      artist?: string;
      source?: string;
      sourceRef?: string;
      filePath?: string;
      duration_sec?: number | null;
    };

    if (body.filePath) {
      const tooLong = limitErr(request, getMediaDuration(body.filePath), config.maxTrackMinutes);
      if (tooLong) return reply.status(400).send({ error: tooLong });
      const track = addTrack({
        title: body.title ?? path.basename(body.filePath),
        artist: body.artist ?? "Unknown",
        source: "local",
        filePath: body.filePath,
        sessionId,
      });
      notifyStateChange(config.eventMode);
      await player.startPlaybackIfIdle();
      return track;
    }

    if (body.source && body.sourceRef && body.title) {
      if (body.source === "local" && fs.existsSync(body.sourceRef)) {
        const tooLong = limitErr(request, getMediaDuration(body.sourceRef), config.maxTrackMinutes);
        if (tooLong) return reply.status(400).send({ error: tooLong });
        const track = addTrack({
          title: body.title,
          artist: body.artist ?? "Unknown",
          source: "local",
          filePath: body.sourceRef,
          sessionId,
        });
        notifyStateChange(config.eventMode);
        await player.startPlaybackIfIdle();
        return track;
      }
      const source = body.source as "youtube" | "spotify" | "local";
      if (source !== "youtube" && source !== "spotify") {
        return reply.status(400).send({ error: e(request, "invalidSource") });
      }
      const online = await isOnline();
      if (!online) {
        return reply.status(503).send({ error: e(request, "needInternet") });
      }
      let durationSec = typeof body.duration_sec === "number" ? body.duration_sec : null;
      if (source === "youtube" && (durationSec == null || durationSec <= 0)) {
        try {
          durationSec = (await resolveYouTubeUrl(body.sourceRef)).durationSec ?? null;
        } catch {
          durationSec = null;
        }
      }
      const tooLong = limitErr(request, durationSec, config.maxTrackMinutes);
      if (tooLong) return reply.status(400).send({ error: tooLong });
      const track = addTrack({
        title: body.title,
        artist: body.artist ?? "Unknown",
        source,
        sourceRef: body.sourceRef,
        sessionId,
        durationSec,
      });
      notifyStateChange(config.eventMode);
      kickDownloads();
      return track;
    }

    const input = body.input?.trim();
    if (!input) {
      return reply.status(400).send({ error: e(request, "inputRequired") });
    }

    const online = await isOnline();
    const isUrl = /youtube\.com|youtu\.be|spotify\.com/.test(input);

    if ((isUrl || detectSource(input) === "search") && !online) {
      return reply.status(503).send({ error: e(request, "needInternetLinks") });
    }

    try {
      const resolved = await resolveInput(input);
      const tooLong = limitErr(request, resolved.durationSec, config.maxTrackMinutes);
      if (tooLong) return reply.status(400).send({ error: tooLong });
      const track = addTrack({
        title: resolved.title,
        artist: resolved.artist,
        source: resolved.source,
        sourceRef: resolved.sourceRef,
        sessionId,
        durationSec: resolved.durationSec,
      });
      notifyStateChange(config.eventMode);
      kickDownloads();
      return track;
    } catch (err) {
      return reply.status(400).send({ error: e(request, "resolveFailed") });
    }
  });

  app.get("/api/history/search", async (request, reply) => {
    const sessionId = requireSession(request, reply, config);
    if (!sessionId) return;

    const q = String((request.query as { q?: string }).q ?? "").trim();
    const tracks = searchPlayedTracks(q, 40).map(enrichTrack);
    return { tracks };
  });

  app.post("/api/tracks/:id/readd", async (request, reply) => {
    const sessionId = requireSession(request, reply, config);
    if (!sessionId) return;

    if (config.eventMode) {
      return reply.status(403).send({ error: e(request, "eventMode") });
    }

    const { id } = request.params as { id: string };
    try {
      const existing = getTrackById(id);
      const tooLong = limitErr(request, existing?.duration_sec, config.maxTrackMinutes);
      if (tooLong) return reply.status(400).send({ error: tooLong });
      const track = readdPlayedTrack(id, sessionId);
      notifyStateChange(config.eventMode);
      if (track.download_status === "pending") {
        kickDownloads();
      } else {
        await player.startPlaybackIfIdle();
      }
      return track;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 400;
      return reply.status(status).send({ error: localizeThrown(request, err, "error") });
    }
  });

  app.get("/api/library", async (request, reply) => {
    const sessionId = requireSession(request, reply, config);
    if (!sessionId) return;

    const q = String((request.query as { q?: string }).q ?? "").trim();
    const tracks = listMediaLibrary(q, 200).map((row) => ({
      title: row.title,
      artist: row.artist,
      album: row.album,
      source: "local" as const,
      sourceRef: row.file_path,
      filename: row.filename,
      duration_sec: row.duration_sec,
    }));
    return { tracks, total: tracks.length };
  });

  app.get("/api/search", async (request, reply) => {
    const sessionId = requireSession(request, reply, config);
    if (!sessionId) return;

    const q = String((request.query as { q?: string }).q ?? "").trim();
    if (q.length < 2) {
      return { local: [], youtube: [] };
    }

    const localFromTracks = searchLocalTracks(q, 8)
      .filter((t) => (t.source === "local" ? !!t.file_path : !!t.source_ref))
      .map((t) => ({
        title: t.title,
        artist: t.artist,
        source: t.source,
        sourceRef: (t.source === "local" ? t.file_path : t.source_ref) as string,
        thumbnail: null as string | null,
        duration_sec: t.duration_sec,
      }));

    const localFromFiles = searchMediaIndex(q, 8).map((row) => ({
      title: row.title,
      artist: row.album ? `${row.artist} · ${row.album}` : row.artist,
      source: "local" as const,
      sourceRef: row.file_path,
      thumbnail: null as string | null,
      duration_sec: row.duration_sec,
    }));

    const seen = new Set<string>();
    const local = [...localFromTracks, ...localFromFiles].filter((item) => {
      const key = `${item.source}:${item.sourceRef.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 6);

    let youtube: { title: string; artist: string; source: string; sourceRef: string; thumbnail: string | null }[] = [];
    if (await isOnline()) {
      try {
        youtube = (await searchYouTubeMany(q, 5)).map((t) => ({
          title: t.title,
          artist: t.artist,
          source: t.source,
          sourceRef: t.sourceRef,
          thumbnail: t.thumbnail ?? null,
          duration_sec: t.durationSec ?? null,
        }));
      } catch {
        youtube = [];
      }
    }

    return { local, youtube };
  });

  app.post("/api/tracks/:id/vote", async (request, reply) => {
    const sessionId = requireSession(request, reply, config);
    if (!sessionId) return;

    if (!checkVoteRateLimit(sessionId, getConfig())) {
      return reply.status(429).send({ error: e(request, "tooManyVotes") });
    }

    const { id } = request.params as { id: string };
    const body = request.body as { direction?: string };
    const direction = body.direction === "down" ? -1 : 1;

    const before = getTrackById(id);
    const downBefore = before?.status === "playing" ? countDownvotes(id) : 0;
    const live = getConfig();
    const result = voteTrack(id, sessionId, direction as 1 | -1, live);
    const downAfter = countDownvotes(id);
    if (before?.status === "playing" && downAfter >= live.playingKickDislikes && downAfter > downBefore) {
      await player.skip();
    }
    notifyStateChange(live.eventMode);
    return { track: result };
  });

  app.post("/api/upload", async (request, reply) => {
    const sessionId = requireSession(request, reply, config);
    if (!sessionId) return;

    if (config.eventMode) {
      return reply.status(403).send({ error: e(request, "eventModeUploads") });
    }

    let data;
    try {
      data = await request.file();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "FST_REQ_FILE_TOO_LARGE") {
        return reply.status(400).send({ error: e(request, "fileTooLarge") });
      }
      throw err;
    }
    if (!data) {
      return reply.status(400).send({ error: e(request, "noFile") });
    }

    const ext = path.extname(data.filename).toLowerCase();
    if (!isAudioExt(ext)) {
      return reply.status(400).send({ error: e(request, "unsupportedType") });
    }

    const tmp = path.join(PATHS.uploadTmp, `.upload-${uuidv4()}${ext}`);
    try {
      await pipeline(data.file, fs.createWriteStream(tmp));
      if (data.file.truncated) {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        return reply.status(400).send({ error: e(request, "fileTooLarge") });
      }
      if (!fs.existsSync(tmp) || fs.statSync(tmp).size === 0) {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        return reply.status(400).send({ error: e(request, "emptyUpload") });
      }
      const tags = await readFileTags(tmp, data.filename);
      const tooLong = limitErr(request, tags.durationSec, config.maxTrackMinutes);
      if (tooLong) {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        return reply.status(400).send({ error: tooLong });
      }
      const dest = uniqueMediaPath(tags.artist, tags.title, ext);
      await moveUploadFile(tmp, dest);
      await indexMediaFile(dest);

      return {
        title: tags.title,
        artist: tags.artist,
        filePath: dest,
      };
    } catch (err) {
      if (fs.existsSync(tmp)) {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      }
      throw err;
    }
  });

  app.get("/api/stream/:id", async (request, reply) => {
    const sessionId = requireSession(request, reply, config);
    if (!sessionId) return;

    const { id } = request.params as { id: string };
    const track = getTrackById(id);
    if (!isStreamableTrack(track) || !track.file_path) {
      return reply.status(404).send({ error: e(request, "trackNotFound") });
    }
    if (!fs.existsSync(track.file_path)) {
      return reply.status(404).send({ error: e(request, "fileNotFound") });
    }

    const filePath = track.file_path;
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const download = (request.query as { download?: string }).download === "1";
    const filename = `${safeMediaName(track.artist, track.title)}${ext || ".bin"}`;

    reply.header("Accept-Ranges", "bytes");
    reply.header("Content-Type", STREAM_MIME[ext] ?? "application/octet-stream");
    if (download) {
      reply.header("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
    }

    const rangeHeader = request.headers.range;
    if (rangeHeader) {
      const range = parseBytesRange(rangeHeader, stat.size);
      if (!range) {
        reply.header("Content-Range", `bytes */${stat.size}`);
        return reply.status(416).send({ error: e(request, "invalidRange") });
      }
      reply.status(206);
      reply.header("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
      reply.header("Content-Length", String(range.end - range.start + 1));
      return reply.send(fs.createReadStream(filePath, { start: range.start, end: range.end }));
    }

    reply.header("Content-Length", String(stat.size));
    return reply.send(fs.createReadStream(filePath));
  });
}

const STREAM_STATUSES = new Set(["queued", "playing", "played"]);

function isStreamableTrack(track: { status: string; download_status: string; file_path: string | null } | null): track is { status: string; download_status: string; file_path: string } {
  if (!track) return false;
  return STREAM_STATUSES.has(track.status) && track.download_status === "ready" && !!track.file_path;
}

const STREAM_MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".webm": "audio/webm",
  ".opus": "audio/ogg",
};

function parseBytesRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim().split(",")[0] ?? "");
  if (!match) return null;
  const [, startRaw, endRaw] = match;
  let start: number;
  let end: number;
  if (startRaw === "") {
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === "" ? size - 1 : Number(endRaw);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}

export { SESSION_COOKIE, getIp, getSessionId, setSessionCookie, requireSession };
