import { Track } from "../api";
import { formatDuration } from "../format";
import TrackListen from "./TrackListen";
import { useLocale } from "../i18n/locale";

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

function downloadLabel(track: Track, t: (key: string) => string): { text: string; className: string } | null {
  const status = track.download_status;
  if (!status || track.source === "local") return null;
  if (status === "pending") return { text: t("track.pending"), className: "dl-badge dl-pending" };
  if (status === "downloading") return { text: t("track.downloading"), className: "dl-badge dl-downloading" };
  if (status === "failed") return { text: t("track.failed"), className: "dl-badge dl-failed" };
  return null;
}

function downloadErrorTitle(raw: string | null | undefined, t: (key: string) => string): string | undefined {
  if (!raw) return undefined;
  if (raw === "trackTooLong" || raw === "fileMissing" || raw === "downloadFailed") return t("errors.downloadFailed");
  if (/длиннее|too long|file missing/i.test(raw)) return t("errors.downloadFailed");
  return t("errors.downloadFailed");
}

export default function TrackItem({ track, index, myVote, onVote, admin, onDelete, onDeleteArtist, onBanIp, onUnbanIp }: Props) {
  const { t } = useLocale();
  const badge = downloadLabel(track, t);
  const duration = formatDuration(track.duration_sec);

  return (
    <div className="track-item">
      {track.sessionColor && (
        <div className="track-color" style={{ background: track.sessionColor }} />
      )}
      {track.sessionEmoji && <span className="track-avatar" aria-hidden="true">{track.sessionEmoji}</span>}
      <div className="track-info">
        {index !== undefined && <span className="track-index">{index}.</span>}
        <div className="title">{track.title}</div>
        <div className="artist">{track.artist}</div>
        {duration && <div className="track-duration">{duration}</div>}
        {badge && (
          <span className={badge.className} title={downloadErrorTitle(track.download_error, t)}>
            {badge.text}
          </span>
        )}
        {admin && track.addedByIp && (
          <div className="track-ip">
            <span>{track.addedByIp}</span>
            {onBanIp && (
              <button type="button" className="ip-ban" onClick={() => onBanIp(track.addedByIp!)}>
                {t("track.ban")}
              </button>
            )}
            {onUnbanIp && (
              <button type="button" className="ip-unban" onClick={() => onUnbanIp(track.addedByIp!)}>
                {t("track.unban")}
              </button>
            )}
          </div>
        )}
      </div>
      <TrackListen track={track} />
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
          <button className="delete" onClick={() => onDelete?.(track.id)} title={t("track.deleteTrack")}>
            ✕
          </button>
          <button onClick={() => onDeleteArtist?.(track.artist)} title={t("track.deleteArtist")}>
            🚫
          </button>
        </div>
      )}
    </div>
  );
}
