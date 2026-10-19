// Home's Recently deleted (ADR-078): deleting a project marks its summary
// with when, and the project stays on disk for TRASH_DAYS so it can be
// restored; after that Home deletes it for good. A mark in the summary works
// the same through every platform's existing save, list and delete, so the
// desktop app and the web build need nothing new.

export const TRASH_DAYS = 30;
const DAY = 86_400_000;

export interface Trashable {
  id: string;
  /** When the project went to Recently deleted (ms); absent while live. */
  deletedAt?: number;
}

/** Live projects as listed, the trash newest deletion first, and what has
 * waited out its days (Home deletes those). */
export function splitTrash<T extends Trashable>(all: T[], now: number): { live: T[]; trash: T[]; expired: T[] } {
  const live: T[] = [], trash: T[] = [], expired: T[] = [];
  for (const p of all) {
    if (typeof p.deletedAt !== "number") live.push(p);
    else if (now - p.deletedAt >= TRASH_DAYS * DAY) expired.push(p);
    else trash.push(p);
  }
  trash.sort((a, b) => b.deletedAt! - a.deletedAt!);
  return { live, trash, expired };
}

/** The summary as Home lists it once deleted, and once restored. */
export const markDeleted = <T extends Trashable>(s: T, now: number): T => ({ ...s, deletedAt: now });
export function markRestored<T extends Trashable>(s: T): T {
  const { deletedAt: _, ...rest } = s;
  return rest as T;
}

/** "Deleted for good in 29 days", for a trashed card. */
export function expiryText(deletedAt: number, now: number): string {
  const days = Math.max(0, Math.ceil((deletedAt + TRASH_DAYS * DAY - now) / DAY));
  return days <= 1 ? "Deleted for good within a day" : `Deleted for good in ${days} days`;
}
