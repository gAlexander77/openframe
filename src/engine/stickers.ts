// Sticker artwork, drawn with Canvas2D: emoji from the system's color emoji
// font, everything else as paths in code. Original, neutral designs — no
// third-party marks. Each drawing works in a 100 x 100 unit box; the result
// is trimmed to its visible pixels so the sticker's handles hug the art.
// Used for the library's card thumbnails and, at STICKER_PX, for the PNG a
// project keeps (ADR-025).

import { STICKER_PX, type BadgeIcon, type StickerArt, type StickerDef } from "../lib/stickers";

type Ctx = OffscreenCanvasRenderingContext2D;

const SANS = `"Segoe UI", "Helvetica Neue", Arial, sans-serif`;
const DISPLAY = `Impact, "Arial Black", "Segoe UI", sans-serif`;
const EMOJI = `"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
const INK = "#1c1c1e";
const TAU = Math.PI * 2;

/** Device pixels per drawing unit (shadows ignore the transform). */
let unit = 1;

/** Relative luminance, to pick an outline that separates from the fill. */
function light(hex: string) {
  const v = parseInt(hex.slice(1, 7), 16);
  return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255 > 0.7;
}
const edgeFor = (c: string) => (light(c) ? INK : "#ffffff");

/** Stroke a wide outline under the shape, then fill it: the classic die-cut
 * sticker edge, and the overlapping parts of a compound shape vanish. */
// Compound paths fill nonzero: every part must wind clockwise on screen
// (arcs and roundRect do), or the overlap with the body comes out empty.
function outlined(ctx: Ctx, path: Path2D, fill: string | CanvasGradient, edge: string, width: number) {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = edge;
  ctx.lineWidth = width * 2;
  ctx.stroke(path);
  ctx.fillStyle = fill;
  ctx.fill(path);
}

function arrowHead(ctx: Ctx, x: number, y: number, angle: number, size: number) {
  const bx = x - Math.cos(angle) * size;
  const by = y - Math.sin(angle) * size;
  const nx = -Math.sin(angle) * size * 0.62;
  const ny = Math.cos(angle) * size * 0.62;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(bx + nx, by + ny);
  ctx.lineTo(bx - nx, by - ny);
  ctx.closePath();
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.fill();
  ctx.stroke();
}

/** Largest font size (up to `max`) at which `text` fits `width` units. */
function fitText(ctx: Ctx, text: string, font: (size: number) => string, width: number, max: number) {
  let size = max;
  ctx.font = font(size);
  const w = ctx.measureText(text).width;
  if (w > width) size = (max * width) / w;
  ctx.font = font(size);
  return size;
}

function spiky(cx: number, cy: number, points: number, outer: number, inner: number, squash = 1, rotate = 0): Path2D {
  const p = new Path2D();
  for (let i = 0; i < points * 2; i++) {
    // Deterministic wobble so bursts look hand-cut, identical every render.
    const jitter = Math.sin(i * 12.9898) * 0.08;
    const r = (i % 2 ? inner : outer) * (1 + jitter);
    const a = rotate + (i / (points * 2)) * TAU;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * squash;
    if (i) p.lineTo(x, y);
    else p.moveTo(x, y);
  }
  p.closePath();
  return p;
}

function sparklePath(p: Path2D, cx: number, cy: number, r: number) {
  p.moveTo(cx, cy - r);
  p.quadraticCurveTo(cx + r * 0.12, cy - r * 0.12, cx + r, cy);
  p.quadraticCurveTo(cx + r * 0.12, cy + r * 0.12, cx, cy + r);
  p.quadraticCurveTo(cx - r * 0.12, cy + r * 0.12, cx - r, cy);
  p.quadraticCurveTo(cx - r * 0.12, cy - r * 0.12, cx, cy - r);
  p.closePath();
}

function heartPath(p: Path2D, cx: number, cy: number, s: number) {
  const X = (v: number) => cx + (v - 50) * s;
  const Y = (v: number) => cy + (v - 50) * s;
  p.moveTo(X(50), Y(86));
  p.bezierCurveTo(X(14), Y(64), X(4), Y(42), X(16), Y(26));
  p.bezierCurveTo(X(28), Y(10), X(47), Y(14), X(50), Y(30));
  p.bezierCurveTo(X(53), Y(14), X(72), Y(10), X(84), Y(26));
  p.bezierCurveTo(X(96), Y(42), X(86), Y(64), X(50), Y(86));
  p.closePath();
}

function starPath(p: Path2D, cx: number, cy: number, outer: number, inner: number) {
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i / 10) * TAU;
    if (i) p.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    else p.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  p.closePath();
}

function label(ctx: Ctx, text: string, x: number, y: number, width: number, max: number, fill = "#ffffff", font = (s: number) => `900 ${s}px ${SANS}`) {
  fitText(ctx, text, font, width, max);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y + 0.5);
}

/** A white glyph in an `s`-unit box centered at (x, y), for badge pills. */
function icon(ctx: Ctx, kind: BadgeIcon, x: number, y: number, s: number) {
  ctx.save();
  ctx.translate(x - s / 2, y - s / 2);
  ctx.scale(s / 10, s / 10);
  ctx.fillStyle = ctx.strokeStyle = "#ffffff";
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.lineWidth = 1.6;
  const p = new Path2D();
  if (kind === "bell") {
    p.moveTo(0.8, 7.6);
    p.bezierCurveTo(2.2, 6.4, 1.6, 3.6, 2.8, 2.5);
    p.bezierCurveTo(3.9, 1.3, 6.1, 1.3, 7.2, 2.5);
    p.bezierCurveTo(8.4, 3.6, 7.8, 6.4, 9.2, 7.6);
    p.closePath();
    p.moveTo(6.3, 8.5);
    p.arc(5, 8.5, 1.3, 0, TAU);
    p.moveTo(5.8, 1.1);
    p.arc(5, 1.1, 0.8, 0, TAU);
    ctx.fill(p);
  } else if (kind === "heart") {
    heartPath(p, 5, 5.3, 0.11);
    ctx.fill(p);
  } else if (kind === "plus") {
    ctx.lineWidth = 2;
    p.moveTo(5, 1.5);
    p.lineTo(5, 8.5);
    p.moveTo(1.5, 5);
    p.lineTo(8.5, 5);
    ctx.stroke(p);
  } else if (kind === "check") {
    ctx.lineWidth = 2;
    p.moveTo(1.5, 5.2);
    p.lineTo(4, 7.6);
    p.lineTo(8.6, 2.4);
    ctx.stroke(p);
  } else if (kind === "share") {
    p.moveTo(1.5, 8.5);
    p.quadraticCurveTo(1.8, 4, 6.5, 4);
    ctx.stroke(p);
    arrowHead(ctx, 9.2, 4, 0, 3.4);
  } else {
    p.moveTo(2, 1);
    p.lineTo(2, 8.6);
    p.lineTo(4, 6.8);
    p.lineTo(5.6, 9.6);
    p.lineTo(7, 8.9);
    p.lineTo(5.6, 6.2);
    p.lineTo(8.4, 6);
    p.closePath();
    ctx.fill(p);
  }
  ctx.restore();
}

type Draw = (ctx: Ctx, s: StickerDef, color: string) => void;

const ART: Record<StickerArt, Draw> = {
  arrowCurved(ctx, _s, color) {
    ctx.lineCap = "round";
    ctx.strokeStyle = ctx.fillStyle = color;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(16, 84);
    ctx.quadraticCurveTo(18, 30, 66, 27);
    ctx.stroke();
    arrowHead(ctx, 88, 26, Math.atan2(27 - 30, 66 - 18), 24);
  },

  arrow(ctx, _s, color) {
    ctx.translate(50, 50);
    ctx.rotate(-0.26);
    const p = new Path2D();
    p.moveTo(-40, -8);
    p.lineTo(8, -8);
    p.lineTo(8, -22);
    p.lineTo(42, 0);
    p.lineTo(8, 22);
    p.lineTo(8, 8);
    p.lineTo(-40, 8);
    p.closePath();
    outlined(ctx, p, color, edgeFor(color), 3);
  },

  arrowScribble(ctx, _s, color) {
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.strokeStyle = color;
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(10, 80);
    ctx.bezierCurveTo(24, 56, 50, 92, 56, 66);
    ctx.bezierCurveTo(61, 44, 36, 44, 43, 60);
    ctx.bezierCurveTo(50, 76, 72, 56, 84, 26);
    ctx.stroke();
    const a = Math.atan2(26 - 56, 84 - 72);
    ctx.beginPath();
    for (const side of [-1, 1]) {
      ctx.moveTo(84, 26);
      ctx.lineTo(84 - Math.cos(a + side * 0.55) * 14, 26 - Math.sin(a + side * 0.55) * 14);
    }
    ctx.stroke();
  },

  ring(ctx, _s, color) {
    // One quick marker loop: thin where the pen lands and lifts, full in
    // between, spiraling in a touch so the overlap reads as a single stroke.
    ctx.lineCap = "round";
    ctx.strokeStyle = color;
    const tilt = -0.14;
    const at = (t: number): [number, number] => {
      const a = 2.3 + t * 1.1 * TAU;
      const x = Math.cos(a) * (42 - 4 * t);
      const y = Math.sin(a) * (31 - 3 * t);
      return [50 + x * Math.cos(tilt) - y * Math.sin(tilt), 50 + x * Math.sin(tilt) + y * Math.cos(tilt)];
    };
    const steps = 160;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      ctx.lineWidth = 1.5 + 5 * Math.sin(Math.PI * Math.min(1, t * 1.25 + 0.04));
      ctx.beginPath();
      ctx.moveTo(...at(t));
      ctx.lineTo(...at((i + 1) / steps));
      ctx.stroke();
    }
  },

  underline(ctx, _s, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(6, 54);
    ctx.quadraticCurveTo(50, 38, 95, 46);
    ctx.quadraticCurveTo(52, 52, 9, 66);
    ctx.quadraticCurveTo(2, 61, 6, 54);
    ctx.fill();
  },

  doubleUnderline(ctx, _s, color) {
    ctx.lineCap = "round";
    ctx.strokeStyle = color;
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(6, 47);
    ctx.quadraticCurveTo(50, 39, 94, 45);
    ctx.moveTo(16, 59);
    ctx.quadraticCurveTo(52, 52, 86, 57);
    ctx.stroke();
  },

  highlighter(ctx, _s, color) {
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = ctx.strokeStyle = color;
    ctx.lineJoin = "round";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(5, 42);
    ctx.lineTo(95, 38);
    ctx.lineTo(96, 58);
    ctx.lineTo(4, 63);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  },

  emphasisLines(ctx, _s, color) {
    ctx.fillStyle = color;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU + Math.sin(i * 7.1) * 0.08;
      const r1 = 28 + (i % 2) * 5;
      const r2 = 47 - (i % 3) * 3;
      const w = 2.6;
      const c = Math.cos(a);
      const s = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(50 + c * r1, 50 + s * r1);
      ctx.lineTo(50 + c * r2 - s * w, 50 + s * r2 + c * w);
      ctx.lineTo(50 + c * r2 + s * w, 50 + s * r2 - c * w);
      ctx.closePath();
      ctx.fill();
    }
  },

  sparkles(ctx, _s, color) {
    const spots: [number, number, number][] = [
      [40, 55, 32],
      [77, 24, 15],
      [80, 76, 10],
    ];
    ctx.shadowColor = color;
    ctx.shadowBlur = 4 * unit;
    for (const [x, y, r] of spots) {
      const p = new Path2D();
      sparklePath(p, x, y, r);
      ctx.fillStyle = color;
      ctx.fill(p);
      const core = new Path2D();
      sparklePath(core, x, y, r * 0.45);
      ctx.fillStyle = "#ffffff";
      ctx.fill(core);
    }
  },

  burst(ctx, s, color) {
    outlined(ctx, spiky(50, 50, 13, 48, 33, 0.82), color, INK, 3);
    const inner = spiky(50, 50, 13, 36, 26, 0.8, 0.12);
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 0.35;
    ctx.fill(inner);
    ctx.globalAlpha = 1;
    ctx.translate(50, 51);
    ctx.rotate(-0.14);
    const font = (n: number) => `italic ${n}px ${DISPLAY}`;
    fitText(ctx, s.text ?? "", font, 52, 26);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 5;
    ctx.strokeStyle = INK;
    ctx.strokeText(s.text ?? "", 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(s.text ?? "", 0, 0);
  },

  box(ctx, _s, color) {
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(11, 27);
    ctx.lineTo(90, 23);
    ctx.lineTo(87, 77);
    ctx.lineTo(12, 75);
    ctx.lineTo(14, 21);
    ctx.stroke();
  },

  crossOut(ctx, _s, color) {
    ctx.lineCap = "round";
    ctx.strokeStyle = color;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(18, 20);
    ctx.quadraticCurveTo(52, 48, 82, 82);
    ctx.moveTo(83, 20);
    ctx.quadraticCurveTo(48, 50, 20, 80);
    ctx.stroke();
  },

  speech(ctx, _s, color) {
    const p = new Path2D();
    p.ellipse(50, 44, 43, 31, 0, 0, TAU);
    p.moveTo(30, 66);
    p.lineTo(47, 72);
    p.lineTo(16, 90);
    p.closePath();
    outlined(ctx, p, color, INK, 3.2);
  },

  thought(ctx, _s, color) {
    const p = new Path2D();
    p.ellipse(50, 42, 34, 22, 0, 0, TAU);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      const r = 13 + (i % 3) * 1.5;
      p.moveTo(50 + Math.cos(a) * 33 + r, 42 + Math.sin(a) * 21);
      p.arc(50 + Math.cos(a) * 33, 42 + Math.sin(a) * 21, r, 0, TAU);
    }
    p.moveTo(33, 78);
    p.arc(27, 78, 6, 0, TAU);
    p.moveTo(19.5, 91);
    p.arc(16, 91, 3.5, 0, TAU);
    outlined(ctx, p, color, INK, 3);
  },

  shout(ctx, _s, color) {
    const p = spiky(50, 46, 16, 46, 37, 0.72);
    p.moveTo(30, 66);
    p.lineTo(44, 70);
    p.lineTo(14, 92);
    p.closePath();
    outlined(ctx, p, color, INK, 3.2);
  },

  callout(ctx, _s, color) {
    const p = new Path2D();
    p.roundRect(8, 22, 84, 48, 9);
    p.moveTo(59, 69);
    p.lineTo(50, 84);
    p.lineTo(41, 69);
    p.closePath();
    ctx.globalAlpha = 0.94;
    outlined(ctx, p, color, "#ffffff", 1.6);
  },

  chat(ctx, _s, color) {
    const p = new Path2D();
    p.roundRect(8, 20, 84, 52, 22);
    p.moveTo(84, 64);
    p.quadraticCurveTo(80, 76, 93, 85);
    p.quadraticCurveTo(80, 82, 70, 66);
    p.closePath();
    ctx.fillStyle = color;
    ctx.fill(p);
  },

  pill(ctx, s, color) {
    const text = s.text ?? "";
    let size = 13;
    const font = (n: number) => `900 ${n}px ${SANS}`;
    ctx.font = font(size);
    // Icon, gap and end caps scale with the type: shrink all of it to fit.
    const extra = (s.icon ? 1.65 : 0) + 2;
    size = Math.min(size, 96 / (ctx.measureText(text).width / size + extra));
    ctx.font = font(size);
    const tw = ctx.measureText(text).width;
    const iconW = s.icon ? size * 1.15 : 0;
    const gap = s.icon ? size * 0.5 : 0;
    const h = size * 2.1;
    const w = tw + iconW + gap + h * 0.95;
    const x = 50 - w / 2;
    const p = new Path2D();
    p.roundRect(x, 50 - h / 2, w, h, h / 2);
    ctx.fillStyle = color;
    ctx.fill(p);
    // A soft top sheen, like a pressed-plastic button.
    const sheen = ctx.createLinearGradient(0, 50 - h / 2, 0, 50 + h / 2);
    sheen.addColorStop(0, "rgba(255,255,255,0.22)");
    sheen.addColorStop(0.55, "rgba(255,255,255,0)");
    ctx.fillStyle = sheen;
    ctx.fill(p);
    const left = x + h * 0.475;
    if (s.icon) icon(ctx, s.icon, left + iconW / 2, 50, iconW);
    ctx.font = font(size);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, left + iconW + gap, 50.5);
  },

  bell(ctx, _s, color) {
    const p = new Path2D();
    p.moveTo(24, 70);
    p.bezierCurveTo(33, 60, 28, 40, 33, 31);
    p.bezierCurveTo(38, 17, 62, 17, 67, 31);
    p.bezierCurveTo(72, 40, 67, 60, 76, 70);
    p.closePath();
    p.moveTo(56.5, 78);
    p.arc(50, 78, 6.5, 0, TAU);
    p.moveTo(54.5, 16);
    p.arc(50, 16, 4.5, 0, TAU);
    const g = ctx.createLinearGradient(30, 20, 70, 80);
    g.addColorStop(0, "#fff1a6");
    g.addColorStop(0.45, color);
    g.addColorStop(1, "#e0a100");
    outlined(ctx, p, g, INK, 2.6);
    ctx.lineCap = "round";
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.5;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(50, 46, 38, side < 0 ? Math.PI + 0.35 : -0.75, side < 0 ? Math.PI + 0.75 : -0.35);
      ctx.stroke();
    }
  },

  starBadge(ctx, s, color) {
    outlined(ctx, spiky(50, 50, 18, 46, 39), color, "#ffffff", 2.4);
    ctx.translate(50, 50);
    ctx.rotate(-0.18);
    label(ctx, s.text ?? "", 0, 0, 52, 26);
  },

  saleTag(ctx, s, color) {
    ctx.translate(50, 50);
    ctx.rotate(-0.24);
    const p = new Path2D();
    p.moveTo(-38, -17);
    p.lineTo(22, -17);
    p.lineTo(40, 0);
    p.lineTo(22, 17);
    p.lineTo(-38, 17);
    p.closePath();
    outlined(ctx, p, color, "#ffffff", 2.4);
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(26, 0, 3.6, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    label(ctx, s.text ?? "", -9, 0, 50, 20);
  },

  live(ctx, s, color) {
    const p = new Path2D();
    p.roundRect(14, 36, 72, 28, 6);
    ctx.fillStyle = color;
    ctx.fill(p);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(28, 50, 4.6, 0, TAU);
    ctx.fill();
    label(ctx, s.text ?? "", 57, 50, 40, 18);
  },

  star(ctx, _s, color) {
    const p = new Path2D();
    starPath(p, 50, 53, 45, 20);
    const g = ctx.createRadialGradient(40, 38, 4, 50, 53, 48);
    g.addColorStop(0, "#fff4c2");
    g.addColorStop(1, color);
    outlined(ctx, p, g, "#ffffff", 3);
  },

  heart(ctx, _s, color) {
    const p = new Path2D();
    heartPath(p, 50, 50, 1);
    const g = ctx.createRadialGradient(34, 32, 4, 50, 50, 52);
    g.addColorStop(0, "#ff9fb4");
    g.addColorStop(1, color);
    outlined(ctx, p, g, "#ffffff", 3);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.ellipse(30, 34, 7, 4.2, -0.7, 0, TAU);
    ctx.fill();
  },

  check(ctx, _s, color) {
    const p = new Path2D();
    p.arc(50, 50, 40, 0, TAU);
    outlined(ctx, p, color, "#ffffff", 2.6);
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(29, 51);
    ctx.lineTo(44, 65);
    ctx.lineTo(71, 36);
    ctx.stroke();
  },

  cross(ctx, _s, color) {
    const p = new Path2D();
    p.arc(50, 50, 40, 0, TAU);
    outlined(ctx, p, color, "#ffffff", 2.6);
    ctx.lineCap = "round";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(35, 35);
    ctx.lineTo(65, 65);
    ctx.moveTo(65, 35);
    ctx.lineTo(35, 65);
    ctx.stroke();
  },

  bolt(ctx, _s, color) {
    const p = new Path2D();
    p.moveTo(60, 5);
    p.lineTo(25, 55);
    p.lineTo(47, 55);
    p.lineTo(38, 95);
    p.lineTo(77, 41);
    p.lineTo(55, 41);
    p.lineTo(68, 5);
    p.closePath();
    outlined(ctx, p, color, INK, 2.6);
  },

  play(ctx, _s, color) {
    const p = new Path2D();
    p.arc(50, 50, 40, 0, TAU);
    ctx.globalAlpha = 0.9;
    outlined(ctx, p, color, "#ffffff", 2.2);
    ctx.globalAlpha = 1;
    const t = new Path2D();
    t.moveTo(41, 31);
    t.lineTo(41, 69);
    t.lineTo(71, 50);
    t.closePath();
    ctx.fillStyle = ctx.strokeStyle = "#ffffff";
    ctx.lineJoin = "round";
    ctx.lineWidth = 4;
    ctx.fill(t);
    ctx.stroke(t);
  },

  pin(ctx, _s, color) {
    const p = new Path2D();
    p.moveTo(50, 94);
    p.bezierCurveTo(36, 72, 20, 58, 20, 38);
    p.arc(50, 38, 30, Math.PI, 0);
    p.bezierCurveTo(80, 58, 64, 72, 50, 94);
    p.closePath();
    outlined(ctx, p, color, "#ffffff", 2.6);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(50, 38, 11, 0, TAU);
    ctx.fill();
  },

  question(ctx, _s, color) {
    const p = new Path2D();
    p.arc(50, 50, 40, 0, TAU);
    outlined(ctx, p, color, "#ffffff", 2.6);
    label(ctx, "?", 50, 52, 60, 58);
  },
};

function drawEmoji(ctx: Ctx, char: string) {
  ctx.font = `80px ${EMOJI}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText(char);
  // Center the glyph's ink, not its advance box: emoji sit high in theirs.
  const y = 50 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  const x = 50 + (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2;
  ctx.fillText(char, x, y);
}

/** Crop to the visible pixels plus a small margin. */
function trim(src: OffscreenCanvas, margin: number): OffscreenCanvas {
  const ctx = src.getContext("2d")!;
  const { width: w, height: h } = src;
  const data = ctx.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 6) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return src;
  x0 = Math.max(0, x0 - margin);
  y0 = Math.max(0, y0 - margin);
  x1 = Math.min(w - 1, x1 + margin);
  y1 = Math.min(h - 1, y1 + margin);
  const out = new OffscreenCanvas(x1 - x0 + 1, y1 - y0 + 1);
  out.getContext("2d")!.drawImage(src, -x0, -y0);
  return out;
}

/** Draw a sticker into a canvas whose longer side is `px`, trimmed. */
export function drawSticker(s: StickerDef, px: number): OffscreenCanvas {
  // Draw with a margin for the shadow, then trim back to the ink.
  const pad = Math.round(px * 0.06);
  const size = px + pad * 2;
  const art = new OffscreenCanvas(size, size);
  const ctx = art.getContext("2d")!;
  unit = px / 100;
  ctx.translate(pad, pad);
  ctx.scale(unit, unit);
  if (s.emoji) drawEmoji(ctx, s.emoji);
  else if (s.art) ART[s.art](ctx, s, s.color ?? "#ffffff");
  // One soft drop shadow under the whole drawing, so overlapping parts never
  // shade each other and the sticker separates from any footage.
  const flat = s.art === "highlighter";
  const c = new OffscreenCanvas(size, size);
  const out = c.getContext("2d")!;
  if (!flat) {
    out.shadowColor = `rgba(0,0,0,${s.emoji ? 0.25 : 0.38})`;
    out.shadowBlur = 2.2 * unit;
    out.shadowOffsetY = 0.9 * unit;
  }
  out.drawImage(art, 0, 0);
  const trimmed = trim(c, Math.max(1, Math.round(px * 0.012)));
  if (Math.max(trimmed.width, trimmed.height) <= px) return trimmed;
  // Outlines can spill past the unit box: scale back to px.
  const k = px / Math.max(trimmed.width, trimmed.height);
  const fit = new OffscreenCanvas(Math.max(1, Math.round(trimmed.width * k)), Math.max(1, Math.round(trimmed.height * k)));
  fit.getContext("2d")!.drawImage(trimmed, 0, 0, fit.width, fit.height);
  return fit;
}

/** The PNG a project keeps for a sticker. */
export async function renderSticker(s: StickerDef, px = STICKER_PX): Promise<{ blob: Blob; width: number; height: number }> {
  const c = drawSticker(s, px);
  return { blob: await c.convertToBlob({ type: "image/png" }), width: c.width, height: c.height };
}

// ---- card thumbnails ---------------------------------------------------------------

const THUMB_PX = 168;
const thumbs = new Map<string, Promise<string>>();
let chain: Promise<unknown> = Promise.resolve();

/** A small PNG of the sticker for its library card, made once per session.
 * Requests run one at a time with a macrotask between them, so a grid of
 * a hundred never blocks input. */
export function stickerThumb(s: StickerDef): Promise<string> {
  let hit = thumbs.get(s.id);
  if (!hit) {
    hit = chain.then(async () => {
      await new Promise((r) => setTimeout(r, 0));
      const blob = await drawSticker(s, THUMB_PX).convertToBlob({ type: "image/png" });
      return URL.createObjectURL(blob);
    });
    chain = hit.catch(() => undefined);
    thumbs.set(s.id, hit);
  }
  return hit;
}
