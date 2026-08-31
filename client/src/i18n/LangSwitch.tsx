import { useLocale } from "./locale";
import type { Locale } from "./messages";

export default function LangSwitch() {
  const { locale, setLocale } = useLocale();
  const pick = (next: Locale) => {
    if (next !== locale) setLocale(next);
  };

  return (
    <div className="lang-switch" role="group" aria-label="Language">
      <button type="button" className={locale === "ru" ? "is-on" : ""} onClick={() => pick("ru")}>
        Ru
      </button>
      <span aria-hidden="true">|</span>
      <button type="button" className={locale === "en" ? "is-on" : ""} onClick={() => pick("en")}>
        En
      </button>
    </div>
  );
}
