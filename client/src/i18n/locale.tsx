import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { dictionaries, type Locale, type Messages } from "./messages";

const STORAGE_KEY = "mb_lang";

export function detectLocale(): Locale {
  if (typeof window === "undefined") return "ru";
  const q = new URLSearchParams(window.location.search).get("lang");
  if (q === "ru" || q === "en") {
    localStorage.setItem(STORAGE_KEY, q);
    return q;
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "ru" || stored === "en") return stored;
  const nav = (navigator.language || "").toLowerCase();
  return nav.startsWith("en") ? "en" : "ru";
}

let currentLocale: Locale = typeof window !== "undefined" ? detectLocale() : "ru";

export function getLocale(): Locale {
  return currentLocale;
}

function applyDocumentLang(locale: Locale) {
  currentLocale = locale;
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

function lookup(messages: Messages, key: string): string | undefined {
  const parts = key.split(".");
  let cur: unknown = messages;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
}

export function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const raw = lookup(dictionaries[locale], key) ?? lookup(dictionaries.ru, key) ?? key;
  return interpolate(raw, vars);
}

type TFn = (key: string, vars?: Record<string, string | number>) => string;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TFn;
  m: Messages;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const initial = detectLocale();
    applyDocumentLang(initial);
    return initial;
  });

  const setLocale = useCallback((next: Locale) => {
    localStorage.setItem(STORAGE_KEY, next);
    applyDocumentLang(next);
    setLocaleState(next);
  }, []);

  const value = useMemo<LocaleContextValue>(() => {
    const m = dictionaries[locale];
    const t: TFn = (key, vars) => translate(locale, key, vars);
    return { locale, setLocale, t, m };
  }, [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}
