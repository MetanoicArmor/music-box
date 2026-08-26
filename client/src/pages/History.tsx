import { AppState } from "../api";

interface Props {
  state: AppState;
}

function formatPlayedAt(ts: number | null, fallback: number): string {
  const date = new Date(ts ?? fallback);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function HistoryPage({ state }: Props) {
  const { history } = state;

  if (history.length === 0) {
    return (
      <div className="empty">
        <p>История пуста</p>
        <p className="empty-sub">Здесь появятся уже сыгранные треки</p>
      </div>
    );
  }

  return (
    <div className="track-list">
      {history.map((track) => (
        <div key={track.id} className="track-item history-item">
          {track.sessionColor && (
            <div className="track-color" style={{ background: track.sessionColor }} />
          )}
          <div className="track-info">
            <div className="title">{track.title}</div>
            <div className="artist">{track.artist}</div>
          </div>
          <div className="history-meta">
            <span>{formatPlayedAt(track.played_at, track.created_at)}</span>
            {track.vote_score !== 0 && (
              <span className="history-votes">{track.vote_score > 0 ? "+" : ""}{track.vote_score}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
