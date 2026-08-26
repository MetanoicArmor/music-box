import fs from "fs";
import path from "path";
import { PATHS } from "./config.js";

const MAX_BYTES = 5 * 1024 * 1024;

function logPath(): string {
  return path.join(PATHS.data, "music-box.log");
}

function rotatedPath(): string {
  return path.join(PATHS.data, "music-box.log.1");
}

function rotateIfNeeded(): void {
  try {
    if (!fs.existsSync(PATHS.data)) {
      fs.mkdirSync(PATHS.data, { recursive: true });
    }
    const file = logPath();
    if (!fs.existsSync(file)) return;
    const size = fs.statSync(file).size;
    if (size < MAX_BYTES) return;
    const rotated = rotatedPath();
    if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
    fs.renameSync(file, rotated);
  } catch {
    // ignore rotation errors
  }
}

function write(level: string, args: unknown[]): void {
  const ts = new Date().toISOString();
  const msg = args.map((a) => {
    if (a instanceof Error) return a.stack ?? a.message;
    if (typeof a === "string") return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(" ");
  const line = `${ts} [${level}] ${msg}\n`;

  rotateIfNeeded();
  try {
    fs.appendFileSync(logPath(), line, "utf8");
  } catch {
    // ignore disk errors
  }

  const consoleFn = level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;
  consoleFn(...args);
}

export const log = {
  info: (...args: unknown[]) => write("INFO", args),
  warn: (...args: unknown[]) => write("WARN", args),
  error: (...args: unknown[]) => write("ERROR", args),
};
