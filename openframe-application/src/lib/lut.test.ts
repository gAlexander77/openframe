import { describe, expect, it } from "vitest";
import { applyLut, fit1d, formatCube, identityLut, LutError, parseCube } from "./lut";

/** A 2-point 3D LUT that inverts: out = 1 - in. */
const INVERT_2 = `# made by hand
TITLE "Invert"
LUT_3D_SIZE 2
1 1 1
0 1 1
1 0 1
0 0 1
1 1 0
0 1 0
1 0 0
0 0 0
`;

describe("parseCube", () => {
  it("reads a 3D table red-fastest, with its title", () => {
    const lut = parseCube(INVERT_2);
    expect(lut).toMatchObject({ kind: "3d", size: 2, title: "Invert", domainMin: [0, 0, 0], domainMax: [1, 1, 1] });
    expect(lut.data.length).toBe(24);
    // second row is red = 1, green = 0, blue = 0 on input -> 0 1 1
    expect([...lut.data.slice(3, 6)]).toEqual([0, 1, 1]);
  });

  it("round-trips through formatCube, CRLF and inline comments included", () => {
    const id = identityLut("3d", 5);
    const text = formatCube(id).replace(/\n/g, "\r\n").replace("LUT_3D_SIZE 5", "LUT_3D_SIZE 5 # five per side");
    const back = parseCube(text);
    expect(back.size).toBe(5);
    expect([...back.data]).toEqual([...id.data].map((v) => +v.toFixed(6)));
  });

  it("reads 1D tables and Resolve's input range", () => {
    const lut = parseCube("LUT_1D_SIZE 3\nLUT_1D_INPUT_RANGE 0 2\n0 0 0\n0.5 0.5 0.5\n1 1 1\n");
    expect(lut).toMatchObject({ kind: "1d", size: 3, domainMin: [0, 0, 0], domainMax: [2, 2, 2] });
    expect(applyLut(lut, [1, 2, 0.5])).toEqual([0.5, 1, 0.25]);
  });

  it("names what is wrong", () => {
    expect(() => parseCube("hello")).toThrow(/no LUT_1D_SIZE or LUT_3D_SIZE/);
    expect(() => parseCube("LUT_3D_SIZE 2\n0 0 0\n")).toThrow(/expected 8 table rows, found 1/);
    expect(() => parseCube("LUT_3D_SIZE 1\n")).toThrow(/line 1: size must be/);
    expect(() => parseCube("LUT_1D_SIZE 2\n0 0 0\n0 x 0\n")).toThrow(/line 3: a table row needs three numbers/);
    expect(() => parseCube("LUT_1D_SIZE 2\nLUT_3D_SIZE 2\n0 0 0\n")).toThrow(/shaper/);
    expect(() => parseCube("LUT_1D_SIZE 2\nDOMAIN_MIN 1 1 1\nDOMAIN_MAX 0 0 0\n0 0 0\n1 1 1\n")).toThrow(LutError);
    expect(() => parseCube("LUT_1D_SIZE 2\n0 0 0\n1 1 1\n1 1 1\n")).toThrow(/more rows/);
  });
});

describe("applyLut", () => {
  it("identity changes nothing and inversion inverts, between grid points too", () => {
    const id = identityLut("3d", 17);
    const inv = parseCube(INVERT_2);
    for (const c of [[0, 0, 0], [1, 1, 1], [0.2, 0.55, 0.9], [0.731, 0.004, 0.5]] as [number, number, number][]) {
      applyLut(id, c).forEach((v, i) => expect(v).toBeCloseTo(c[i], 6));
      applyLut(inv, c).forEach((v, i) => expect(v).toBeCloseTo(1 - c[i], 6));
    }
  });

  it("clamps input outside the domain to the table's ends", () => {
    const id = identityLut("1d", 4);
    applyLut(id, [-0.5, 1.5, 0.5]).forEach((v, i) => expect(v).toBeCloseTo([0, 1, 0.5][i], 6));
  });

  it("resamples long 1D tables to fit a texture", () => {
    const big = identityLut("1d", 10000);
    const small = fit1d(big, 4096);
    expect(small.length).toBe(4096 * 3);
    expect(small[3 * 2048]).toBeCloseTo(2048 / 4095, 5);
    expect(fit1d(identityLut("1d", 16))).toHaveLength(48);
  });
});
