// .cube LUTs (the Adobe/Resolve "Cube LUT Specification 1.0", research
// "Professional NLE features" §6.4): parse, validate, and a CPU reference of
// what the GPU does with them (tests, drives). The compositor uploads `data`
// as a 3D texture (or a 1D strip) and lets the hardware interpolate.
//
// ponytail: .cube only. Resolve's shaper form (a 1D and a 3D table in one
// file) and .3dl are refused with a readable message; add them when someone
// brings such a file.

export interface Lut {
  title?: string;
  kind: "1d" | "3d";
  /** Entries per axis: N for a 1D LUT, N per side (N³ entries) for 3D. */
  size: number;
  /** Input range mapped onto the table (DOMAIN_MIN/MAX, default 0..1). */
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  /** RGB triples. 3D tables are ordered red fastest, then green, then blue —
   * exactly a WebGL texImage3D layout (x = red, y = green, z = blue). */
  data: Float32Array;
}

export class LutError extends Error {}

const MAX_1D = 65536;
const MAX_3D = 256;

/** Parse a .cube file. Throws LutError naming the line that is wrong. */
export function parseCube(text: string): Lut {
  let title: string | undefined;
  let size1 = 0;
  let size3 = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  let data: Float32Array | null = null;
  let rows = 0;
  const lines = text.split(/\r\n|\n|\r/);

  const triple = (parts: string[], line: number, what: string): [number, number, number] => {
    const v = parts.slice(0, 3).map(Number);
    if (parts.length < 3 || v.some((n) => !Number.isFinite(n))) {
      throw new LutError(`line ${line}: ${what} needs three numbers`);
    }
    return v as [number, number, number];
  };
  const sizeOf = (parts: string[], line: number, max: number) => {
    const n = Number(parts[0]);
    if (!Number.isInteger(n) || n < 2 || n > max) throw new LutError(`line ${line}: size must be a whole number from 2 to ${max}`);
    return n;
  };

  for (let i = 0; i < lines.length; i++) {
    const hash = lines[i].indexOf("#");
    const line = (hash >= 0 ? lines[i].slice(0, hash) : lines[i]).trim();
    if (!line) continue;
    const no = i + 1;
    const c = line.charCodeAt(0);
    const numeric = (c >= 48 && c <= 57) || c === 45 || c === 43 || c === 46; // 0-9 - + .
    if (numeric) {
      if (!data) {
        if (size1 && size3) throw new LutError("this file has both a 1D and a 3D table (a shaper LUT); those are not supported yet");
        const n = size3 ? size3 ** 3 : size1;
        if (!n) throw new LutError(`line ${no}: table values before LUT_1D_SIZE or LUT_3D_SIZE`);
        data = new Float32Array(n * 3);
      }
      if (rows * 3 >= data.length) throw new LutError(`line ${no}: more rows than the ${size3 ? `${size3}³` : size1} the size promises`);
      const v = triple(line.split(/\s+/), no, "a table row");
      data[rows * 3] = v[0];
      data[rows * 3 + 1] = v[1];
      data[rows * 3 + 2] = v[2];
      rows++;
      continue;
    }
    if (data) throw new LutError(`line ${no}: keywords must come before the table`);
    const space = line.search(/\s/);
    const key = (space < 0 ? line : line.slice(0, space)).toUpperCase();
    const rest = space < 0 ? "" : line.slice(space + 1).trim();
    const parts = rest.split(/\s+/);
    switch (key) {
      case "TITLE":
        title = rest.replace(/^"(.*)"$/, "$1");
        break;
      case "LUT_1D_SIZE":
        size1 = sizeOf(parts, no, MAX_1D);
        break;
      case "LUT_3D_SIZE":
        size3 = sizeOf(parts, no, MAX_3D);
        break;
      case "DOMAIN_MIN":
        domainMin = triple(parts, no, "DOMAIN_MIN");
        break;
      case "DOMAIN_MAX":
        domainMax = triple(parts, no, "DOMAIN_MAX");
        break;
      // Resolve writes the domain as one range for all three channels.
      case "LUT_1D_INPUT_RANGE":
      case "LUT_3D_INPUT_RANGE": {
        const [lo, hi] = parts.map(Number);
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new LutError(`line ${no}: ${key} needs two numbers`);
        domainMin = [lo, lo, lo];
        domainMax = [hi, hi, hi];
        break;
      }
      default:
        // Unknown keywords (LUT_IN_VIDEO_RANGE, vendor tags) do not change
        // the table; the spec lets readers skip them.
        break;
    }
  }
  if (!size1 && !size3) throw new LutError("not a .cube LUT: no LUT_1D_SIZE or LUT_3D_SIZE line");
  const want = size3 ? size3 ** 3 : size1;
  if (rows !== want) throw new LutError(`expected ${want} table rows, found ${rows}`);
  for (let k = 0; k < 3; k++) {
    if (!(domainMax[k] > domainMin[k])) throw new LutError("DOMAIN_MAX must be greater than DOMAIN_MIN");
  }
  return { title, kind: size3 ? "3d" : "1d", size: size3 || size1, domainMin, domainMax, data: data! };
}

/** A LUT that changes nothing, for tests and fixtures. */
export function identityLut(kind: "1d" | "3d", size: number): Lut {
  const n = kind === "3d" ? size ** 3 : size;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = i % size;
    const g = kind === "3d" ? Math.floor(i / size) % size : r;
    const b = kind === "3d" ? Math.floor(i / (size * size)) : r;
    data.set([r / (size - 1), g / (size - 1), b / (size - 1)], i * 3);
  }
  return { kind, size, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data };
}

/** Write a LUT as .cube text (fixtures, "save LUT" later). */
export function formatCube(lut: Lut): string {
  const out = [
    ...(lut.title ? [`TITLE "${lut.title}"`] : []),
    `LUT_${lut.kind === "3d" ? "3D" : "1D"}_SIZE ${lut.size}`,
    `DOMAIN_MIN ${lut.domainMin.join(" ")}`,
    `DOMAIN_MAX ${lut.domainMax.join(" ")}`,
  ];
  for (let i = 0; i < lut.data.length; i += 3) {
    out.push(`${+lut.data[i].toFixed(6)} ${+lut.data[i + 1].toFixed(6)} ${+lut.data[i + 2].toFixed(6)}`);
  }
  return out.join("\n") + "\n";
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Where an input value lands in the table: 0..size-1, after the domain. */
function position(lut: Lut, v: number, ch: number) {
  return clamp01((v - lut.domainMin[ch]) / (lut.domainMax[ch] - lut.domainMin[ch])) * (lut.size - 1);
}

/** The LUT's output for one color (0..1 floats): linear per channel for 1D,
 * trilinear for 3D — what the GPU's texture filtering computes. */
export function applyLut(lut: Lut, rgb: [number, number, number]): [number, number, number] {
  const n = lut.size;
  const d = lut.data;
  if (lut.kind === "1d") {
    return [0, 1, 2].map((ch) => {
      const p = position(lut, rgb[ch], ch);
      const i = Math.min(Math.floor(p), n - 2);
      const t = p - i;
      return d[i * 3 + ch] * (1 - t) + d[(i + 1) * 3 + ch] * t;
    }) as [number, number, number];
  }
  const p = [0, 1, 2].map((ch) => position(lut, rgb[ch], ch));
  const i = p.map((v) => Math.min(Math.floor(v), n - 2));
  const t = p.map((v, k) => v - i[k]);
  const at = (r: number, g: number, b: number, ch: number) => d[((b * n + g) * n + r) * 3 + ch];
  const out: [number, number, number] = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    let acc = 0;
    for (let corner = 0; corner < 8; corner++) {
      const dr = corner & 1;
      const dg = (corner >> 1) & 1;
      const db = (corner >> 2) & 1;
      const w = (dr ? t[0] : 1 - t[0]) * (dg ? t[1] : 1 - t[1]) * (db ? t[2] : 1 - t[2]);
      acc += w * at(i[0] + dr, i[1] + dg, i[2] + db, ch);
    }
    out[ch] = acc;
  }
  return out;
}

/** A 1D table resampled to at most `max` entries (GPU texture width limit).
 * Exact when the table already fits; linear resampling otherwise. */
export function fit1d(lut: Lut, max = 4096): Float32Array {
  if (lut.kind !== "1d" || lut.size <= max) return lut.data;
  const out = new Float32Array(max * 3);
  for (let i = 0; i < max; i++) {
    const p = (i / (max - 1)) * (lut.size - 1);
    const j = Math.min(Math.floor(p), lut.size - 2);
    const t = p - j;
    for (let ch = 0; ch < 3; ch++) out[i * 3 + ch] = lut.data[j * 3 + ch] * (1 - t) + lut.data[(j + 1) * 3 + ch] * t;
  }
  return out;
}
