import { Track } from "../api";

interface Props {
  track: Track;
  index?: number;
  myVote?: 1 | -1;
  onVote: (trackId: string, direction: "up" | "down") => Promise<void>;
  admin?: boolean;
  onDelete?: (id: string) => void;
  onDeleteArtist?: (artist: string) => void;
  onBanIp?: (ip: string) => void;
  onUnbanIp?: (ip: string) => void;
}

function downloadLabel(track: Track): { text: string; className: string } | null {
  const status = track.download_status;
  if (!status || track.source === "local") return null;
  if (status === "pending") return { text: "ожидает", className: "dl-badge dl-pending" };
  if (status === "downloading") return { text: "скачивается", className: "dl-badge dl-downloading" };
  if (status === "failed") return { text: "ошибка", className: "dl-badge dl-failed" };
  return null;
}

export default function TrackItem({ track, index, myVote, onVote, admin, onDelete, onDeleteArtist, onBanIp, onUnbanIp }: Props) {
  const badge = downloadLabel(track);

  return (
    <div className="track-item">
      {track.sessionColor && (
        <div className="track-color" style={{ background: track.sessionColor }} />
      )}
      <div className="track-info">
        {index !== undefined && <span className="track-index">{index}.</span>}
        <div className="title">{track.title}</div>
        <div className="artist">{track.artist}</div>
        {badge && (
          <span className={badge.className} title={track.download_error ?? undefined}>
            {badge.text}
          </span>
        )}
        {admin && track.addedByIp && (
          <div className="track-ip">
            <span>{track.addedByIp}</span>
            {onBanIp && (
              <button type="button" className="ip-ban" onClick={() => onBanIp(track.addedByIp!)}>
                Ban
              </button>
            )}
            {onUnbanIp && (
              <button type="button" className="ip-unban" onClick={() => onUnbanIp(track.addedByIp!)}>
                Unban
              </button>
            )}
          </div>
        )}
      </div>
      <div className="track-votes">
        <button
          className={`vote-btn up ${myVote === 1 ? "active" : ""}`}
          onClick={() => onVote(track.id, "up")}
        >
          ▲
        </button>
        <span className="score">{track.vote_score > 0 ? "+" : ""}{track.vote_score}</span>
        <button
          className={`vote-btn down ${myVote === -1 ? "active" : ""}`}
          onClick={() => onVote(track.id, "down")}
        >
          ▼
        </button>
      </div>
      {admin && (
        <div className="admin-track-actions">
          <button className="delete" onClick={() => onDelete?.(track.id)} title="Удалить трек">
            ✕
          </button>
          <button onClick={() => onDeleteArtist?.(track.artist)} title="Удалить артиста">
            🚫
          </button>
        </div>
      )}
    </div>
  );
}
