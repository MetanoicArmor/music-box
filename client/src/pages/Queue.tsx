import { AppState } from "../api";
import TrackItem from "../components/TrackItem";

interface Props {
  state: AppState;
  vote: (trackId: string, direction: "up" | "down") => Promise<void>;
}

export default function QueuePage({ state, vote }: Props) {
  const { queue, userVotes } = state;

  if (queue.length === 0) {
    return <div className="empty">Очередь пуста</div>;
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
