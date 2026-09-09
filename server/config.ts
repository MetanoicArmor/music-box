import os from "os";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();

export interface AppConfig {
  port: number;
  adminPassword: string;
  kickThreshold: number;
  playingKickDislikes: number;
  voteRateLimit: number;
  voteRateWindowSec: number;
  maxUploadMb: number;
  maxTrackMinutes: number;
  eventMode: boolean;
}

const DEFAULT_CONFIG: AppConfig = {
  port: 3000,
  adminPassword: "changeme",
  kickThreshold: -2,
  playingKickDislikes: 3,
  voteRateLimit: 10,
  voteRateWindowSec: 30,
  maxUploadMb: 100,
  maxTrackMinutes: 10,
  eventMode: false,
};

export function isOverDurationLimit(durationSec: number | null | undefined, maxMinutes: number): boolean {
  if (maxMinutes <= 0) return false;
  if (durationSec == null || durationSec <= 0) return false;
  return durationSec > maxMinutes * 60;
}

export function durationLimitError(durationSec: number | null | undefined, maxMinutes: number): string | null {
  return isOverDurationLimit(durationSec, maxMinutes) ? "trackTooLong" : null;
}

function parseJsonConfig(text: string): Record<string, unknown> {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(stripped) as Record<string, unknown>;
}

function configPath(): string {
  return path.join(ROOT, "config.json");
}

function examplePath(): string {
  return path.join(ROOT, "config.example.json");
}

function fileMtime(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return -1;
  }
}

function readConfigFromDisk(): AppConfig {
  const file = configPath();
  if (fs.existsSync(file)) {
    const raw = parseJsonConfig(fs.readFileSync(file, "utf-8"));
    return { ...DEFAULT_CONFIG, ...raw };
  }
  return { ...DEFAULT_CONFIG };
}

const liveConfig: AppConfig = { ...DEFAULT_CONFIG };
let cachedMtime = -1;

function refreshVoteSettings(force: boolean): void {
  const file = configPath();
  const mtime = fileMtime(file);
  if (!force && mtime === cachedMtime) return;
  const fromDisk = readConfigFromDisk();
  const eventMode = liveConfig.eventMode;
  Object.assign(liveConfig, fromDisk);
  if (!force) liveConfig.eventMode = eventMode;
  cachedMtime = mtime;
}

export function loadConfig(): AppConfig {
  const file = configPath();
  const example = examplePath();

  if (!fs.existsSync(file)) {
    if (fs.existsSync(example)) {
      fs.copyFileSync(example, file);
      console.log("Created config.json from config.example.json");
    }
  }

  refreshVoteSettings(true);
  return liveConfig;
}

/** Live config: re-reads kick/vote fields from config.json when the file changes. */
export function getConfig(): AppConfig {
  refreshVoteSettings(false);
  return liveConfig;
}

export const MPV_IPC_NAME = "music-box-mpv";

export function getMpvIpcServerArg(): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\${MPV_IPC_NAME}`;
  }
  return path.join(ROOT, "data", "mpv.sock");
}

export function getMpvIpcConnectPath(): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\${MPV_IPC_NAME}`;
  }
  return path.join(ROOT, "data", "mpv.sock");
}

export const PATHS = {
  root: ROOT,
  media: path.join(ROOT, "media"),
  data: path.join(ROOT, "data"),
  db: path.join(ROOT, "data", "music-box.db"),
  bin: path.join(ROOT, "bin"),
  mpv: path.join(ROOT, "bin", "mpv.exe"),
  ytdlp: path.join(ROOT, "bin", "yt-dlp.exe"),
  clientDist: path.join(ROOT, "dist", "client"),
  uploadTmp: path.join(ROOT, "data", "upload-tmp"),
};

export function ensureDirs(): void {
  for (const dir of [PATHS.media, PATHS.data, PATHS.bin, PATHS.uploadTmp]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export function getPublicUrl(port: number): string {
  return `http://${getLanIp()}:${port}`;
}

export function getLanIp(): string {
  const nets = os.networkInterfaces();
  const candidates: string[] = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        candidates.push(net.address);
      }
    }
  }

  const preferred =
    candidates.find((a) => a.startsWith("192.168.")) ??
    candidates.find((a) => a.startsWith("10.")) ??
    candidates.find((a) => /^172\.(1[6-9]|2\d|3[01])\./.test(a)) ??
    candidates[0];

  return preferred ?? "127.0.0.1";
}
