import type { ReactNode } from "react";

/** Shared empty-state hierarchy: a symbol, a short title, and a next step. */
export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint: string }) {
  return <div className="empty" role="status">{icon}<strong>{title}</strong><span>{hint}</span></div>;
}
