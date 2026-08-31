export const SESSION_EMOJIS = [
  "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂",
  "😊", "😇", "🙂", "😉", "😌", "😍", "🥰", "😘",
  "😋", "😛", "😜", "🤪", "😝", "🤑", "🤗", "🤭",
  "🤫", "🤔", "🤨", "😏", "😒", "🙄", "😬", "😴",
  "🤤", "🤠", "🥳", "😎", "🤓", "🧐", "😺", "😸",
  "😹", "😻", "😼", "😽", "🐶", "🐱", "🐭", "🐹",
  "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮",
  "🐷", "🐸", "🐵", "🦄", "🐙", "🦋", "🌸", "⭐",
];

export const AVATAR_TAKEN = "avatarTaken";
const RECENT_MS = 24 * 60 * 60 * 1000;

export function pickFreeEmoji(taken: Set<string>): string | null {
  const free = SESSION_EMOJIS.filter((e) => !taken.has(e));
  if (free.length === 0) return null;
  return free[Math.floor(Math.random() * free.length)];
}

export function nextFreeEmoji(current: string | null, taken: Set<string>): string | null {
  const start = Math.max(0, SESSION_EMOJIS.indexOf(current ?? ""));
  for (let i = 1; i <= SESSION_EMOJIS.length; i++) {
    const candidate = SESSION_EMOJIS[(start + i) % SESSION_EMOJIS.length];
    if (candidate !== current && !taken.has(candidate)) return candidate;
  }
  return null;
}

export function recentCutoff(now = Date.now()): number {
  return now - RECENT_MS;
}
