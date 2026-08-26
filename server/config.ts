import os from "os";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();

export interface AppConfig {
  port: number;
  adminPassword: string;
  kickThreshold: number;
  voteRateLimit: number;
  voteRateWindowSec: number;
  maxUploadMb: number;
  eventMode: boolean;
}

const DEFAULT_CONFIG: AppConfig = {
  port: 3000,
  adminPassword: "changeme",
  kickThreshold: -2,
  voteRateLimit: 10,
  voteRateWindowSec: 30,
  maxUploadMb: 100,
  eventMode: false,
};

export function loadConfig(): AppConfig {
  const configPath = path.join(ROOT, "config.json");
  const examplePath = path.join(ROOT, "config.example.json");

  if (!fs.existsSync(configPath)) {
    if (fs.existsSync(examplePath)) {
      fs.copyFileSync(examplePath, configPath);
      console.log("Created config.json from config.example.json");
    }
  }

  if (fs.existsSync(configPath)) {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return { ...DEFAULT_CONFIG, ...raw };
  }

  return DEFAULT_CONFIG;
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
};

export function ensureDirs(): void {
  for (const dir of [PATHS.media, PATHS.data, PATHS.bin]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
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
