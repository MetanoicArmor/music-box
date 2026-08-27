import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Track, apiClient } from "../api";
import { formatDuration, foldSearch } from "../format";

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
      setSuccess(`«${track.title}» снова в очереди`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить");
    } finally {
      setAddingId(null);
    }
  };

  if (history.length === 0 && query.trim().length < 2) {
    return (
      <div className="empty">
        <p>История пуста</p>
        <p className="empty-sub">Здесь появятся уже сыгранные треки</p>
      </div>
    );
  }

  return (
    <div>
      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}

      <div className="form-group history-search">
        <label>Поиск по истории</label>
        <input
          type="text"
          placeholder="Название или исполнитель"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
        {searching && <div className="search-status">Ищу…</div>}
      </div>

      {tracks.length === 0 && (
        <div className="empty">
          <p>Ничего не найдено</p>
          <p className="empty-sub">Попробуйте другое название</p>
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
                {!eventMode && (
                  <button
                    type="button"
                    className={`btn history-readd${queued ? " is-added" : " btn-secondary"}`}
                    disabled={queued || addingId === track.id}
                    onClick={() => handleReadd(track)}
                  >
                    {queued ? "Добавлено" : addingId === track.id ? "Добавляю…" : "В очередь"}
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
