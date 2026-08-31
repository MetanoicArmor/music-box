import { CSSProperties } from "react";
import { AppState } from "../api";
import { formatDuration } from "../format";
import TrackListen from "../components/TrackListen";
import { useLocale } from "../i18n/locale";

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
  const { t } = useLocale();

  if (!current) {
    return (
      <div className="empty">
        <p>{t("player.empty")}</p>
        <p className="empty-sub">{t("player.emptySub")}</p>
      </div>
    );
  }

  const myVote = userVotes[current.id];
  const duration = formatDuration(current.duration_sec);

  return (
    <div>
      <div className="now-playing">
        <div className="label">{t("player.nowPlaying")}</div>
        <div className={`artwork${state.playing ? " is-playing" : ""}`} style={artworkStyle(current.sessionColor)}>
          <div className="viz-bars" aria-hidden="true">
            {Array.from({ length: 12 }, (_, i) => (
              <span key={i} className="viz-bar" />
            ))}
          </div>
        </div>
        <div className="title">{current.title}</div>
        <div className="artist">{current.artist}</div>
        {duration && <div className="now-duration">{duration}</div>}
        <div className="vote-score">
          {current.vote_score > 0 ? "+" : ""}
          {current.vote_score}
        </div>
        <div className="vote-buttons">
          <button
            className={`vote-btn up ${myVote === 1 ? "active" : ""}`}
            onClick={() => vote(current.id, "up")}
            aria-label={t("player.voteUp")}
          >
            ▲
          </button>
          <button
            className={`vote-btn down ${myVote === -1 ? "active" : ""}`}
            onClick={() => vote(current.id, "down")}
            aria-label={t("player.voteDown")}
          >
            ▼
          </button>
        </div>
        <TrackListen track={current} labeled />
      </div>

      {current.source !== "local" && (
        <p className="source-row">
          <span className="source-badge">{current.source}</span>
        </p>
      )}
    </div>
  );
}
