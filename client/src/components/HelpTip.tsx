import { useState } from "react";
import { useLocale } from "../i18n/locale";

interface Props {
  text: string;
}

export default function HelpTip({ text }: Props) {
  const [open, setOpen] = useState(false);
  const { t } = useLocale();

  return (
    <span
      className="help-tip"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        setOpen((v) => !v);
      }}
      role="button"
      tabIndex={0}
      aria-label={t("help.tip")}
    >
      ?
      {open && <span className="help-tip-popup">{text}</span>}
    </span>
  );
}
