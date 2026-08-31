import type { ReactNode } from "react";

interface Props {
  emoji?: string | null;
  duration?: string | null;
  children?: ReactNode;
}

export default function TrackMetaRow({ emoji, duration, children }: Props) {
  const hasContent = emoji || duration || children;
  if (!hasContent) return null;

  return (
    <div className="track-meta">
      {emoji && (
        <span className="track-avatar" aria-hidden="true">
          {emoji}
        </span>
      )}
      {duration && <span className="track-duration">{duration}</span>}
      {children}
    </div>
  );
}
