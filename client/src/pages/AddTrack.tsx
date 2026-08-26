import { useState, useRef, useEffect } from "react";
import { AppState, apiClient, SearchResults, SearchSuggestion } from "../api";

interface Props {
  state: AppState;
  refresh: () => Promise<void>;
}

function isDirectUrl(value: string): boolean {
  return /youtube\.com|youtu\.be|spotify\.com/i.test(value);
}

export default function AddTrackPage({ state, refresh }: Props) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (state.eventMode) {
    return (
      <div className="empty">
        <p>Добавление треков отключено</p>
        <p className="empty-sub">Event mode — только голосование, добавление отключено</p>
      </div>
    );
  }

  const runSearch = (value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = value.trim();
    if (q.length < 2 || isDirectUrl(q)) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++seqRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await apiClient.search(q);
        if (seq !== seqRef.current) return;
        setResults(data);
        setOpen(true);
      } catch {
        if (seq !== seqRef.current) return;
        setResults({ local: [], youtube: [] });
      } finally {
        if (seq === seqRef.current) setSearching(false);
      }
    }, 350);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setLoading(true);
    setError("");
    setSuccess("");
    setOpen(false);
    try {
      await apiClient.addTrack(input.trim());
      setInput("");
      setResults(null);
      setSuccess("Трек добавлен в очередь и скачивается");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  };

  const pickSuggestion = async (item: SearchSuggestion) => {
    setLoading(true);
    setError("");
    setSuccess("");
    setOpen(false);
    try {
      await apiClient.addSuggestion({
        title: item.title,
        artist: item.artist,
        source: item.source,
        sourceRef: item.sourceRef,
      });
      setInput("");
      setResults(null);
      setSuccess(`«${item.title}» добавлен в очередь`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  };

  const handleFile = async (file: File) => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const uploaded = await apiClient.upload(file);
      await apiClient.addLocalTrack({
        title: uploaded.title,
        artist: uploaded.artist,
        filePath: uploaded.filePath,
      });
      setSuccess(`«${uploaded.title}» добавлен!`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  };

  const showDropdown = open && !loading && results && (results.local.length > 0 || results.youtube.length > 0 || searching);

  return (
    <div>
      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group search-wrap" ref={wrapRef}>
          <label>Ссылка или поиск</label>
          <input
            type="text"
            placeholder="YouTube / Spotify URL или название трека"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              runSearch(e.target.value);
            }}
            onFocus={() => {
              if (results) setOpen(true);
            }}
            disabled={loading}
            autoComplete="off"
          />
          {searching && <div className="search-status">Ищу…</div>}
          {showDropdown && (
            <div className="search-dropdown">
              {results!.local.length > 0 && (
                <div className="search-group">
                  <div className="search-group-title">Уже было</div>
                  {results!.local.map((item, i) => (
                    <button
                      key={`l-${i}`}
                      type="button"
                      className="search-item"
                      onClick={() => pickSuggestion(item)}
                    >
                      <span className="search-item-title">{item.title}</span>
                      <span className="search-item-meta">{item.artist} · {item.source}</span>
                    </button>
                  ))}
                </div>
              )}
              {results!.youtube.length > 0 && (
                <div className="search-group">
                  <div className="search-group-title">YouTube</div>
                  {results!.youtube.map((item, i) => (
                    <button
                      key={`y-${i}`}
                      type="button"
                      className="search-item"
                      onClick={() => pickSuggestion(item)}
                    >
                      {item.thumbnail && <img src={item.thumbnail} alt="" className="search-thumb" />}
                      <span className="search-item-body">
                        <span className="search-item-title">{item.title}</span>
                        <span className="search-item-meta">{item.artist}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {!searching && results!.local.length === 0 && results!.youtube.length === 0 && (
                <div className="search-empty">Ничего не найдено</div>
              )}
            </div>
          )}
        </div>
        <button type="submit" className="btn btn-primary" disabled={loading || !input.trim()}>
          {loading ? "Добавляю..." : "Добавить в очередь"}
        </button>
      </form>

      <div className="divider">или</div>

      <div
        className="file-upload"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".mp3,.mp4,.m4a,.ogg,.wav,.flac"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <p className="file-upload-title">Загрузить файл</p>
        <p className="file-upload-hint">mp3, mp4, m4a, ogg, wav, flac</p>
      </div>
    </div>
  );
}
