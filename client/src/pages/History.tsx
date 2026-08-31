import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Track, apiClient } from "../api";
import { formatDuration, foldSearch } from "../format";
import TrackListen from "../components/TrackListen";
import { useLocale } from "../i18n/locale";

interface Props {
  state: AppState;
  refresh: () => Promise<void>;
}

function matchesQuery(track: Track, query: string): boolean {
  const q = foldSearch(query.trim());
  if (q.length < 2) return true;
  return foldSearch(track.title).includes(q) || foldSearch(track.artist).includes(q);
}

function sameSource(a: Track, b: Track): boolean {
  if (a.file_path && b.file_path && a.file_path === b.file_path) return true;
  if (a.source_ref && b.source_ref && a.source === b.source && a.source_ref === b.source_ref) return true;
  return false;
}

export default function HistoryPage({ state, refresh }: Props) {
  const { history, eventMode } = state;
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<Track[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setRemote(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++seqRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await apiClient.searchHistory(q);
        if (seq !== seqRef.current) return;
        setRemote(data.tracks);
      } catch {
        if (seq !== seqRef.current) return;
        setRemote([]);
      } finally {
        if (seq === seqRef.current) setSearching(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const tracks = useMemo(() => {
    if (remote) return remote;
    return history.filter((track) => matchesQuery(track, query));
  }, [history, query, remote]);

  const live = useMemo(() => {
    return [state.current, ...state.queue].filter((t): t is Track => !!t);
  }, [state.current, state.queue]);

  const handleReadd = async (track: Track) => {
    if (eventMode) return;
    setAddingId(track.id);
    setError("");
    setSuccess("");
    try {
      await apiClient.readdTrack(track.id);
      setSuccess(t("history.readded", { title: track.title }));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("history.addFailed"));
    } finally {
      setAddingId(null);
    }
  };

  if (history.length === 0 && query.trim().length < 2) {
    return (
      <div className="empty">
        <p>{t("history.empty")}</p>
        <p className="empty-sub">{t("history.emptySub")}</p>
      </div>
    );
  }

  return (
    <div>
      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}

      <div className="form-group history-search">
        <label>{t("history.search")}</label>
        <input
          type="text"
          placeholder={t("history.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
        {searching && <div className="search-status">{t("history.searching")}</div>}
      </div>

      {tracks.length === 0 && (
        <div className="empty">
          <p>{t("history.notFound")}</p>
          <p className="empty-sub">{t("history.notFoundSub")}</p>
        </div>
      )}

      <div className="track-list">
        {tracks.map((track) => {
          const queued = live.some((t) => sameSource(t, track));
          return (
            <div key={track.id} className="track-item history-item">
              {track.sessionColor && (
                <div className="track-color" style={{ background: track.sessionColor }} />
              )}
              {track.sessionEmoji && <span className="track-avatar" aria-hidden="true">{track.sessionEmoji}</span>}
              <div className="track-info">
                <div className="title">{track.title}</div>
                <div className="artist">{track.artist}</div>
              </div>
              <div className="history-actions">
                <div className="history-meta">
                  <span>{formatDuration(track.duration_sec) || "—"}</span>
                  {track.vote_score !== 0 && (
                    <span className="history-votes">{track.vote_score > 0 ? "+" : ""}{track.vote_score}</span>
                  )}
                </div>
                <TrackListen track={track} />
                {!eventMode && (
                  <button
                    type="button"
                    className={`btn history-readd${queued ? " is-added" : " btn-secondary"}`}
                    disabled={queued || addingId === track.id}
                    onClick={() => handleReadd(track)}
                  >
                    {queued ? t("history.added") : addingId === track.id ? t("history.adding") : t("history.toQueue")}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
