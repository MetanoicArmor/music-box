export type ErrorLocale = "ru" | "en";

export type ErrorKey =
  | "banned"
  | "trackTooLong"
  | "avatarTaken"
  | "eventMode"
  | "eventModeUploads"
  | "playerNotReady"
  | "noPrevious"
  | "previousFailed"
  | "wrongPassword"
  | "tooManyVotes"
  | "fileTooLarge"
  | "emptyUpload"
  | "unsupportedType"
  | "noFile"
  | "trackNotFound"
  | "fileNotFound"
  | "sessionNotFound"
  | "trackRemoved"
  | "fileMissing"
  | "invalidSource"
  | "needInternet"
  | "needInternetLinks"
  | "inputRequired"
  | "resolveFailed"
  | "sessionOrIp"
  | "seekRequired"
  | "notFound"
  | "adminRequired"
  | "invalidRange"
  | "error"
  | "downloadFailed";

const ru: Record<ErrorKey, string> = {
  banned: "Вы забанены",
  trackTooLong: "Трек длиннее {minutes} мин",
  avatarTaken: "этот аватар уже занят",
  eventMode: "Добавление треков отключено в event mode",
  eventModeUploads: "Загрузки отключены в event mode",
  playerNotReady: "Плеер не готов",
  noPrevious: "Нет предыдущего трека в истории",
  previousFailed: "Не удалось включить предыдущий трек",
  wrongPassword: "Неверный пароль",
  tooManyVotes: "Слишком много голосов, подождите",
  fileTooLarge: "Файл слишком большой",
  emptyUpload: "Пустой файл",
  unsupportedType: "Неподдерживаемый тип файла",
  noFile: "Файл не загружен",
  trackNotFound: "Трек не найден",
  fileNotFound: "Файл не найден",
  sessionNotFound: "Сессия не найдена",
  trackRemoved: "Трек удалён",
  fileMissing: "Файл отсутствует",
  invalidSource: "source должен быть youtube или spotify",
  needInternet: "Для YouTube/Spotify нужен интернет",
  needInternetLinks: "Для ссылок YouTube/Spotify нужен интернет",
  inputRequired: "Нужен input или filePath",
  resolveFailed: "Не удалось распознать трек",
  sessionOrIp: "Нужен sessionId или ip",
  seekRequired: "Нужен seconds или absolute",
  notFound: "Не найдено",
  adminRequired: "Нужен доступ администратора",
  invalidRange: "Некорректный диапазон",
  error: "Ошибка",
  downloadFailed: "ошибка скачивания",
};

const en: Record<ErrorKey, string> = {
  banned: "You are banned",
  trackTooLong: "Track is longer than {minutes} min",
  avatarTaken: "this avatar is taken",
  eventMode: "Adding tracks is disabled in event mode",
  eventModeUploads: "Uploads disabled in event mode",
  playerNotReady: "Player is not ready",
  noPrevious: "No previous track in history",
  previousFailed: "Could not play the previous track",
  wrongPassword: "Wrong password",
  tooManyVotes: "Too many votes, slow down",
  fileTooLarge: "File too large",
  emptyUpload: "Empty upload",
  unsupportedType: "Unsupported file type",
  noFile: "No file uploaded",
  trackNotFound: "Track not found",
  fileNotFound: "File not found",
  sessionNotFound: "Session not found",
  trackRemoved: "Track removed",
  fileMissing: "File missing",
  invalidSource: "source must be youtube or spotify",
  needInternet: "Internet required for YouTube/Spotify",
  needInternetLinks: "Internet required for YouTube/Spotify links",
  inputRequired: "input or filePath required",
  resolveFailed: "Failed to resolve track",
  sessionOrIp: "sessionId or ip required",
  seekRequired: "seconds or absolute required",
  notFound: "Not found",
  adminRequired: "Admin access required",
  invalidRange: "Invalid range",
  error: "Error",
  downloadFailed: "download failed",
};

const catalogs: Record<ErrorLocale, Record<ErrorKey, string>> = { ru, en };

export function localeFromHeader(header: string | string[] | undefined): ErrorLocale {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return "ru";
  const first = raw.split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("en") ? "en" : "ru";
}

export function tErrorFromAccept(
  acceptLanguage: string | string[] | undefined,
  key: ErrorKey,
  vars?: Record<string, string | number>,
): string {
  return tError(localeFromHeader(acceptLanguage), key, vars);
}

export function tError(
  locale: ErrorLocale,
  key: ErrorKey,
  vars?: Record<string, string | number>,
): string {
  const template = catalogs[locale][key] ?? catalogs.ru[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
}

export function isErrorKey(value: string): value is ErrorKey {
  return value in ru;
}
