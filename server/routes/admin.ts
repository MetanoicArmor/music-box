import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { AppConfig } from "../config.js";
import {
  removeTrack,
  removeTracksByArtist,
  clearQueue,
  clearHistory,
  banSession,
  banIp,
  unbanSession,
  unbanIp,
  logAdminAction,
  getAdminLog,
  notifyStateChange,
  getTrackById,
  getCurrentTrack,
} from "../services/queue.js";
import { player } from "../services/player.js";
import { requireSession, normalizeClientIp } from "./tracks.js";
import { tErrorFromAccept, type ErrorKey } from "../i18n/errors.js";

const ADMIN_COOKIE = "mb_admin";

function e(request: FastifyRequest, key: ErrorKey, vars?: Record<string, string | number>): string {
  return tErrorFromAccept(request.headers["accept-language"], key, vars);
}

function isAdmin(request: { cookies: Record<string, string | undefined> }): boolean {
  return request.cookies[ADMIN_COOKIE] === "1";
}

function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!isAdmin(request)) {
    reply.status(401).send({ error: e(request, "adminRequired") });
    return false;
  }
  return true;
}

export async function registerAdminRoutes(app: FastifyInstance, config: AppConfig, setEventMode: (v: boolean) => void): Promise<void> {
  app.post("/api/admin/login", async (request, reply) => {
    requireSession(request, reply, config);
    const body = request.body as { password?: string };
    if (body.password === config.adminPassword) {
      reply.setCookie(ADMIN_COOKIE, "1", {
        path: "/",
        httpOnly: true,
        maxAge: 60 * 60 * 24,
        sameSite: "lax",
      });
      logAdminAction("login");
      return { ok: true };
    }
    return reply.status(401).send({ error: e(request, "wrongPassword") });
  });

  app.post("/api/admin/logout", async (request, reply) => {
    reply.clearCookie(ADMIN_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/admin/check", async (request) => {
    return { isAdmin: isAdmin(request) };
  });

  app.delete("/api/admin/tracks/:id", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const track = getTrackById(id);
    if (!track) return reply.status(404).send({ error: e(request, "trackNotFound") });

    removeTrack(id, "admin_removed");
    logAdminAction("remove_track", `${track.artist} - ${track.title}`);

    if (track.status === "playing") {
      await player.skip();
    }
    notifyStateChange(config.eventMode);
    return { ok: true };
  });

  app.delete("/api/admin/artists/:name", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { name } = request.params as { name: string };
    const artist = decodeURIComponent(name);
    const count = removeTracksByArtist(artist);
    logAdminAction("remove_artist", artist);
    notifyStateChange(config.eventMode);
    return { removed: count };
  });

  app.post("/api/admin/ban", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const body = request.body as { sessionId?: string; ip?: string };
    if (body.sessionId) {
      banSession(body.sessionId);
      logAdminAction("ban_session", body.sessionId);
    } else if (body.ip) {
      banIp(normalizeClientIp(body.ip.trim()));
      logAdminAction("ban_ip", body.ip);
    } else {
      return reply.status(400).send({ error: e(request, "sessionOrIp") });
    }
    return { ok: true };
  });

  app.post("/api/admin/unban", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const body = request.body as { sessionId?: string; ip?: string };
    if (body.sessionId) {
      unbanSession(body.sessionId);
      logAdminAction("unban_session", body.sessionId);
    } else if (body.ip) {
      unbanIp(normalizeClientIp(body.ip.trim()));
      logAdminAction("unban_ip", body.ip);
    } else {
      return reply.status(400).send({ error: e(request, "sessionOrIp") });
    }
    return { ok: true };
  });

  app.post("/api/admin/skip", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    await player.skip();
    logAdminAction("skip");
    notifyStateChange(config.eventMode);
    return { ok: true };
  });

  app.post("/api/admin/previous", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      const ok = await player.previous();
      if (!ok) {
        return reply.status(404).send({ error: e(request, "noPrevious") });
      }
      logAdminAction("previous");
      notifyStateChange(config.eventMode);
      return { ok: true };
    } catch (err) {
      return reply.status(503).send({ error: e(request, "previousFailed") });
    }
  });

  app.post("/api/admin/stop", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    await player.stopPlayback();
    logAdminAction("stop");
    notifyStateChange(config.eventMode);
    return { ok: true };
  });

  app.post("/api/admin/pause", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    if (!player.pause()) {
      return reply.status(503).send({ error: e(request, "playerNotReady") });
    }
    logAdminAction("pause");
    return { ok: true };
  });

  app.post("/api/admin/resume", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    if (!player.resume()) {
      return reply.status(503).send({ error: e(request, "playerNotReady") });
    }
    logAdminAction("resume");
    return { ok: true };
  });

  app.post("/api/admin/seek", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const body = request.body as { seconds?: number; absolute?: number };
    if (typeof body.absolute === "number") {
      player.seekTo(body.absolute);
      logAdminAction("seek", `absolute ${body.absolute}s`);
    } else if (typeof body.seconds === "number") {
      player.seekRelative(body.seconds);
      logAdminAction("seek", `relative ${body.seconds}s`);
    } else {
      return reply.status(400).send({ error: e(request, "seekRequired") });
    }
    return { ok: true };
  });

  app.get("/api/admin/playback", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const status = await player.getPlaybackStatus();
    return { status, current: getCurrentTrack() };
  });

  app.post("/api/admin/clear-queue", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const count = clearQueue();
    logAdminAction("clear_queue", `${count} tracks`);
    notifyStateChange(config.eventMode);
    return { removed: count };
  });

  app.post("/api/admin/clear-history", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const count = clearHistory();
    logAdminAction("clear_history", `${count} tracks`);
    notifyStateChange(config.eventMode);
    return { removed: count };
  });

  app.post("/api/admin/event-mode", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const body = request.body as { enabled?: boolean };
    const enabled = body.enabled ?? !config.eventMode;
    config.eventMode = enabled;
    setEventMode(enabled);
    player.setEventMode(enabled);
    logAdminAction("event_mode", enabled ? "enabled" : "disabled");
    notifyStateChange(config.eventMode);
    return { eventMode: enabled };
  });

  app.get("/api/admin/log", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    return getAdminLog();
  });
}
