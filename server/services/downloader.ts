import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { PATHS } from "../config.js";
import { log } from "../logger.js";
import type { TrackRow } from "../db/index.js";
import {
  getDownloadQueue,
  getTrackById,
  setTrackDownload,
  notifyStateChange,
} from "./queue.js";
import { player } from "./player.js";
import { searchYouTube } from "./resolver.js";
import { indexMediaFile } from "./mediaIndex.js";
import { readFileTags } from "./tags.js";

const DOWNLOAD_TIMEOUT_MS = 3 * 60 * 1000;
const MAX_ATTEMPTS = 3;

function getYtdlpPath(): string {
  return fs.existsSync(PATHS.ytdlp) ? PATHS.ytdlp : "yt-dlp";
}

function killProcess(proc: ReturnType<typeof spawn>): void {
  if (!proc.pid) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { windowsHide: true });
    } else {
      proc.kill("SIGKILL");
    }
  } catch {
    try { proc.kill(); } catch { /* ignore */ }
  }
}

function runYtdlp(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(getYtdlpPath(), args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcess(proc);
      reject(new Error(`yt-dlp timeout after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      else reject(new Error(stderr.trim() || `yt-dlp exited with ${code}`));
    });
  });
}

async function resolveDownloadUrl(track: TrackRow): Promise<string> {
  if (track.source === "youtube") {
    if (!track.source_ref) throw new Error("No YouTube URL");
    return track.source_ref;
  }
  if (track.source === "spotify") {
    const yt = await searchYouTube(`${track.artist} ${track.title}`);
    return yt.sourceRef;
  }
  throw new Error(`Cannot download source: ${track.source}`);
}

function safeMediaName(artist: string, title: string): string {
  const raw = `${artist} - ${title}`.trim() || "track";
  let name = raw.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  name = name.replace(/[. ]+$/g, "");
  if (name.length > 80) name = name.slice(0, 80).trim().replace(/[. ]+$/g, "");
  return name || "track";
}

function uniqueMediaStem(stem: string): string {
  const exts = [".m4a", ".webm", ".opus", ".mp3", ".ogg", ".m4b"];
  const taken = (name: string) => exts.some((ext) => fs.existsSync(path.join(PATHS.media, name + ext)));
  if (!taken(stem)) return stem;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem} (${n})`;
    if (!taken(candidate)) return candidate;
  }
  return `${stem} (${Date.now()})`;
}

function findOutputFile(stem: string): string | null {
  const exts = [".m4a", ".webm", ".opus", ".mp3", ".ogg", ".m4b"];
  for (const ext of exts) {
    const p = path.join(PATHS.media, `${stem}${ext}`);
    if (fs.existsSync(p) && fs.statSync(p).size > 0) return p;
  }
  return null;
}

async function downloadOnce(track: TrackRow): Promise<string> {
  const url = await resolveDownloadUrl(track);
  const stem = uniqueMediaStem(safeMediaName(track.artist, track.title));
  const outTemplate = path.join(PATHS.media, `${stem}.%(ext)s`);
  log.info(`[download] ${track.artist} - ${track.title} <- ${url}`);

  await runYtdlp([
    "--no-playlist",
    "-f", "bestaudio/best",
    "--retries", "3",
    "--fragment-retries", "10",
    "--socket-timeout", "30",
    "--force-overwrites",
    "-o", outTemplate,
    url,
  ], DOWNLOAD_TIMEOUT_MS);

  const file = findOutputFile(stem);
  if (!file) throw new Error("yt-dlp finished but output file is missing");
  log.info(`[download] ready: ${file}`);
  return file;
}

let running = false;
let eventMode = false;

export function setDownloaderEventMode(mode: boolean): void {
  eventMode = mode;
}

async function processQueue(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (true) {
      const next = getDownloadQueue()[0];
      if (!next) break;

      const latest = getTrackById(next.id);
      if (!latest || latest.status === "removed") continue;
      if (latest.download_status === "ready" && latest.file_path) continue;

      setTrackDownload(latest.id, "downloading");
      notifyStateChange(eventMode);

      let lastError = "download failed";
      let ok = false;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const filePath = await downloadOnce(latest);
          const tags = await readFileTags(filePath, path.basename(filePath));
          setTrackDownload(latest.id, "ready", { filePath, error: null, durationSec: tags.durationSec });
          void indexMediaFile(filePath, path.basename(filePath));
          notifyStateChange(eventMode);
          await player.startPlaybackIfIdle();
          ok = true;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          log.warn(`[download] attempt ${attempt}/${MAX_ATTEMPTS} failed for ${latest.id}: ${lastError}`);
        }
      }

      if (!ok) {
        log.error(`[download] giving up on ${latest.id}: ${lastError}`);
        setTrackDownload(latest.id, "failed", { error: lastError.slice(0, 400) });
        notifyStateChange(eventMode);
      }
    }
  } finally {
    running = false;
  }
}

export function kickDownloads(): void {
  void processQueue().catch((err) => log.error("[download] worker crashed:", err));
}
