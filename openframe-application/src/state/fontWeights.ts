// Which weights a font family really has, for the Text tab's Weight list:
// the family drawn at each of 100..900 on a small canvas, with the same
// fallbacks the rasterizer uses, and the drawings compared
// (lib/textLook.ts distinctWeights names one weight per face). Measured
// once per family; until then a list shows Regular and Bold.

import { useEffect, useState } from "react";
import { textFamily } from "../engine/text";
import { distinctWeights, WEIGHTS } from "../lib/textLook";
import type { TextStyle } from "../lib/project/types";

const SAMPLE = "Hamburgefonstiv AWQ 0123";
const measured = new Map<string, Promise<number[]>>();

async function measure(family: string): Promise<number[]> {
  const font = (w: number) => `${w} 48px ${textFamily({ font: family } as TextStyle)}`;
  // Imported faces load on demand; installed ones resolve at once.
  await Promise.all(WEIGHTS.map((w) => document.fonts.load(font(w), SAMPLE).catch(() => [])));
  const canvas = new OffscreenCanvas(820, 64);
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  const drawn = WEIGHTS.map((w) => {
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.font = font(w);
    g.textBaseline = "middle";
    g.fillText(SAMPLE, 4, 32);
    const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0, hash = 0;
    for (let i = 3; i < data.length; i += 4) {
      ink += data[i];
      hash = (Math.imul(hash, 31) + data[i]) | 0;
    }
    return `${g.measureText(SAMPLE).width.toFixed(2)}:${ink}:${hash}`;
  });
  return distinctWeights(drawn);
}

/** The weights `family` draws differently, lightest first. */
export function useFontWeights(family: string): number[] {
  const [weights, setWeights] = useState<number[]>([400, 700]);
  useEffect(() => {
    let live = true;
    if (!measured.has(family)) measured.set(family, measure(family).catch(() => [400, 700]));
    void measured.get(family)!.then((w) => live && setWeights(w));
    return () => void (live = false);
  }, [family]);
  return weights;
}
