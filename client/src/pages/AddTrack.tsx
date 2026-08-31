import { useState, useRef, useEffect, useMemo } from "react";
import { AppState, Track, apiClient, SearchResults, SearchSuggestion, LibraryTrack } from "../api";
import { formatDuration } from "../format";
import { useLocale } from "../i18n/locale";

interface Props {
  state: AppState;
  refresh: () => Promise<void>;
}

function isDirectUrl(value: string): boolean {
  return /youtube\.com|youtu\.be|spotify\.com/i.test(value);
}

function sameLocalPath(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
}

export default function AddTrackPage({ state, refresh }: Props) {
  const { t } = useLocale();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [open, setOpen] = useState(false);
  const [library, setLibrary] = useState<LibraryTrack[]>([]);
  const [libraryTotal, setLibraryTotal] = useState(0);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [librarySearching, setLibrarySearching] = useState(false);
  const [addingPath, setAddingPath] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const libraryWrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const libraryDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  const librarySeqRef = useRef(0);

  const loadLibrary = async (q = "", opts?: { open?: boolean }) => {
    const seq = ++librarySeqRef.current;
    setLibrarySearching(true);
    try {
      const data = await apiClient.getLibrary(q);
      if (seq !== librarySeqRef.current) return;
      setLibrary(data.tracks);
      if (!q.trim()) setLibraryTotal(data.total);
      if (opts?.open) setLibraryOpen(true);
    } catch {
      if (seq !== librarySeqRef.current) return;
      setLibrary([]);
    } finally {
      if (seq === librarySeqRef.current) setLibrarySearching(false);
    }
  };

  useEffect(() => {
    void loadLibrary();
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current && !wrapRef.current.contains(target)) {
        setOpen(false);
      }
      if (libraryWrapRef.current && !libraryWrapRef.current.contains(target)) {
        setLibraryOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const live = useMemo(() => {
    return [state.current, ...state.queue].filter((t): t is Track => !!t);
  }, [state.current, state.queue]);

  if (state.eventMode) {
    return (
      <div className="empty">
        <p>{t("add.eventOff")}</p>
        <p className="empty-sub">{t("add.eventOffSub")}</p>
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

  const runLibrarySearch = (value: string) => {
    if (libraryDebounceRef.current) clearTimeout(libraryDebounceRef.current);
    setLibraryQuery(value);
    setLibraryOpen(true);
    libraryDebounceRef.current = setTimeout(() => {
      void loadLibrary(value, { open: true });
    }, 250);
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
      setSuccess(t("add.queuedDownloading"));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("add.error"));
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
        duration_sec: item.duration_sec,
      });
      setInput("");
      setResults(null);
      setSuccess(t("add.queuedTitle", { title: item.title }));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("add.error"));
    } finally {
      setLoading(false);
    }
  };

  const addLibraryTrack = async (item: LibraryTrack) => {
    setAddingPath(item.sourceRef);
    setError("");
    setSuccess("");
    setLibraryOpen(false);
    try {
      await apiClient.addSuggestion({
        title: item.title,
        artist: item.artist,
        source: "local",
        sourceRef: item.sourceRef,
        duration_sec: item.duration_sec,
      });
      setLibraryQuery("");
      setSuccess(t("add.queuedTitle", { title: item.title }));
      await refresh();
      await loadLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("add.error"));
    } finally {
      setAddingPath(null);
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
      setSuccess(t("add.uploadedTitle", { title: uploaded.title }));
      await refresh();
      await loadLibrary(libraryQuery);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("add.uploadError"));
    } finally {
      setLoading(false);
    }
  };

  const showDropdown = open && !loading && results && (results.local.length > 0 || results.youtube.length > 0 || searching);
  const showLibraryDropdown = libraryOpen && !loading;

  return (
    <div>
      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group search-wrap" ref={wrapRef}>
          <label>{t("add.linkOrSearch")}</label>
          <input
            type="text"
            placeholder={t("add.searchPlaceholder")}
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
          {searching && <div className="search-status">{t("add.searching")}</div>}
          {showDropdown && (
            <div className="search-dropdown">
              {results!.local.length > 0 && (
                <div className="search-group">
                  <div className="search-group-title">{t("add.local")}</div>
                  {results!.local.map((item, i) => (
                    <button
                      key={`l-${i}`}
                      type="button"
                      className="search-item"
                      onClick={() => pickSuggestion(item)}
                    >
                      <span className="search-item-icon" aria-hidden="true">♪</span>
                      <span className="search-item-body">
                        <span className="search-item-title">{item.title}</span>
                        <span className="search-item-meta">
                          {item.artist} · {item.source}
                          {formatDuration(item.duration_sec) ? ` · ${formatDuration(item.duration_sec)}` : ""}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {results!.youtube.length > 0 && (
                <div className="search-group">
                  <div className="search-group-title">{t("add.youtube")}</div>
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
                <div className="search-empty">{t("add.notFound")}</div>
              )}
            </div>
          )}
        </div>
        <button type="submit" className="btn btn-primary" disabled={loading || !input.trim()}>
          {loading ? t("add.adding") : t("add.addToQueue")}
        </button>
      </form>

      <div className="divider">{t("add.or")}</div>

      <div className="form-group search-wrap" ref={libraryWrapRef}>
        <label>{t("add.library")}{libraryTotal > 0 ? ` (${libraryTotal})` : ""}</label>
        <input
          type="text"
            placeholder={t("add.libraryPlaceholder")}
          value={libraryQuery}
          onChange={(e) => runLibrarySearch(e.target.value)}
          onFocus={() => {
            setLibraryOpen(true);
            if (library.length === 0) void loadLibrary(libraryQuery, { open: true });
          }}
          disabled={loading}
          autoComplete="off"
        />
        {librarySearching && <div className="search-status">{t("add.searching")}</div>}
        {showLibraryDropdown && (
          <div className="search-dropdown">
            {library.length > 0 && (
              <div className="search-group">
                <div className="search-group-title">{t("add.local")}</div>
                {library.map((item) => {
                  const queued = live.some((t) => sameLocalPath(t.file_path, item.sourceRef));
                  const meta = [item.artist, item.album].filter(Boolean).join(" · ") || item.filename;
                  const duration = formatDuration(item.duration_sec);
                  return (
                    <button
                      key={item.sourceRef}
                      type="button"
                      className={`search-item${queued ? " is-queued" : ""}`}
                      disabled={queued || addingPath === item.sourceRef}
                      onClick={() => addLibraryTrack(item)}
                    >
                      <span className="search-item-icon" aria-hidden="true">♪</span>
                      <span className="search-item-body">
                        <span className="search-item-title">{item.title}</span>
                        <span className="search-item-meta">{duration ? `${meta} · ${duration}` : meta}</span>
                      </span>
                      <span className="search-item-action">
                        {queued ? t("add.inQueue") : addingPath === item.sourceRef ? "…" : t("add.toQueue")}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {!librarySearching && library.length === 0 && (
              <div className="search-empty">
                {libraryQuery.trim()
                  ? t("add.notFound")
                  : t("add.libraryEmpty")}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="divider">{t("add.or")}</div>

      <div
        className="file-upload"
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
          accept="audio/*,video/mp4,video/webm,.mp3,.mp4,.m4a,.aac,.ogg,.oga,.wav,.flac,.webm,.opus,.m4b,.wma,.aiff,.aif,.ape,.wv,.mpga"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <p className="file-upload-title">{t("add.upload")}</p>
        <p className="file-upload-hint">{t("add.uploadHint")}</p>
      </div>
    </div>
  );
}
