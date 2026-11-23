"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import styles from "./shell/shell.module.css";

/** A small accessible dropdown menu (button + list), closed by Escape or outside click. */
export function Menu({ label, icon, children, align = "end" }: { label: string; icon?: ReactNode; children: (close: () => void) => ReactNode; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={styles.menu} ref={ref}>
      <button type="button" className="btn btn-sm" aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {icon}
        {label}
      </button>
      {open ? (
        <div id={id} role="menu" className={styles.menuList} data-align={align}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
