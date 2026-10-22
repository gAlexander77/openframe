import { describe, expect, it } from "vitest";
import { angleDelta, dialAngle, pointerAngle } from "./angleControl";

describe("rotation dial", () => {
  it("crosses the pointer seam in both directions", () => {
    expect(angleDelta(179, -179)).toBe(2);
    expect(angleDelta(-179, 179)).toBe(-2);
  });
  it("keeps complete turns and snaps the resulting angle", () => {
    expect(dialAngle(350, 170, -170)).toBe(370);
    expect(dialAngle(370, -170, -150)).toBe(390);
    expect(dialAngle(350, 170, -170, true)).toBe(375);
    expect(pointerAngle(0, 10)).toBe(90);
  });
});
