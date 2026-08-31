import { useState, useEffect, useRef } from "react";
import { AppState, apiClient, AdminLogEntry } from "../api";
import TrackItem from "../components/TrackItem";
import HelpTip from "../components/HelpTip";
import { displayArtist, formatLocaleTime } from "../format";
import { useLocale } from "../i18n/locale";

interface Props {
  state: AppState;
  refresh: () => Promise<void>;
}

function QrCode({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { t } = useLocale();

  useEffect(() => {
    if (!canvasRef.current || !url) return;

    import("../utils/qr").then(({ drawQr }) => {
      drawQr(canvasRef.current!, url).catch(() => {
        // ignore draw errors
      });
    });
  }, [url]);

  return (
    <div className="qr-section">
      <p className="qr-title">{t("admin.qrTitle")}</p>
      <canvas ref={canvasRef} width={256} height={256} />
      <p className="qr-url">{url}</p>
      <p className="qr-hint">
        {t("admin.qrHint")}
      </p>
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function IconPrev() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6h2v12H6V6zm3.5 6 8.5 6V6l-8.5 6z" />
    </svg>
  );
}

function IconNext() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 18l8.5-6L6 6v12zm10 0V6h2v12h-2z" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5v14l11-7L8 5z" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  );
}

function IconStop() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6h12v12H6V6z" />
    </svg>
  );
}

interface AdminPlayerProps {
  refresh: () => Promise<void>;
  hasCurrent: boolean;
  hasQueue: boolean;
  hasHistory: boolean;
}

function AdminPlayer({ refresh, hasCurrent, hasQueue, hasHistory }: AdminPlayerProps) {
  const { t } = useLocale();
  const [playback, setPlayback] = useState<{ time: number; duration: number; paused: boolean } | null>(null);
  const [currentTrack, setCurrentTrack] = useState<{ artist: string; title: string } | null>(null);
  const [playerError, setPlayerError] = useState("");

  const pollPlayback = async () => {
    try {
      const data = await apiClient.adminPlayback();
      if (data.status) {
        setPlayback(data.status);
        setCurrentTrack(
          data.current ? { artist: data.current.artist, title: data.current.title } : null
        );
      } else {
        setPlayback(null);
        setCurrentTrack(null);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    pollPlayback();
    const id = setInterval(pollPlayback, 1500);
    return () => clearInterval(id);
  }, []);

  const runPlayerAction = async (action: () => Promise<unknown>, alsoRefresh = false) => {
    setPlayerError("");
    try {
      await action();
      await pollPlayback();
      if (alsoRefresh) await refresh();
    } catch (err) {
      setPlayerError(err instanceof Error ? err.message : t("admin.playerError"));
    }
  };

  const seekTo = async (absolute: number) => {
    await runPlayerAction(() => apiClient.adminSeek({ absolute }));
  };

  const isPaused = playback?.paused ?? true;
  const canTransport = hasCurrent && !!playback;

  return (
    <div className="admin-player">
      {currentTrack ? (
        <div className="admin-player-now">
          <div className="admin-player-label">{t("admin.nowPlaying")}</div>
          <div className="admin-player-title">{currentTrack.title}</div>
          {displayArtist(currentTrack.title, currentTrack.artist) && (
            <div className="admin-player-artist">{currentTrack.artist}</div>
          )}
        </div>
      ) : (
        <div className="admin-player-now">
          <div className="admin-player-label">{t("admin.player")}</div>
          <div className="admin-player-idle">{t("admin.idle")}</div>
        </div>
      )}

      {playerError && <div className="error admin-player-error">{playerError}</div>}

      <div className="admin-player-progress">
        <span>{formatTime(playback?.time ?? 0)}</span>
        <input
          type="range"
          min={0}
          max={playback?.duration ?? 100}
          step={1}
          value={Math.min(playback?.time ?? 0, playback?.duration ?? 100)}
          disabled={!canTransport || !playback?.duration}
          onChange={(e) => seekTo(Number(e.target.value))}
        />
        <span>{formatTime(playback?.duration ?? 0)}</span>
      </div>

      <div className="player-toolbar">
        <button
          type="button"
          className="player-btn"
          disabled={!hasHistory}
          aria-label={t("admin.prevTrack")}
          title={t("admin.prev")}
          onClick={() => runPlayerAction(() => apiClient.adminPrevious(), true)}
        >
          <IconPrev />
        </button>

        <button
          type="button"
          className="player-btn player-btn--main"
          disabled={!canTransport}
          aria-label={isPaused ? t("admin.play") : t("admin.pause")}
          title={isPaused ? t("admin.play") : t("admin.pause")}
          onClick={() =>
            runPlayerAction(() => (isPaused ? apiClient.adminResume() : apiClient.adminPause()))
          }
        >
          {isPaused ? <IconPlay /> : <IconPause />}
        </button>

        <button
          type="button"
          className="player-btn"
          disabled={!hasCurrent && !hasQueue}
          aria-label={t("admin.nextTrack")}
          title={t("admin.next")}
          onClick={() => runPlayerAction(() => apiClient.adminSkip(), true)}
        >
          <IconNext />
        </button>

        <button
          type="button"
          className="player-btn player-btn--stop"
          disabled={!hasCurrent}
          aria-label={t("admin.stop")}
          title={t("admin.stop")}
          onClick={() => runPlayerAction(() => apiClient.adminStop(), true)}
        >
          <IconStop />
        </button>
      </div>
    </div>
  );
}

export default function AdminPage({ state, refresh }: Props) {
  const { t, locale } = useLocale();
  const [isAdmin, setIsAdmin] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [log, setLog] = useState<AdminLogEntry[]>([]);
  const [banIp, setBanIp] = useState("");

  useEffect(() => {
    apiClient.adminCheck().then((r) => setIsAdmin(r.isAdmin));
    apiClient.getInfo().then((info) => setServerUrl(info.url));
  }, []);

  const loadLog = async () => {
    if (!isAdmin) return;
    const entries = await apiClient.adminLog();
    setLog(entries);
  };

  useEffect(() => {
    loadLog();
  }, [isAdmin]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    try {
      await apiClient.adminLogin(password);
      setIsAdmin(true);
      setPassword("");
    } catch {
      setLoginError(t("admin.wrongPassword"));
    }
  };

  const handleLogout = async () => {
    await apiClient.adminLogout();
    setIsAdmin(false);
  };

  const handleDeleteTrack = async (id: string) => {
    await apiClient.adminDeleteTrack(id);
    await refresh();
    await loadLog();
  };

  const handleDeleteArtist = async (artist: string) => {
    if (!confirm(t("admin.confirmDeleteArtist", { artist }))) return;
    await apiClient.adminDeleteArtist(artist);
    await refresh();
    await loadLog();
  };

  const handleBan = async () => {
    if (!banIp.trim()) return;
    await apiClient.adminBan({ ip: banIp.trim() });
    setBanIp("");
    await loadLog();
  };

  const handleUnban = async () => {
    if (!banIp.trim()) return;
    await apiClient.adminUnban({ ip: banIp.trim() });
    setBanIp("");
    await loadLog();
  };

  if (!isAdmin) {
    return (
      <div className="login-form">
        {serverUrl && <QrCode url={serverUrl} />}
        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label>{t("admin.password")}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("admin.passwordPlaceholder")}
            />
          </div>
          {loginError && <div className="error">{loginError}</div>}
          <button type="submit" className="btn btn-primary">{t("admin.login")}</button>
        </form>
      </div>
    );
  }

  const allTracks = [
    ...(state.current ? [state.current] : []),
    ...state.queue,
  ];

  return (
    <div>
      {serverUrl && <QrCode url={serverUrl} />}

      <AdminPlayer
        refresh={refresh}
        hasCurrent={!!state.current}
        hasQueue={state.queue.length > 0}
        hasHistory={state.history.length > 0}
      />

      <div className="admin-controls admin-controls--spaced">
        <button className="btn btn-danger" onClick={() => apiClient.adminClearQueue().then(refresh)}>
          {t("admin.clearQueue")}
        </button>
        <button
          className="btn btn-danger"
          onClick={() => {
            if (!confirm(t("admin.confirmClearHistory"))) return;
            apiClient.adminClearHistory().then(refresh);
          }}
        >
          {t("admin.clearHistory")}
        </button>
        <div className="admin-event-mode">
          <button
            className="btn btn-secondary"
            onClick={() => apiClient.adminEventMode(!state.eventMode).then(refresh)}
          >
            {t("admin.eventMode")}: {state.eventMode ? t("admin.eventOn") : t("admin.eventOff")}
          </button>
          <HelpTip text={t("admin.eventHelp")} />
        </div>
        <button className="btn btn-secondary" onClick={handleLogout}>
          {t("admin.logout")}
        </button>
      </div>

      <div className="form-group">
        <label>{t("admin.banIp")}</label>
        <div className="ban-row">
          <input
            type="text"
            placeholder="192.168.1.x"
            value={banIp}
            onChange={(e) => setBanIp(e.target.value)}
          />
          <button className="btn btn-danger" onClick={handleBan}>
            {t("track.ban")}
          </button>
          <button className="btn btn-secondary" onClick={handleUnban}>
            {t("track.unban")}
          </button>
        </div>
      </div>

      <h3 className="section-title">{t("admin.sectionQueue")} ({allTracks.length})</h3>
      <div className="track-list admin-queue-list">
        {allTracks.map((track) => (
          <TrackItem
            key={track.id}
            track={track}
            admin
            onDelete={handleDeleteTrack}
            onDeleteArtist={handleDeleteArtist}
            onBanIp={(ip) => {
              apiClient.adminBan({ ip }).then(() => loadLog());
            }}
            onUnbanIp={(ip) => {
              apiClient.adminUnban({ ip }).then(() => loadLog());
            }}
          />
        ))}
        {allTracks.length === 0 && <div className="empty">{t("admin.empty")}</div>}
      </div>

      <h3 className="section-title">{t("admin.sectionHistory")} ({state.history.length})</h3>
      <div className="track-list admin-queue-list">
        {state.history.map((track) => (
          <TrackItem
            key={track.id}
            track={track}
            admin
            onDelete={handleDeleteTrack}
            onBanIp={(ip) => {
              apiClient.adminBan({ ip }).then(() => loadLog());
            }}
            onUnbanIp={(ip) => {
              apiClient.adminUnban({ ip }).then(() => loadLog());
            }}
          />
        ))}
        {state.history.length === 0 && <div className="empty">{t("admin.empty")}</div>}
      </div>

      <h3 className="section-title">{t("admin.sectionLog")}</h3>
      <div className="log-list">
      {log.map((entry, i) => (
        <div key={i} className="log-entry">
          {formatLocaleTime(entry.created_at, locale)} — {t(`admin.log.${entry.action}`)}
          {entry.details && `: ${entry.details}`}
        </div>
      ))}
      </div>
    </div>
  );
}
