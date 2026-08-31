import { spawn } from "child_process";
import fs from "fs";
import { PATHS } from "../config.js";
import { log } from "../logger.js";
import type { TrackRow } from "../db/index.js";

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

export function runYtdlp(args: string[], timeoutMs = 45000): Promise<string> {
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
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `yt-dlp exited with ${code}`));
    });
  });
}

export interface ResolvedTrack {
  title: string;
  artist: string;
  source: "local" | "youtube" | "spotify";
  sourceRef: string;
  filePath?: string;
  thumbnail?: string | null;
  durationSec?: number | null;
}

export interface SearchSuggestion {
  title: string;
  artist: string;
  source: "local" | "youtube" | "spotify";
  sourceRef: string;
  thumbnail?: string | null;
}

export async function resolveYouTubeUrl(url: string): Promise<ResolvedTrack> {
  const info = await runYtdlp(["--dump-json", "--no-playlist", "--no-download", url]);
  const data = JSON.parse(info);
  return {
    title: data.title ?? "Unknown",
    artist: data.uploader ?? data.channel ?? "Unknown",
    source: "youtube",
    sourceRef: data.webpage_url ?? url,
    thumbnail: data.thumbnail ?? data.thumbnails?.[0]?.url ?? null,
    durationSec: typeof data.duration === "number" && data.duration > 0 ? Math.round(data.duration) : null,
  };
}

export async function searchYouTube(query: string): Promise<ResolvedTrack> {
  const results = await searchYouTubeMany(query, 1);
  if (results.length === 0) throw new Error("YouTube search returned no results");
  return results[0];
}

export async function searchYouTubeMany(query: string, limit = 5): Promise<ResolvedTrack[]> {
  const count = Math.min(Math.max(limit, 1), 8);
  const info = await runYtdlp([
    "--dump-json",
    "--no-playlist",
    "--no-download",
    "--flat-playlist",
    `ytsearch${count}:${query}`,
  ], 40000);

  const results: ResolvedTrack[] = [];
  for (const line of info.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const data = JSON.parse(trimmed);
      const url = data.webpage_url ?? (data.id ? `https://www.youtube.com/watch?v=${data.id}` : data.url);
      if (!url) continue;
      results.push({
        title: data.title ?? query,
        artist: data.uploader ?? data.channel ?? data.uploader_id ?? "Unknown",
        source: "youtube",
        sourceRef: url,
        thumbnail: data.thumbnail ?? data.thumbnails?.[0]?.url ?? null,
        durationSec: typeof data.duration === "number" && data.duration > 0 ? Math.round(data.duration) : null,
      });
    } catch {
      // skip malformed json line
    }
  }
  return results;
}

export async function resolveSpotifyUrl(url: string): Promise<ResolvedTrack> {
  const match = url.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error("Invalid Spotify URL");

  try {
    const resp = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
    if (resp.ok) {
      const data = await resp.json() as { title?: string; thumbnail_url?: string };
      const title = data.title ?? "Unknown Track";
      const parts = title.split(" - ");
      const artist = parts.length > 1 ? parts[0].trim() : "Unknown";
      const trackTitle = parts.length > 1 ? parts.slice(1).join(" - ").trim() : title;
      return {
        title: trackTitle,
        artist,
        source: "spotify",
        sourceRef: url,
        thumbnail: data.thumbnail_url ?? null,
      };
    }
  } catch (err) {
    log.warn("[resolver] Spotify oembed failed:", err);
  }

  throw new Error("Spotify requires internet. Could not resolve track metadata.");
}

export function detectSource(input: string): "youtube" | "spotify" | "search" {
  if (/youtube\.com|youtu\.be/.test(input)) return "youtube";
  if (/spotify\.com/.test(input)) return "spotify";
  return "search";
}

export async function resolveInput(input: string): Promise<ResolvedTrack> {
  const source = detectSource(input);
  switch (source) {
    case "youtube":
      return resolveYouTubeUrl(input);
    case "spotify":
      return resolveSpotifyUrl(input);
    default:
      return searchYouTube(input);
  }
}

export function resolveLocalFile(track: TrackRow): string {
  if (track.file_path && fs.existsSync(track.file_path)) {
    return track.file_path;
  }
  throw new Error("Track file is not ready");
}

export async function isOnline(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    await fetch("https://www.google.com/generate_204", { signal: controller.signal });
    clearTimeout(timeout);
    return true;
  } catch {
    return false;
  }
}
