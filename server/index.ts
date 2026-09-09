import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import fs from "fs";
import path from "path";
import { loadConfig, ensureDirs, getLanIp, getPublicUrl, PATHS } from "./config.js";
import { getDb } from "./db/index.js";
import { registerTrackRoutes } from "./routes/tracks.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { addClient, removeClient } from "./ws/broadcast.js";
import { buildState, notifyStateChange, setPlayingQuery } from "./services/queue.js";
import { player } from "./services/player.js";
import { kickDownloads, setDownloaderEventMode } from "./services/downloader.js";
import { scanMediaLibrary } from "./services/mediaIndex.js";
import { log } from "./logger.js";
import { tErrorFromAccept } from "./i18n/errors.js";

const config = loadConfig();
ensureDirs();
getDb();
void scanMediaLibrary().catch((err) => log.warn("[media] scan failed:", err));

const app = Fastify({
  logger: false,
  trustProxy: true,
});

await app.register(fastifyCookie);
await app.register(fastifyMultipart, {
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
});
await app.register(fastifyWebsocket);

function setEventMode(enabled: boolean): void {
  config.eventMode = enabled;
  player.setEventMode(enabled);
  setDownloaderEventMode(enabled);
}

await registerTrackRoutes(app, config);
await registerAdminRoutes(app, config, setEventMode);

app.get("/api/info", async () => {
  const lanIp = getLanIp();
  return {
    url: getPublicUrl(config.port),
    port: config.port,
    lanIp,
    https: false,
  };
});

app.register(async (fastify) => {
  fastify.get("/ws", { websocket: true }, (socket) => {
    addClient(socket);
    socket.send(JSON.stringify({ type: "state", payload: buildState(config.eventMode) }));

    socket.on("close", () => removeClient(socket));
  });
});

const clientDist = PATHS.clientDist;
if (fs.existsSync(clientDist)) {
  await app.register(fastifyStatic, {
    root: clientDist,
    prefix: "/",
    wildcard: false,
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api") || request.url.startsWith("/ws")) {
      return reply.status(404).send({ error: tErrorFromAccept(request.headers["accept-language"], "notFound") });
    }
    const indexPath = path.join(clientDist, "index.html");
    if (fs.existsSync(indexPath)) {
      return reply.sendFile("index.html");
    }
    return reply.status(404).send("Not found");
  });
}

try {
  await player.start();
  setPlayingQuery(() => player.isPlaying());
  player.setEventMode(config.eventMode);
  setDownloaderEventMode(config.eventMode);
  player.onTrackEnd(() => notifyStateChange(config.eventMode));
  kickDownloads();
  await player.startPlaybackIfIdle();
} catch (err) {
  log.warn("mpv not available — playback disabled until mpv is installed:", (err as Error).message);
  log.warn("Run: npm run setup");
  kickDownloads();
}

await app.listen({ port: config.port, host: "0.0.0.0" });

const baseUrl = getPublicUrl(config.port);
log.info("");
log.info("  Music Box is running!");
log.info(`  Local:   http://localhost:${config.port}`);
log.info(`  Network: ${baseUrl}`);
log.info(`  Admin:   ${baseUrl}/admin`);
log.info("");

process.on("SIGINT", () => {
  player.shutdown();
  process.exit(0);
});

process.on("SIGTERM", () => {
  player.shutdown();
  process.exit(0);
});
