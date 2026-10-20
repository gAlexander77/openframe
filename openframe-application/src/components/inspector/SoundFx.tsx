// The Audio tab's Effects section (ADR-060): low-pass and high-pass with
// a keyframeable cutoff, reverb from a preset, echo, tape stop. Every
// switch runs the command an agent would (set_audio_filter, set_reverb,
// set_echo, set_tape_stop); the sliders set the stored values by path, so
// mixes and cutoffs key at the playhead as any slider does.

import { useLayoutEffect, useRef, useState } from "react";
import { runCommand } from "../../lib/commands";
import { setParam } from "../../lib/project/ops";
import type { AudioClip, VideoClip } from "../../lib/project/types";
import { FILTER_DEFAULTS, FX_RANGES, fxParamAt, REVERB_PRESETS, type FilterKind, type ReverbPreset } from "../../lib/soundFx";
import { edit } from "../../state/actions";
import { store } from "../../state/store";
import { KeyCluster, rangeGesture, Row, Section, Segmented, SliderRow, Toggle, useCommitOnLeave, useRel } from "./controls";
import { parseTyped } from "../../lib/numberInput";

const pct = { show: (v: number) => v * 100, store: (v: number) => v / 100 };
const FILTER_LABELS: Record<FilterKind, string> = { lowpass: "Low-pass", highpass: "High-pass" };
const REVERB_LABELS: Record<ReverbPreset | "off", string> = { off: "Off", room: "Room", hall: "Hall", cathedral: "Cathedral" };

/** Which preset a reverb is, or custom once a value moves. */
const reverbPreset = (r: AudioClip["reverb"]): ReverbPreset | "off" | "custom" =>
  !r ? "off" : ((Object.keys(REVERB_PRESETS) as ReverbPreset[]).find((k) => (["size", "decay", "mix"] as const).every((f) => Math.abs(REVERB_PRESETS[k][f] - r[f]) < 1e-9)) ?? "custom");

export function SoundFxSection({ clip }: { clip: AudioClip | VideoClip }) {
  // What a switch just turned on scrolls into view with its rows, so they
  // never open under the inspector's fold (the Reverb row used to drop
  // out of sight when Low-pass opened its two rows above it).
  const box = useRef<HTMLDivElement>(null);
  const turnedOn = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!turnedOn.current) return;
    box.current?.querySelector(`[data-fx="${turnedOn.current}"]`)?.scrollIntoView?.({ block: "nearest" });
    turnedOn.current = null;
  });
  const run = (label: string, name: string, args: Record<string, unknown>, fx?: string) => {
    if (fx && !args.off) turnedOn.current = fx;
    edit(label, (p) => runCommand(p, name, { clip_ids: [clip.id], ...args }));
  };
  const any = !!(clip.lowpass || clip.highpass || clip.reverb || clip.echo || clip.tapeStop);
  const reset = () =>
    edit("Remove sound effects", (p) =>
      [
        ["set_audio_filter", { type: "lowpass", off: true }],
        ["set_audio_filter", { type: "highpass", off: true }],
        ["set_reverb", { off: true }],
        ["set_echo", { off: true }],
        ["set_tape_stop", { off: true }],
      ].reduce((q, [name, args]) => runCommand(q, name as string, { clip_ids: [clip.id], ...(args as object) }), p),
    );
  return (
    <Section title="Effects" defaultOpen={any} onReset={any ? reset : undefined}>
      <div ref={box}>
        {(["lowpass", "highpass"] as const).map((kind) => (
          <div key={kind} data-fx={kind}>
            <Row label={FILTER_LABELS[kind]}>
              <Toggle label={FILTER_LABELS[kind]} on={!!clip[kind]} onChange={(on) => run(`${FILTER_LABELS[kind]} ${on ? "on" : "off"}`, "set_audio_filter", { type: kind, ...(on ? {} : { off: true }) }, kind)} />
            </Row>
            {clip[kind] && (
              <>
                <CutoffRow clip={clip} kind={kind} />
                <SliderRow clip={clip} path={`${kind}.resonance`} label="Resonance" min={0} max={24} step={0.5} digits={1} unit="dB" reset={0} keyframes={false} />
                <SliderRow clip={clip} path={`${kind}.makeup`} label="Makeup" min={-24} max={24} step={0.5} digits={1} unit="dB" reset={0} keyframes={false} />
              </>
            )}
          </div>
        ))}
        <div data-fx="reverb">
          <Row label="Reverb">
            <Segmented
              value={reverbPreset(clip.reverb)}
              onChange={(v) => v !== "custom" && run(v === "off" ? "Reverb off" : `Reverb: ${REVERB_LABELS[v]}`, "set_reverb", v === "off" ? { off: true } : { preset: v }, "reverb")}
              options={(Object.keys(REVERB_LABELS) as (keyof typeof REVERB_LABELS)[]).map((value) => ({ value, label: REVERB_LABELS[value] }))}
            />
          </Row>
          {clip.reverb && (
            <>
              <SliderRow clip={clip} path="reverb.mix" label="Reverb mix" min={0} max={100} unit="%" reset={REVERB_PRESETS.hall.mix} {...pct} />
              <SliderRow clip={clip} path="reverb.decay" label="Decay" min={0.1} max={10} step={0.1} digits={1} unit="s" reset={REVERB_PRESETS.hall.decay} keyframes={false} />
              <SliderRow clip={clip} path="reverb.size" label="Size" min={0} max={100} unit="%" reset={REVERB_PRESETS.hall.size} keyframes={false} {...pct} />
            </>
          )}
        </div>
        <div data-fx="echo">
          <Row label="Echo">
            <Toggle label="Echo" on={!!clip.echo} onChange={(on) => run(on ? "Echo on" : "Echo off", "set_echo", on ? {} : { off: true }, "echo")} />
          </Row>
          {clip.echo && (
            <>
              <SliderRow clip={clip} path="echo.time" label="Delay" min={0.01} max={2} step={0.01} digits={2} unit="s" reset={0.35} keyframes={false} />
              <SliderRow clip={clip} path="echo.feedback" label="Feedback" min={0} max={90} unit="%" reset={0.4} keyframes={false} {...pct} />
              <SliderRow clip={clip} path="echo.mix" label="Echo mix" min={0} max={100} unit="%" reset={0.3} {...pct} />
            </>
          )}
        </div>
        <div data-fx="tapeStop">
          <Row label="Tape stop">
            <Toggle label="Tape stop" on={!!clip.tapeStop} onChange={(on) => run(on ? "Tape stop on" : "Tape stop off", "set_tape_stop", on ? {} : { off: true }, "tapeStop")} />
          </Row>
          {clip.tapeStop && <SliderRow clip={clip} path="tapeStop.duration" label="Stop over" min={0.05} max={10} step={0.05} digits={2} unit="s" reset={1} keyframes={false} />}
        </div>
      </div>
      {!any && <p className="insp-hint">Muffle a build with Low-pass and key its cutoff open on the drop; put a voice in a room; end on a tape stop.</p>}
    </Section>
  );
}

const [MIN_HZ, MAX_HZ] = FX_RANGES.lowpass.cutoff;
/** Slider position (0..1000) to Hz and back: octaves, as a filter knob. */
const toPos = (hz: number) => (Math.log(hz / MIN_HZ) / Math.log(MAX_HZ / MIN_HZ)) * 1000;
const fromPos = (x: number) => MIN_HZ * (MAX_HZ / MIN_HZ) ** (x / 1000);

/** The cutoff on a log slider, typed in Hz, keyed at the playhead. */
function CutoffRow({ clip, kind }: { clip: AudioClip | VideoClip; kind: FilterKind }) {
  const path = `${kind}.cutoff`;
  const rel = useRel(clip);
  const value = fxParamAt(clip, path, rel);
  const [text, setText] = useState<string | null>(null);
  const set = (hz: number) => (p: Parameters<typeof setParam>[0]) => setParam(p, [clip.id], path, Math.round(Math.min(MAX_HZ, Math.max(MIN_HZ, hz))), rel);
  const label = `${FILTER_LABELS[kind]} cutoff`;
  const commit = (raw: string) => {
    setText(null);
    const n = parseTyped(raw);
    if (n !== null && n > 0) store.edit(`Set ${label.toLowerCase()}`, set(n));
  };
  useCommitOnLeave(text, commit);
  return (
    <div className="insp-row">
      <label className="insp-label">Cutoff</label>
      <input
        type="range"
        className="insp-slider"
        min={0}
        max={1000}
        value={toPos(value)}
        {...rangeGesture(`Set ${label.toLowerCase()}`)}
        onChange={(e) => store.previewGesture(set(fromPos(Number(e.target.value))), `Set ${label.toLowerCase()}`)}
        onDoubleClick={() => store.edit(`Reset ${label.toLowerCase()}`, set(FILTER_DEFAULTS[kind].cutoff))}
        aria-label={label}
      />
      <span className="insp-num">
        <input
          className="field num"
          value={text ?? String(Math.round(value))}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => text !== null && commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setText(null);
          }}
          aria-label={`${label} value`}
        />
        <span className="insp-unit">Hz</span>
      </span>
      <KeyCluster clip={clip} path={path} value={value} />
    </div>
  );
}
