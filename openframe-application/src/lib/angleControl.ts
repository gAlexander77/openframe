/** Incremental pointer angles keep the dial continuous across the seam and
 * preserve complete turns. Feed back the previous pointer angle each move. */
export function angleDelta(previous: number, next: number): number {
  return ((next - previous + 540) % 360 + 360) % 360 - 180;
}

export function dialAngle(value: number, previous: number, next: number, snap = false): number {
  const angle = value + angleDelta(previous, next);
  return snap ? Math.round(angle / 15) * 15 : +angle.toFixed(4);
}

export function pointerAngle(x: number, y: number): number {
  return Math.atan2(y, x) * 180 / Math.PI;
}
