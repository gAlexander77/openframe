// Colorize (ADR-105): a picture's brightness in one color, so a white
// sprite or logo can be made amber. Every edit runs set_colorize, the
// command an agent would, so the two agree.

import { runCommand } from "../../lib/commands";
import { COLORIZE_DEFAULT } from "../../lib/colorize";
import type { Clip } from "../../lib/project/types";
import { store } from "../../state/store";
import { toast } from "../../state/toast";
import { ColorInput, Row, Section, SliderRow, Toggle } from "./controls";

const pct = { show: (v: number) => v * 100, store: (v: number) => v / 100 };

function run(label: string, args: Record<string, unknown>) {
  try {
    store.edit(label, (p) => runCommand(p, "set_colorize", args));
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "error");
  }
}

export function ColorizeSection({ clip }: { clip: Clip }) {
  if (!("adjust" in clip)) return null;
  const c = clip.adjust.colorize;
  const ids = [clip.id];
  return (
    // Keyed by on/off: switching it on opens the section on its color.
    <Section key={c ? "on" : "off"} title="Colorize" defaultOpen={!!c} extra={<Toggle label="Colorize" on={!!c} onChange={(on) => run(on ? "Colorize" : "No colorize", on ? { clip_ids: ids, ...COLORIZE_DEFAULT } : { clip_ids: ids, off: true })} />}>
      {c && (
        <>
          <Row label="Color">
            <ColorInput label="Colorize color" value={c.color} onChange={(color) => run("Colorize color", { clip_ids: ids, color })} />
          </Row>
          <SliderRow clip={clip} path="adjust.colorize.amount" label="Amount" min={0} max={100} unit="%" reset={COLORIZE_DEFAULT.amount} {...pct} />
        </>
      )}
      <p className="insp-hint">White becomes the color and black stays black: what makes a white glow or logo amber, which warming cannot.</p>
    </Section>
  );
}
