import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "../icons";
import "./dialog.css";

/** Native focus trap and inert background; app shortcuts stay outside. */
export function Dialog({ title, busy = false, onClose, children, className = "" }: { title: string; busy?: boolean; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className={`editor-dialog ${className}`} aria-labelledby={id}
    onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }} onKeyDown={(e) => e.stopPropagation()}>
    <header><h2 id={id}>{title}</h2><button type="button" className="icon-btn" aria-label={`Close ${title}`} disabled={busy} onClick={onClose}><X size={16} /></button></header>
    {children}
  </dialog>;
}
