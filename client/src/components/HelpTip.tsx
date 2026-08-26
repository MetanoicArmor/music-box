import { useState } from "react";

interface Props {
  text: string;
}

export default function HelpTip({ text }: Props) {
  const [open, setOpen] = useState(false);

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
      aria-label="Подсказка"
    >
      ?
      {open && <span className="help-tip-popup">{text}</span>}
    </span>
  );
}
