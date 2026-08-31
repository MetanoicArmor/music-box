import { Track } from "./api";

const HOST_FLAG = "mb_host";

export function isHostEmbed(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("host") === "1") {
      sessionStorage.setItem(HOST_FLAG, "1");
      return true;
    }
    return sessionStorage.getItem(HOST_FLAG) === "1";
  } catch {
    return false;
  }
}

export function canListen(track: Track): boolean {
  if (track.status === "removed") return false;
  if (track.download_status === "pending" || track.download_status === "downloading" || track.download_status === "failed") {
    return false;
  }
  return !!track.file_path;
}

export function streamUrl(trackId: string, download = false): string {
  return download ? `/api/stream/${trackId}?download=1` : `/api/stream/${trackId}`;
}
