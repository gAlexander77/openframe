// What a number field read from what was typed. Number("") is 0 and
// Number("abc") NaN, so a cleared field set Scale to its 1% minimum, and
// stripping every non-digit read "1,5" as 15. A field now keeps its value
// when nothing usable was typed (ADR-072).

/**
 * The number typed into a field, or null when there is none ("" or
 * "abc": the field keeps its old value). A decimal comma reads as a point
 * ("1,5" is 1.5; with a point as well, commas are thousands: "1,500.5").
 * A unit after it is ignored ("50 %", "2s", "1.5x", "-3 dB").
 */
export function parseTyped(raw: string): number | null {
  let s = raw.trim().replace(/\s+/g, "");
  s = s.includes(".") ? s.replace(/,/g, "") : s.replace(",", ".");
  const m = /^[+-]?(\d+\.?\d*|\.\d+)/.exec(s);
  if (!m) return null;
  const rest = s.slice(m[0].length);
  if (rest && !/^[a-zA-Zµ%°]+$/.test(rest)) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Clamp a committed draft; invalid input leaves the caller's value alone. */
export function boundedNumber(raw: string, min = -Infinity, max = Infinity, integer = false): number | null {
  const n = parseTyped(raw);
  return n === null ? null : Math.max(min, Math.min(max, integer ? Math.floor(n) : n));
}
