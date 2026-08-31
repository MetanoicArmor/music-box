import { AppState } from "../api";
import TrackItem from "../components/TrackItem";
import { useLocale } from "../i18n/locale";

interface Props {
  state: AppState;
  vote: (trackId: string, direction: "up" | "down") => Promise<void>;
}

export default function QueuePage({ state, vote }: Props) {
  const { queue, userVotes } = state;
  const { t } = useLocale();

  if (queue.length === 0) {
    return <div className="empty">{t("queue.empty")}</div>;
  }

  return (
    <div className="track-list">
      {queue.map((track, i) => (
        <TrackItem
          key={track.id}
          track={track}
          index={i + 1}
          myVote={userVotes[track.id]}
          onVote={vote}
        />
      ))}
    </div>
  );
}
