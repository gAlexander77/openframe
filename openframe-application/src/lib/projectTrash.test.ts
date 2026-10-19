import { expect, it } from "vitest";
import { expiryText, markDeleted, markRestored, splitTrash, TRASH_DAYS } from "./projectTrash";

const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 18);

it("splits live projects, the trash newest first, and what has expired", () => {
  const all = [
    { id: "a" },
    { id: "b", deletedAt: now - 2 * DAY },
    { id: "c", deletedAt: now - DAY },
    { id: "d", deletedAt: now - TRASH_DAYS * DAY },
    { id: "e", deletedAt: now - TRASH_DAYS * DAY + 1 },
  ];
  const { live, trash, expired } = splitTrash(all, now);
  expect(live.map((p) => p.id)).toEqual(["a"]);
  expect(trash.map((p) => p.id)).toEqual(["c", "b", "e"]);
  expect(expired.map((p) => p.id)).toEqual(["d"]);
});

it("marks a summary deleted and restores it as it was", () => {
  const s = { id: "a", name: "Trip", updatedAt: 5 };
  const gone = markDeleted(s, now);
  expect(gone).toEqual({ ...s, deletedAt: now });
  expect(markRestored(gone)).toEqual(s);
  expect("deletedAt" in markRestored(gone)).toBe(false);
});

it("says when a trashed project goes for good", () => {
  expect(expiryText(now, now)).toBe(`Deleted for good in ${TRASH_DAYS} days`);
  expect(expiryText(now - 28.5 * DAY, now)).toBe("Deleted for good in 2 days");
  expect(expiryText(now - 29.5 * DAY, now)).toBe("Deleted for good within a day");
});
