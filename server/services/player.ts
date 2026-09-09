import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import net from "net";
import path from "path";
import { getMpvIpcServerArg, getMpvIpcConnectPath } from "../config.js";
import {
  getNextTrack,
  getPreviousTrack,
  requeueCurrentTrack,
  setTrackPlaying,
  markCurrentPlayed,
  getCurrentTrack,
  notifyStateChange,
  setTrackDownload,
  setTrackDuration,
} from "./queue.js";
import type { TrackRow } from "../db/index.js";
import { resolveLocalFile } from "./resolver.js";
import { log } from "../logger.js";

type StateChangeCallback = () => void;

export interface PlaybackStatus {
  time: number;
  duration: number;
  paused: boolean;
  playing: boolean;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

function resolveMpvPath(): string {
  const binMpv = path.join(process.cwd(), "bin", "mpv.exe");
  if (fs.existsSync(binMpv)) return binMpv;

  const candidates = [
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "MPV Player", "mpv.exe"),
    path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "MPV Player", "mpv.exe"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return "mpv";
}

export class MpvPlayer {
  private process: ChildProcess | null = null;
  private socket: net.Socket | null = null;
  private buffer = "";
  private onEndCallback: StateChangeCallback | null = null;
  private eventMode = false;
  private playing = false;
  private paused = false;
  private ipcReady = false;
  private blockAutoAdvance = false;
  private fileLoadedWaiters: Array<() => void> = [];
  private navigationLock: Promise<void> = Promise.resolve();
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();

  setEventMode(mode: boolean): void {
    this.eventMode = mode;
  }

  onTrackEnd(cb: StateChangeCallback): void {
    this.onEndCallback = cb;
  }

  isReady(): boolean {
    return this.ipcReady && this.process !== null;
  }

  isPlaying(): boolean {
    return this.playing && !this.paused;
  }

  async start(): Promise<void> {
    if (this.process) return;

    const mpvPath = resolveMpvPath();
    const ipcArg = getMpvIpcServerArg();

    const mpvArgs = [
      "--no-video",
      "--idle=yes",
      "--keep-open=no",
      `--input-ipc-server=${ipcArg}`,
      "--volume=100",
    ];

    if (process.platform === "win32") {
      mpvArgs.push("--ao=wasapi");
    }

    log.info(`Starting mpv: ${mpvPath}`);
    log.info(`IPC: ${ipcArg}`);

    return new Promise((resolve, reject) => {
      this.process = spawn(mpvPath, mpvArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      this.process.on("error", (err) => {
        this.process = null;
        this.ipcReady = false;
        reject(err);
      });

      this.process.stderr?.on("data", (d: Buffer) => {
        const msg = d.toString().trim();
        if (msg && !msg.includes("AV:")) {
          log.info("[mpv]", msg);
        }
      });

      this.process.stdout?.on("data", (d: Buffer) => {
        const msg = d.toString().trim();
        if (msg) log.info("[mpv out]", msg);
      });

      this.process.on("exit", (code) => {
        log.info(`mpv exited with code ${code}`);
        this.process = null;
        this.socket = null;
        this.ipcReady = false;
      });

      this.connectIpc(15000)
        .then(() => {
          log.info("mpv player ready");
          resolve();
        })
        .catch(reject);
    });
  }

  private connectIpc(timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const connectPath = getMpvIpcConnectPath();
      const start = Date.now();

      const attempt = () => {
        if (!this.process) {
          reject(new Error("mpv process died before IPC connected"));
          return;
        }

        const socket = net.createConnection(connectPath);
        socket.setEncoding("utf8");

        socket.once("connect", () => {
          this.attachSocket(socket);
          resolve();
        });

        socket.once("error", () => {
          socket.destroy();
          if (Date.now() - start > timeout) {
            reject(new Error(`mpv IPC not ready at ${connectPath}`));
          } else {
            setTimeout(attempt, 300);
          }
        });
      };

      attempt();
    });
  }

  private attachSocket(socket: net.Socket): void {
    this.socket = socket;
    this.ipcReady = true;
    socket.setEncoding("utf8");
    socket.on("data", (data: string | Buffer) => {
      this.handleIpcData(typeof data === "string" ? data : data.toString());
    });
    socket.on("error", (err) => {
      log.error("[mpv ipc]", err.message);
      this.ipcReady = false;
    });
    socket.on("close", () => {
      this.ipcReady = false;
      this.socket = null;
      if (this.process) {
        setTimeout(() => this.reconnectIpc(), 500);
      }
    });
    this.sendCommand(["enable_event", "end-file", true]);
    this.sendCommand(["enable_event", "file-loaded", true]);
  }

  private reconnectIpc(): void {
    if (!this.process || this.socket) return;
    const socket = net.createConnection(getMpvIpcConnectPath());
    socket.once("connect", () => this.attachSocket(socket));
    socket.once("error", () => {
      socket.destroy();
      setTimeout(() => this.reconnectIpc(), 1000);
    });
  }

  private handleIpcData(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.request_id != null && this.pendingRequests.has(msg.request_id)) {
          const pending = this.pendingRequests.get(msg.request_id)!;
          this.pendingRequests.delete(msg.request_id);
          clearTimeout(pending.timer);
          if (msg.error && msg.error !== "success") {
            pending.reject(new Error(String(msg.error)));
          } else {
            pending.resolve(msg.data);
          }
          continue;
        }
        if (msg.event === "file-loaded") {
          this.resolveFileLoaded();
          continue;
        }
        if (msg.event === "end-file") {
          const reason = String(msg.reason ?? "");
          if (reason !== "eof") {
            continue;
          }
          if (this.blockAutoAdvance) {
            continue;
          }
          this.playing = false;
          markCurrentPlayed();
          this.onEndCallback?.();
          void this.runExclusive(() => this.playNext());
        }
      } catch {
        // ignore non-json lines
      }
    }
  }

  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.navigationLock.then(fn, fn);
    this.navigationLock = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private resolveFileLoaded(): void {
    const waiters = this.fileLoadedWaiters;
    this.fileLoadedWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private waitForFileLoaded(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.fileLoadedWaiters = this.fileLoadedWaiters.filter((w) => w !== onLoaded);
        resolve();
      }, timeoutMs);
      const onLoaded = () => {
        clearTimeout(timer);
        resolve();
      };
      this.fileLoadedWaiters.push(onLoaded);
    });
  }

  private async withManualNavigation(fn: () => Promise<void>, waitForLoad = true): Promise<void> {
    this.blockAutoAdvance = true;
    const loaded = waitForLoad ? this.waitForFileLoaded(800) : Promise.resolve();
    try {
      await fn();
    } finally {
      try {
        await loaded;
        await new Promise((r) => setTimeout(r, 150));
      } finally {
        this.blockAutoAdvance = false;
      }
    }
  }

  private sendCommand(args: (string | number | boolean)[], requestId?: number): boolean {
    if (!this.socket?.writable || !this.ipcReady) {
      log.warn("[mpv] IPC not connected, command skipped:", args[0]);
      return false;
    }
    const payload: { command: (string | number | boolean)[]; request_id?: number } = { command: args };
    if (requestId != null) payload.request_id = requestId;
    try {
      this.socket.write(JSON.stringify(payload) + "\n");
      return true;
    } catch (err) {
      log.error("[mpv] IPC write failed:", (err as Error).message);
      return false;
    }
  }

  private queryProperty(property: string): Promise<unknown> {
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`mpv query timeout: ${property}`));
      }, 2000);
      this.pendingRequests.set(requestId, { resolve, reject, timer });
      if (!this.sendCommand(["get_property", property], requestId)) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(new Error("mpv IPC not connected"));
      }
    });
  }

  async getPlaybackStatus(): Promise<PlaybackStatus | null> {
    if (!this.isReady() || !getCurrentTrack()) return null;
    try {
      const [time, duration, paused] = await Promise.all([
        this.queryProperty("time-pos"),
        this.queryProperty("duration"),
        this.queryProperty("pause"),
      ]);
      return {
        time: typeof time === "number" ? time : 0,
        duration: typeof duration === "number" ? duration : 0,
        paused: paused === true,
        playing: this.playing,
      };
    } catch {
      return null;
    }
  }

  private isPlayable(track: TrackRow): boolean {
    return track.download_status === "ready" && !!track.file_path && fs.existsSync(track.file_path);
  }

  async playTrack(track: TrackRow): Promise<boolean> {
    if (!this.isReady()) {
      log.error("[mpv] Cannot play — player not ready");
      return false;
    }

    if (!this.isPlayable(track)) {
      log.warn(`[mpv] Skip unready track: ${track.artist} - ${track.title}`);
      if (track.download_status === "ready") {
        setTrackDownload(track.id, "failed", { error: "fileMissing" });
      }
      return false;
    }

    let playable: string;
    try {
      playable = resolveLocalFile(track);
    } catch (err) {
      log.error("[mpv] Failed to resolve track:", err);
      setTrackDownload(track.id, "failed", { error: "downloadFailed" });
      throw err;
    }

    const target = path.resolve(playable);
    log.info(`[mpv] Playing: ${track.artist} - ${track.title}`);
    log.info(`[mpv] Source: ${target}`);

    const sent = this.sendCommand(["loadfile", target, "replace"]);
    if (!sent) return false;

    setTrackPlaying(track.id);
    this.playing = true;
    this.paused = false;
    void this.captureDuration(track.id);
    notifyStateChange(this.eventMode);
    return true;
  }

  private async captureDuration(trackId: string): Promise<void> {
    const existing = getCurrentTrack();
    if (existing?.id === trackId && existing.duration_sec && existing.duration_sec > 0) return;
    await this.waitForFileLoaded(2000);
    if (getCurrentTrack()?.id !== trackId) return;
    try {
      const duration = await this.queryProperty("duration");
      if (typeof duration === "number" && duration > 0) {
        setTrackDuration(trackId, duration);
        notifyStateChange(this.eventMode);
      }
    } catch {
      // duration unavailable
    }
  }

  async playNext(): Promise<void> {
    const next = getNextTrack();
    if (next) {
      try {
        const ok = await this.playTrack(next);
        if (!ok) {
          notifyStateChange(this.eventMode);
        }
      } catch (err) {
        log.error("[mpv] playNext failed:", err);
        notifyStateChange(this.eventMode);
      }
    } else {
      notifyStateChange(this.eventMode);
    }
  }

  async resumePlayback(): Promise<void> {
    if (!this.isReady()) return;

    const current = getCurrentTrack();
    if (current) {
      if (this.isPlayable(current)) {
        log.info("[mpv] Resuming current track...");
        this.playing = false;
        try {
          await this.playTrack(current);
        } catch (err) {
          log.error("[mpv] resume failed:", err);
        }
        return;
      }
      log.warn("[mpv] Current track is not downloaded yet — waiting");
      notifyStateChange(this.eventMode);
      return;
    }

    await this.playNext();
  }

  async startPlaybackIfIdle(): Promise<void> {
    if (this.playing || this.paused) return;

    const current = getCurrentTrack();
    if (current) {
      if (!this.isPlayable(current)) return;
      try {
        await this.playTrack(current);
      } catch (err) {
        log.error("[mpv] startPlaybackIfIdle failed:", err);
      }
      return;
    }

    await this.playNext();
  }

  async skip(): Promise<void> {
    await this.runExclusive(async () => {
      const next = getNextTrack();
      const willLoad = Boolean(next && this.isPlayable(next));
      await this.withManualNavigation(async () => {
        markCurrentPlayed();
        this.playing = false;
        if (willLoad && next) {
          try {
            const ok = await this.playTrack(next);
            if (!ok) {
              this.sendCommand(["stop"]);
              notifyStateChange(this.eventMode);
            }
          } catch (err) {
            log.error("[mpv] skip failed:", err);
            this.sendCommand(["stop"]);
            notifyStateChange(this.eventMode);
          }
        } else {
          this.sendCommand(["stop"]);
          notifyStateChange(this.eventMode);
        }
      }, willLoad);
    });
  }

  async previous(): Promise<boolean> {
    const current = getCurrentTrack();
    const prev = getPreviousTrack(current?.id);
    if (!prev || !this.isPlayable(prev)) return false;

    try {
      await this.runExclusive(async () => {
        await this.withManualNavigation(async () => {
          requeueCurrentTrack();
          this.playing = false;
          await this.playTrack(prev);
        });
      });
      return true;
    } catch (err) {
      log.error("[mpv] previous failed:", err);
      notifyStateChange(this.eventMode);
      throw err;
    }
  }

  async stopPlayback(): Promise<void> {
    await this.runExclusive(async () => {
      await this.withManualNavigation(async () => {
        this.sendCommand(["stop"]);
        markCurrentPlayed();
        this.playing = false;
        notifyStateChange(this.eventMode);
      }, false);
    });
  }

  pause(): boolean {
    const ok = this.sendCommand(["set_property", "pause", true]);
    if (!ok) {
      log.warn("[mpv] pause failed — IPC not ready");
      return false;
    }
    this.paused = true;
    notifyStateChange(this.eventMode);
    return true;
  }

  resume(): boolean {
    const ok = this.sendCommand(["set_property", "pause", false]);
    if (!ok) {
      log.warn("[mpv] resume failed — IPC not ready");
      return false;
    }
    this.paused = false;
    notifyStateChange(this.eventMode);
    return true;
  }

  seekRelative(seconds: number): void {
    this.sendCommand(["seek", seconds, "relative"]);
  }

  seekTo(seconds: number): void {
    this.sendCommand(["set_property", "time-pos", Math.max(0, seconds)]);
  }

  shutdown(): void {
    this.ipcReady = false;
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    if (process.platform !== "win32") {
      const sock = getMpvIpcConnectPath();
      if (fs.existsSync(sock)) {
        try { fs.unlinkSync(sock); } catch { /* ignore */ }
      }
    }
  }
}

export const player = new MpvPlayer();
