import { NavLink, Routes, Route } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useMusicBox } from "./hooks/useMusicBox";
import { apiClient } from "./api";
import PlayerPage from "./pages/Player";
import QueuePage from "./pages/Queue";
import HistoryPage from "./pages/History";
import AddTrackPage from "./pages/AddTrack";
import AdminPage from "./pages/Admin";
import { PreviewProvider } from "./hooks/useLocalPreview";
import { useLocale } from "./i18n/locale";
import LangSwitch from "./i18n/LangSwitch";

const LOGO_PERIOD_PX = 200;
const LOGO_DURATION_MS = 8000;

function PartyLogo() {
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const t = ((now - started) % LOGO_DURATION_MS) / LOGO_DURATION_MS;
      el.style.backgroundPositionX = `${-t * LOGO_PERIOD_PX}px`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <h1 ref={ref} className="party-logo">Music Box</h1>;
}

export default function App() {
  const { state, connected, vote, refresh } = useMusicBox();
  const { t } = useLocale();
  const [avatarError, setAvatarError] = useState("");

  const cycleAvatar = async () => {
    setAvatarError("");
    try {
      await apiClient.cycleAvatar();
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setAvatarError(
        msg === t("errors.requestFailed") || /failed to fetch|networkerror|load failed|request failed/i.test(msg)
          ? t("header.avatarFail")
          : msg || t("header.avatarBusy"),
      );
    }
  };

  return (
    <PreviewProvider>
    <div className="app-shell">
      <div className="app-bg" aria-hidden="true" />
      <div className="app">
        <header className="header">
          <div className="header-brand">
            <PartyLogo />
            <button type="button" className="avatar-btn" onClick={cycleAvatar} title={t("header.changeAvatar")}>
              {state.myEmoji || "🙂"}
            </button>
            {avatarError && <span className="avatar-error">{avatarError}</span>}
          </div>
          <div className="header-meta">
            <LangSwitch />
            <div className={`status-pill ${connected ? "is-live" : ""}`}>
              <span className="status-dot" />
              {state.activeUsers} {t("header.online")}
            </div>
          </div>
        </header>

        <div className="nav-wrap">
          <nav className="nav">
            <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
              {t("nav.now")}
            </NavLink>
            <NavLink to="/queue" className={({ isActive }) => (isActive ? "active" : "")}>
              {t("nav.queue")}
            </NavLink>
            <NavLink to="/history" className={({ isActive }) => (isActive ? "active" : "")}>
              {t("nav.history")}
            </NavLink>
            <NavLink to="/add" className={({ isActive }) => (isActive ? "active" : "")}>
              {t("nav.add")}
            </NavLink>
            <NavLink to="/admin" className={({ isActive }) => (isActive ? "active" : "")}>
              {t("nav.admin")}
            </NavLink>
          </nav>
        </div>

        <main className="content">
          <Routes>
            <Route path="/" element={<PlayerPage state={state} vote={vote} />} />
            <Route path="/queue" element={<QueuePage state={state} vote={vote} />} />
            <Route path="/history" element={<HistoryPage state={state} refresh={refresh} />} />
            <Route path="/add" element={<AddTrackPage state={state} refresh={refresh} />} />
            <Route path="/admin" element={<AdminPage state={state} refresh={refresh} />} />
          </Routes>
        </main>
      </div>
    </div>
    </PreviewProvider>
  );
}
