import { Track } from "../api";
import { canListen, streamUrl } from "../preview";
import { useLocalPreview } from "../hooks/useLocalPreview";
import { useLocale } from "../i18n/locale";

interface Props {
  track: Track;
  labeled?: boolean;
}

export default function TrackListen({ track, labeled = false }: Props) {
  const { playingId, hidePreview, toggle } = useLocalPreview();
  const { t } = useLocale();
  if (!canListen(track)) return null;

  const playing = playingId === track.id;

  return (
    <div className={`track-listen${labeled ? " is-labeled" : ""}`}>
      {!hidePreview && (
        <button
          type="button"
          className={`listen-btn${playing ? " is-on" : ""}`}
          onClick={() => toggle(track.id)}
          aria-label={playing ? t("listen.pause") : t("listen.playHere")}
          title={t("listen.playHere")}
        >
          {labeled ? (playing ? t("listen.pause") : t("listen.playHere")) : playing ? "❚❚" : "▶"}
        </button>
      )}
      <a
        className="listen-btn listen-dl"
        href={streamUrl(track.id, true)}
        download
        aria-label={t("listen.download")}
        title={t("listen.download")}
      >
        {labeled ? t("listen.download") : "↓"}
      </a>
    </div>
  );
}
