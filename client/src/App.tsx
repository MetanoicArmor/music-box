import { NavLink, Routes, Route } from "react-router-dom";
import { useMusicBox } from "./hooks/useMusicBox";
import PlayerPage from "./pages/Player";
import QueuePage from "./pages/Queue";
import HistoryPage from "./pages/History";
import AddTrackPage from "./pages/AddTrack";
import AdminPage from "./pages/Admin";

export default function App() {
  const { state, connected, vote, refresh } = useMusicBox();

  return (
    <div className="app-shell">
      <div className="app-bg" aria-hidden="true" />
      <div className="app">
        <header className="header">
          <h1>Music Box</h1>
          <div className={`status-pill ${connected ? "is-live" : ""}`}>
            <span className="status-dot" />
            {state.activeUsers} online
          </div>
        </header>

        <div className="nav-wrap">
          <nav className="nav">
            <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
              Сейчас
            </NavLink>
            <NavLink to="/queue" className={({ isActive }) => (isActive ? "active" : "")}>
              Очередь
            </NavLink>
            <NavLink to="/history" className={({ isActive }) => (isActive ? "active" : "")}>
              История
            </NavLink>
            <NavLink to="/add" className={({ isActive }) => (isActive ? "active" : "")}>
              Добавить
            </NavLink>
            <NavLink to="/admin" className={({ isActive }) => (isActive ? "active" : "")}>
              Админ
            </NavLink>
          </nav>
        </div>

        <main className="content">
          <Routes>
            <Route path="/" element={<PlayerPage state={state} vote={vote} />} />
            <Route path="/queue" element={<QueuePage state={state} vote={vote} />} />
            <Route path="/history" element={<HistoryPage state={state} />} />
            <Route path="/add" element={<AddTrackPage state={state} refresh={refresh} />} />
            <Route path="/admin" element={<AdminPage state={state} refresh={refresh} />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
