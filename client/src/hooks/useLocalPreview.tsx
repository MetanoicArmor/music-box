import { createContext, useCallback, useContext, useRef, useState, ReactNode } from "react";
import { isHostEmbed, streamUrl } from "../preview";

interface PreviewApi {
  playingId: string | null;
  hidePreview: boolean;
  toggle: (trackId: string) => void;
}

const PreviewContext = createContext<PreviewApi>({
  playingId: null,
  hidePreview: false,
  toggle: () => {},
});

export function PreviewProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const hidePreview = isHostEmbed();

  const toggle = useCallback((trackId: string) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playingId === trackId) {
      audio.pause();
      setPlayingId(null);
      return;
    }
    const next = streamUrl(trackId);
    if (audio.getAttribute("src") !== next) {
      audio.src = next;
    }
    void audio.play().then(() => setPlayingId(trackId)).catch(() => setPlayingId(null));
  }, [playingId]);

  return (
    <PreviewContext.Provider value={{ playingId, hidePreview, toggle }}>
      {children}
      <audio ref={audioRef} preload="none" playsInline onEnded={() => setPlayingId(null)} />
    </PreviewContext.Provider>
  );
}

export function useLocalPreview(): PreviewApi {
  return useContext(PreviewContext);
}
