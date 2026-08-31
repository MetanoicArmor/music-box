import fs from "fs";
import path from "path";
import { PATHS } from "../config.js";

export const AUDIO_EXT = new Set([
  ".mp3", ".mp4", ".m4a", ".aac", ".ogg", ".oga", ".wav", ".flac",
  ".webm", ".opus", ".m4b", ".wma", ".aiff", ".aif", ".ape", ".wv", ".mpga",
]);

export function isAudioExt(ext: string): boolean {
  return AUDIO_EXT.has(ext.toLowerCase());
}

export function safeMediaName(artist: string, title: string): string {
  const raw = `${artist} - ${title}`.trim() || "track";
  let name = raw.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  name = name.replace(/[. ]+$/g, "");
  if (name.length > 80) name = name.slice(0, 80).trim().replace(/[. ]+$/g, "");
  return name || "track";
}

function stemTaken(stem: string): boolean {
  for (const ext of AUDIO_EXT) {
    if (fs.existsSync(path.join(PATHS.media, stem + ext))) return true;
  }
  return false;
}

export function uniqueMediaStem(stem: string): string {
  if (!stemTaken(stem)) return stem;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem} (${n})`;
    if (!stemTaken(candidate)) return candidate;
  }
  return `${stem} (${Date.now()})`;
}

export function uniqueMediaPath(artist: string, title: string, ext: string): string {
  const stem = uniqueMediaStem(safeMediaName(artist, title));
  const suffix = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return path.join(PATHS.media, `${stem}${suffix}`);
}

export function moveOrCopy(from: string, to: string): void {
  if (path.resolve(from) === path.resolve(to)) return;
  try {
    fs.renameSync(from, to);
    if (fs.existsSync(to)) return;
  } catch {
    // EBUSY / EXDEV — copy then unlink
  }
  fs.copyFileSync(from, to);
  try { fs.unlinkSync(from); } catch { /* ignore */ }
  if (!fs.existsSync(to) || fs.statSync(to).size === 0) {
    throw new Error(`Failed to move upload to ${to}`);
  }
}

export async function moveUploadFile(from: string, to: string): Promise<void> {
  const delays = [0, 40, 80, 160, 320];
  let lastErr: unknown;
  for (const ms of delays) {
    if (ms) await new Promise((r) => setTimeout(r, ms));
    try {
      moveOrCopy(from, to);
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Failed to move upload");
}

export function findOutputFile(stem: string): string | null {
  for (const ext of AUDIO_EXT) {
    const p = path.join(PATHS.media, `${stem}${ext}`);
    if (fs.existsSync(p) && fs.statSync(p).size > 0) return p;
  }
  return null;
}
