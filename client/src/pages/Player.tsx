import { CSSProperties } from "react";
import { AppState } from "../api";

interface Props {
  state: AppState;
  vote: (trackId: string, direction: "up" | "down") => Promise<void>;
}

function artworkStyle(color: string | null): CSSProperties {
  if (color) {
    return { "--art-1": color, "--art-2": color } as CSSProperties;
  }
  return {} as CSSProperties;
}

export default function PlayerPage({ state, vote }: Props) {
  const { current, userVotes } = state;

  if (!current) {
    return (
      <div className="empty">
        <p>Ничего не играет</p>
        <p className="empty-sub">Добавьте трек в очередь</p>
      </div>
    );
  }

  const myVote = userVotes[current.id];

  return (
    <div>
      <div className="now-playing">
        <div className="label">Сейчас играет</div>
        <div className="artwork" style={artworkStyle(current.sessionColor)}>
          <span className="artwork-icon">♪</span>
        </div>
        <div className="title">{current.title}</div>
        <div className="artist">{current.artist}</div>
        <div className="vote-score">
          {current.vote_score > 0 ? "+" : ""}
          {current.vote_score}
        </div>
        <div className="vote-buttons">
          <button
            className={`vote-btn up ${myVote === 1 ? "active" : ""}`}
            onClick={() => vote(current.id, "up")}
            aria-label="Голос за"
          >
            ▲
          </button>
          <button
            className={`vote-btn down ${myVote === -1 ? "active" : ""}`}
            onClick={() => vote(current.id, "down")}
            aria-label="Голос против"
          >
            ▼
          </button>
        </div>
      </div>

      {current.source !== "local" && (
        <p className="source-row">
          <span className="source-badge">{current.source}</span>
        </p>
      )}
    </div>
  );
}
