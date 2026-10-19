// Canvas sizes named the way CapCut's Ratio menu and the Details panel
// name them: a ratio plus the short side ("1080p" 9:16 is 1080x1920).

export const RATIOS: { label: string; w: number; h: number }[] = [
  { label: "16:9", w: 16, h: 9 },
  { label: "9:16", w: 9, h: 16 },
  { label: "1:1", w: 1, h: 1 },
  { label: "4:5", w: 4, h: 5 },
  { label: "4:3", w: 4, h: 3 },
  { label: "3:4", w: 3, h: 4 },
  { label: "21:9", w: 21, h: 9 },
];

/** Width and height for a ratio at a short side, both even (encoders
 * need even sizes for 4:2:0). */
export function canvasSize(rw: number, rh: number, short: number): [number, number] {
  const even = (n: number) => Math.round(n / 2) * 2;
  return rw >= rh ? [even((short * rw) / rh), short] : [short, even((short * rh) / rw)];
}

export const ratioOf = (w: number, h: number) => RATIOS.find((r) => Math.abs(r.w / r.h - w / h) < 0.01);
