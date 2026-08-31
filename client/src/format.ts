import type { Locale } from "./i18n/messages";

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return "";
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatLocaleTime(ms: number, locale: Locale): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "ru-RU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: locale === "en",
  }).format(new Date(ms));
}

export function foldSearch(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("ru").replace(/ё/g, "е");
}

/** Hide artist when it is empty, placeholder, or already part of the title. */
export function displayArtist(title: string, artist: string | null | undefined): string | null {
  const name = (artist ?? "").trim();
  if (!name || name === "Unknown") return null;
  if (title.includes(name)) return null;
  return name;
}
