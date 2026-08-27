import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { v4 as uuidv4 } from "uuid";
import type { AppConfig } from "../config.js";
import { PATHS } from "../config.js";
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
} from "../services/queue.js";
import { resolveInput, isOnline, searchYouTubeMany, detectSource } from "../services/resolver.js";
import { player } from "../services/player.js";
import { kickDownloads } from "../services/downloader.js";
import { readFileTags } from "../services/tags.js";
import { indexMediaFile, listMediaLibrary, searchMediaIndex } from "../services/mediaIndex.js";

const SESSION_COOKIE = "mb_session";

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
    reply.status(403).send({ error: "You are banned" });
    return null;
  }

  const session = getOrCreateSession(getSessionId(request), ip);
  setSessionCookie(reply, session.id);

  if (session.banned) {
    reply.status(403).send({ error: "You are banned" });
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
    return { ...state, userVotes, sessionId };
  });

  app.post("/api/tracks", async (request, reply) => {
    const sessionId = requireSession(request, reply, config);
    if (!sessionId) return;

    if (config.eventMode) {
      return reply.status(403).send({ error: "Adding tracks is disabled in event mode" });
    }

    const body = request.body as {
      input?: string;
      title?: string;
      artist?: string;
      source?: string;
      sourceRef?: string;
      filePath?: string;
    };

    if (body.filePath) {
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
        return reply.status(400).send({ error: "source must be youtube or spotify" });
      }
      const online = await isOnline();
      if (!online) {
        return reply.status(503).send({ error: "Internet required for YouTube/Spotify" });
      }
      const track = addTrack({
        title: body.title,
        artist: body.artist ?? "Unknown",
        source,
        sourceRef: body.sourceRef,
        sessionId,
      });
      notifyStateChange(config.eventMode);
      kickDownloads();
      return track;
    }

    const input = body.input?.trim();
    if (!input) {
      return reply.status(400).send({ error: "input or filePath required" });
    }

    const online = await isOnline();
    const isUrl = /youtube\.com|youtu\.be|spotify\.com/.test(input);

    if ((isUrl || detectSource(input) === "search") && !online) {
      return reply.status(503).send({ error: "Internet required for YouTube/Spotify links" });
    }

    try {
      const resolved = await resolveInput(input);
      const track = addTrack({
        title: resolved.title,
        artist: resolved.artist,
        source: resolved.source,
        sourceRef: resolved.sourceRef,
        sessionId,
      });
      notifyStateChange(config.eventMode);
      kickDownloads();
      return track;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to resolve track";
      return reply.status(400).send({ error: msg });
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
      return reply.status(403).send({ error: "Adding tracks is disabled in event mode" });
    }

    const { id } = request.params as { id: string };
    try {
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
      const message = err instanceof Error ? err.message : "Failed to readd track";
      return reply.status(status).send({ error: message });
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

    if (!checkVoteRateLimit(sessionId, config)) {
      return reply.status(429).send({ error: "Too many votes, slow down" });
    }

    const { id } = request.params as { id: string };
    const body = request.body as { direction?: string };
    const direction = body.direction === "down" ? -1 : 1;

    const before = getTrackById(id);
    const downBefore = before?.status === "playing" ? countDownvotes(id) : 0;
    const result = voteTrack(id, sessionId, direction as 1 | -1, config);
    const downAfter = countDownvotes(id);
    if (before?.status === "playing" && downAfter >= config.playingKickDislikes && downAfter > downBefore) {
      await player.skip();
    }
    notifyStateChange(config.eventMode);
    return { track: result };
  });

  app.post("/api/upload", async (request, reply) => {
    const sessionId = requireSession(request, reply, config);
    if (!sessionId) return;

    if (config.eventMode) {
      return reply.status(403).send({ error: "Uploads disabled in event mode" });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: "No file uploaded" });
    }

    const ext = path.extname(data.filename).toLowerCase();
    if (![".mp3", ".mp4", ".m4a", ".ogg", ".wav", ".flac"].includes(ext)) {
      return reply.status(400).send({ error: "Unsupported file type" });
    }

    const id = uuidv4();
    const filename = `${id}${ext}`;
    const dest = path.join(PATHS.media, filename);
    await pipeline(data.file, fs.createWriteStream(dest));

    const tags = await readFileTags(dest, data.filename);
    await indexMediaFile(dest, data.filename);

    return {
      title: tags.title,
      artist: tags.artist,
      filePath: dest,
    };
  });

  app.get("/api/stream/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const track = getTrackById(id);
    if (!track || track.source !== "local" || !track.file_path) {
      return reply.status(404).send({ error: "Track not found" });
    }

    if (!fs.existsSync(track.file_path)) {
      return reply.status(404).send({ error: "File not found" });
    }

    const ext = path.extname(track.file_path).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".mp3": "audio/mpeg",
      ".mp4": "video/mp4",
      ".m4a": "audio/mp4",
      ".ogg": "audio/ogg",
      ".wav": "audio/wav",
      ".flac": "audio/flac",
    };

    reply.header("Content-Type", mimeTypes[ext] ?? "application/octet-stream");
    return reply.send(fs.createReadStream(track.file_path));
  });
}

export { SESSION_COOKIE, getIp, getSessionId, setSessionCookie, requireSession };
