import { useState } from "react";
import { HSL_BANDS, HSL_CENTERS } from "../../lib/grade";
import type { Clip, HslBand } from "../../lib/project/types";
import { Section, SliderRow } from "./controls";
import { hasKeys, setGradePart } from "./gradeEdit";
import "./color.css";

const LABEL: Record<HslBand, string> = {
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  cyan: "Cyan",
  blue: "Blue",
  purple: "Purple",
  magenta: "Magenta",
};

/** The band remembered across clips, the way CapCut keeps your place. */
let lastBand: HslBand = "red";

const hue = (deg: number, s = 85, l = 55) => `hsl(${(deg + 360) % 360} ${s}% ${l}%)`;

/** CapCut's HSL tab: eight color swatches, and hue, saturation and
 * lightness for the chosen range. Only pixels of that color change. */
export function HslPanel({ clip }: { clip: Clip }) {
  const [band, setBandState] = useState<HslBand>(lastBand);
  const setBand = (b: HslBand) => {
    lastBand = b;
    setBandState(b);
  };
  if (!("adjust" in clip)) return null;
  const hsl = clip.adjust.hsl ?? {};
  const edited = (b: HslBand) => {
    const s = hsl[b];
    return !!s && (s.hue !== 0 || s.saturation !== 0 || s.lightness !== 0) ? true : hasKeys(clip, `adjust.hsl.${b}.`);
  };
  const center = HSL_CENTERS[HSL_BANDS.indexOf(band)];
  const resetBand = () => {
    const next = { ...hsl };
    delete next[band];
    setGradePart(clip.id, `Reset ${LABEL[band].toLowerCase()}`, "hsl", Object.keys(next).length ? next : undefined, `adjust.hsl.${band}.`);
  };
  return (
    <>
      <div className="hsl-swatches" role="radiogroup" aria-label="Color range">
        {HSL_BANDS.map((b) => (
          <button
            key={b}
            role="radio"
            aria-checked={b === band}
            aria-label={`${LABEL[b]}${edited(b) ? " (adjusted)" : ""}`}
            data-tip={LABEL[b]}
            className={`hsl-swatch${b === band ? " on" : ""}${edited(b) ? " edited" : ""}`}
            style={{ "--swatch": hue(HSL_CENTERS[HSL_BANDS.indexOf(b)]) } as React.CSSProperties}
            onClick={() => setBand(b)}
            onKeyDown={(e) => {
              const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
              if (!d) return;
              e.preventDefault();
              const next = HSL_BANDS[(HSL_BANDS.indexOf(b) + d + 8) % 8];
              setBand(next);
              (e.currentTarget.parentElement?.children[HSL_BANDS.indexOf(next)] as HTMLElement | undefined)?.focus();
            }}
            tabIndex={b === band ? 0 : -1}
          />
        ))}
      </div>
      <Section title={LABEL[band]} onReset={resetBand} key={band}>
        <SliderRow clip={clip} path={`adjust.hsl.${band}.hue`} label="Hue" min={-100} max={100} reset={0} track={`linear-gradient(90deg, ${hue(center - 30)}, ${hue(center)}, ${hue(center + 30)})`} />
        <SliderRow clip={clip} path={`adjust.hsl.${band}.saturation`} label="Saturation" min={-100} max={100} reset={0} track={`linear-gradient(90deg, #7a7a7a, ${hue(center)})`} />
        <SliderRow clip={clip} path={`adjust.hsl.${band}.lightness`} label="Lightness" min={-100} max={100} reset={0} track={`linear-gradient(90deg, ${hue(center, 85, 18)}, ${hue(center)}, ${hue(center, 85, 85)})`} />
        <p className="insp-hint">Changes only {LABEL[band].toLowerCase()} tones; grays and other colors stay as they are.</p>
      </Section>
      {HSL_BANDS.some(edited) && (
        <div className="grade-foot">
          <button className="btn ghost" onClick={() => setGradePart(clip.id, "Reset HSL", "hsl", undefined, "adjust.hsl.")}>
            Reset all colors
          </button>
        </div>
      )}
    </>
  );
}
