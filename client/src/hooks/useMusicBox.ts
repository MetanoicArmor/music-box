import { useEffect, useState, useCallback, useRef } from "react";
import { apiClient, AppState } from "../api";

const EMPTY_STATE: AppState = {
  current: null,
  queue: [],
  history: [],
  activeUsers: 0,
  eventMode: false,
  userVotes: {},
  sessionId: "",
};

export function useMusicBox() {
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await apiClient.getState();
      setState(data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refresh();

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "state") {
          setState((prev) => ({
            ...msg.payload,
            userVotes: prev.userVotes,
            sessionId: prev.sessionId,
          }));
        }
      } catch {
        // ignore
      }
    };

    return () => ws.close();
  }, [refresh]);

  const vote = useCallback(async (trackId: string, direction: "up" | "down") => {
    await apiClient.vote(trackId, direction);
    await refresh();
  }, [refresh]);

  return { state, connected, refresh, vote };
}
