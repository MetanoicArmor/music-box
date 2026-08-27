import { parseFile } from "music-metadata";
import path from "path";
import { log } from "../logger.js";

export interface FileTags {
  title: string;
  artist: string;
  album: string;
  filename: string;
  durationSec: number | null;
}

function firstString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

export async function readFileTags(filePath: string, originalName?: string): Promise<FileTags> {
  const filename = originalName
    ? path.basename(originalName, path.extname(originalName))
    : path.basename(filePath, path.extname(filePath));

  let title = "";
  let artist = "";
  let album = "";
  let durationSec: number | null = null;

  try {
    const meta = await parseFile(filePath, { duration: true, skipCovers: true });
    const common = meta.common;
    title = firstString(common.title);
    artist = firstString(common.artist) || firstString(common.albumartist) || (common.artists ?? []).filter(Boolean).join(", ");
    album = firstString(common.album);
    if (typeof meta.format.duration === "number" && meta.format.duration > 0) {
      durationSec = Math.round(meta.format.duration);
    }
  } catch (err) {
    log.warn("[tags] failed to read", filePath, err instanceof Error ? err.message : err);
  }

  return {
    title: title || filename || "Unknown",
    artist: artist || "Unknown",
    album,
    filename,
    durationSec,
  };
}
