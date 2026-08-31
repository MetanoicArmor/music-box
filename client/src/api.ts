export interface Track {
  id: string;
  title: string;
  artist: string;
  source: "local" | "youtube" | "spotify";
  source_ref: string | null;
  file_path: string | null;
  added_by_session: string | null;
  vote_score: number;
  status: string;
  created_at: number;
  played_at: number | null;
  download_status?: "pending" | "downloading" | "ready" | "failed";
  download_error?: string | null;
  duration_sec?: number | null;
  sessionColor: string | null;
  sessionEmoji?: string | null;
  addedByIp?: string | null;
}

export interface SearchSuggestion {
  title: string;
  artist: string;
  source: "local" | "youtube" | "spotify";
  sourceRef: string;
  thumbnail?: string | null;
  duration_sec?: number | null;
}

export interface SearchResults {
  local: SearchSuggestion[];
  youtube: SearchSuggestion[];
}

export interface LibraryTrack {
  title: string;
  artist: string;
  album: string;
  source: "local";
  sourceRef: string;
  filename: string;
  duration_sec?: number | null;
}

export interface AppState {
  current: Track | null;
  queue: Track[];
  history: Track[];
  activeUsers: number;
  eventMode: boolean;
  playing: boolean;
  userVotes: Record<string, 1 | -1>;
  sessionId: string;
  myEmoji: string;
}

export interface ServerInfo {
  url: string;
  port: number;
  lanIp: string;
  https?: boolean;
}

export interface PlaybackStatus {
  time: number;
  duration: number;
  paused: boolean;
  playing: boolean;
}

export interface AdminPlayback {
  status: PlaybackStatus | null;
  current: Track | null;
}

export interface AdminLogEntry {
  action: string;
  details: string | null;
  created_at: number;
}

import { getLocale, translate } from "./i18n/locale";

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const method = (options?.method ?? "GET").toUpperCase();
  let body = options?.body;

  if ((method === "POST" || method === "PUT" || method === "PATCH") && body == null) {
    body = "{}";
  }

  const headers: Record<string, string> = {
    "Accept-Language": getLocale(),
  };
  if (body != null && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "include",
      ...options,
      method,
      headers: { ...headers, ...(options?.headers as Record<string, string> | undefined) },
      body,
    });
  } catch {
    throw new Error(translate(getLocale(), "errors.requestFailed"));
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText ?? translate(getLocale(), "errors.requestFailed"));
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const apiClient = {
  getState: () => api<AppState>("/api/state"),
  addTrack: (input: string) => api<Track>("/api/tracks", { method: "POST", body: JSON.stringify({ input }) }),
  addSuggestion: (data: { title: string; artist?: string; source: string; sourceRef: string; duration_sec?: number | null }) =>
    api<Track>("/api/tracks", { method: "POST", body: JSON.stringify(data) }),
  addLocalTrack: (data: { title: string; artist?: string; filePath: string }) =>
    api<Track>("/api/tracks", { method: "POST", body: JSON.stringify(data) }),
  search: (q: string) => api<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`),
  getLibrary: (q = "") => api<{ tracks: LibraryTrack[]; total: number }>(`/api/library?q=${encodeURIComponent(q)}`),
  searchHistory: (q: string) => api<{ tracks: Track[] }>(`/api/history/search?q=${encodeURIComponent(q)}`),
  readdTrack: (id: string) => api<Track>(`/api/tracks/${id}/readd`, { method: "POST" }),
  vote: (id: string, direction: "up" | "down") =>
    api<{ track: Track | null }>(`/api/tracks/${id}/vote`, { method: "POST", body: JSON.stringify({ direction }) }),
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api<{ title: string; artist: string; filePath: string }>("/api/upload", { method: "POST", body: form });
  },
  getInfo: () => api<ServerInfo>("/api/info"),

  adminLogin: (password: string) => api<{ ok: boolean }>("/api/admin/login", { method: "POST", body: JSON.stringify({ password }) }),
  adminLogout: () => api<{ ok: boolean }>("/api/admin/logout", { method: "POST" }),
  adminCheck: () => api<{ isAdmin: boolean }>("/api/admin/check"),
  adminDeleteTrack: (id: string) => api<{ ok: boolean }>(`/api/admin/tracks/${id}`, { method: "DELETE" }),
  adminDeleteArtist: (name: string) => api<{ removed: number }>(`/api/admin/artists/${encodeURIComponent(name)}`, { method: "DELETE" }),
  adminBan: (data: { sessionId?: string; ip?: string }) => api<{ ok: boolean }>("/api/admin/ban", { method: "POST", body: JSON.stringify(data) }),
  adminUnban: (data: { sessionId?: string; ip?: string }) => api<{ ok: boolean }>("/api/admin/unban", { method: "POST", body: JSON.stringify(data) }),
  adminSkip: () => api<{ ok: boolean }>("/api/admin/skip", { method: "POST" }),
  adminPrevious: () => api<{ ok: boolean }>("/api/admin/previous", { method: "POST" }),
  adminStop: () => api<{ ok: boolean }>("/api/admin/stop", { method: "POST" }),
  adminPause: () => api<{ ok: boolean }>("/api/admin/pause", { method: "POST" }),
  adminResume: () => api<{ ok: boolean }>("/api/admin/resume", { method: "POST" }),
  adminSeek: (data: { seconds?: number; absolute?: number }) =>
    api<{ ok: boolean }>("/api/admin/seek", { method: "POST", body: JSON.stringify(data) }),
  adminPlayback: () => api<AdminPlayback>("/api/admin/playback"),
  adminClearQueue: () => api<{ removed: number }>("/api/admin/clear-queue", { method: "POST" }),
  adminClearHistory: () => api<{ removed: number }>("/api/admin/clear-history", { method: "POST" }),
  adminEventMode: (enabled: boolean) => api<{ eventMode: boolean }>("/api/admin/event-mode", { method: "POST", body: JSON.stringify({ enabled }) }),
  adminLog: () => api<AdminLogEntry[]>("/api/admin/log"),
  cycleAvatar: () => api<{ emoji: string }>("/api/session/avatar", { method: "POST" }),
};
