import { useState } from "react";
import { Eye, EyeOff, Plus, Sparkles, Trash2 } from "../../icons";
import { fromDb, toDb } from "../../lib/audio";
import { ANIMATIONS, EFFECTS, FILTERS, TRANSITIONS, effectDefaults } from "../../lib/catalog";
import { DEFAULT_ADJUST, DEFAULT_TRANSFORM, uid } from "../../lib/project/defaults";
import * as ops from "../../lib/project/ops";
import type { Animation, BlendMode, Clip, Effect, Id, Mask, Project, TextClip, TextStyle, VideoClip } from "../../lib/project/types";
import { FPS_PRESETS, formatDuration, formatTimecode, framesToSeconds, secondsToFrames } from "../../lib/time";
import { captionClips, styleAllCaptions } from "../../state/captions";
import { edit, run } from "../../state/actions";
import { store, useEditor } from "../../state/store";
import { ColorInput, patchClip, Row, Section, Segmented, SliderRow, Toggle, useClip } from "./controls";
import "./inspector.css";

type Tab = "video" | "audio" | "speed" | "animation" | "adjust" | "text" | "captions" | "transition";

const TAB_LABEL: Record<Tab, string> = {
  video: "Video",
  audio: "Audio",
  speed: "Speed",
  animation: "Animation",
  adjust: "Adjust",
  text: "Text",
  captions: "Captions",
  transition: "Transition",
};

/** CapCut's tab matrix (research §3.0). */
function tabsFor(c: Clip, p: Project): Tab[] {
  const tr = "transitionOut" in c && c.transitionOut ? (["transition"] as Tab[]) : [];
  const hasSound = c.type === "video" && (ops.getAsset(p, c.assetId)?.hasAudio ?? false);
  switch (c.type) {
    case "video":
      return ["video", ...(hasSound ? (["audio"] as Tab[]) : []), "speed", "animation", "adjust", ...tr];
    case "image":
    case "color":
      return ["video", "animation", "adjust", ...tr];
    case "text":
      return c.caption ? ["text", "captions", "animation"] : ["text", "animation", ...tr];
    case "audio":
      return ["audio", "speed"];
    case "adjustment":
      return ["adjust"];
  }
}

export function InspectorPanel() {
  const sel = useEditor((s) => s.selection);
  return (
    <section className="panel inspector-panel" aria-label="Inspector">
      {sel.length === 0 ? <ProjectDetails /> : sel.length === 1 ? <ClipInspector key={sel[0]} id={sel[0]} /> : <MultiSelection count={sel.length} />}
    </section>
  );
}

function ClipInspector({ id }: { id: Id }) {
  const clip = useClip(id);
  const project = useEditor((s) => s.project);
  const [tab, setTab] = useState<Tab | null>(null);
  if (!clip) return null;
  const tabs = tabsFor(clip, project);
  const active = tab && tabs.includes(tab) ? tab : tabs[0];
  return (
    <>
      <nav className="insp-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t} role="tab" aria-selected={active === t} className={active === t ? "on" : ""} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </nav>
      <div className="insp-body" key={active}>
        {active === "video" && <VideoTab clip={clip} />}
        {active === "audio" && <AudioTab clip={clip} />}
        {active === "speed" && <SpeedTab clip={clip as VideoClip} />}
        {active === "animation" && <AnimationTab clip={clip} />}
        {active === "adjust" && <AdjustTab clip={clip} />}
        {active === "text" && <TextTab clip={clip as TextClip} />}
        {active === "captions" && <CaptionList current={clip.id} />}
        {active === "transition" && <TransitionTab clip={clip} />}
      </div>
    </>
  );
}

// ---- video -------------------------------------------------------------------

const pct = { show: (v: number) => v * 100, store: (v: number) => v / 100 };

function TransformSection({ clip }: { clip: Clip }) {
  const w = useEditor((s) => s.project.width);
  const h = useEditor((s) => s.project.height);
  if (!("transform" in clip)) return null;
  return (
    <Section
      title="Transform"
      onReset={() => patchClip(clip.id, "Reset transform", (c) => ({ ...c, transform: { ...DEFAULT_TRANSFORM }, keyframes: stripKeys(c, "transform.") }) as Clip)}
    >
      <SliderRow clip={clip} path="transform.scale" label="Scale" min={1} max={500} unit="%" reset={1} {...pct} />
      <SliderRow clip={clip} path="transform.x" label="Position X" min={-w} max={w} unit="px" reset={0} show={(v) => v * w} store={(v) => v / w} />
      <SliderRow clip={clip} path="transform.y" label="Position Y" min={-h} max={h} unit="px" reset={0} show={(v) => -v * h} store={(v) => -v / h} />
      <SliderRow clip={clip} path="transform.rotation" label="Rotate" min={-360} max={360} step={0.1} digits={1} unit="°" reset={0} />
    </Section>
  );
}

function stripKeys(c: Clip, prefix: string) {
  if (!c.keyframes) return undefined;
  const k = Object.fromEntries(Object.entries(c.keyframes).filter(([p]) => !p.startsWith(prefix)));
  return Object.keys(k).length ? k : undefined;
}

const BLENDS: [BlendMode, string][] = [
  ["normal", "Normal"], ["darken", "Darken"], ["multiply", "Multiply"], ["colorBurn", "Color burn"],
  ["lighten", "Lighten"], ["screen", "Screen"], ["colorDodge", "Color dodge"], ["add", "Add"],
  ["overlay", "Overlay"], ["softLight", "Soft light"], ["hardLight", "Hard light"],
  ["difference", "Difference"], ["exclusion", "Exclusion"],
];

function VideoTab({ clip }: { clip: Clip }) {
  const [sub, setSub] = useState<"basic" | "mask" | "key">("basic");
  if (!("transform" in clip)) return null;
  return (
    <>
      <div className="insp-sub">
        <Segmented
          value={sub}
          onChange={setSub}
          options={[
            { value: "basic", label: "Basic" },
            { value: "mask", label: "Mask" },
            { value: "key", label: "Chroma key" },
          ]}
        />
      </div>
      {sub === "basic" && (
        <>
          <TransformSection clip={clip} />
          <Section title="Blend" onReset={() => patchClip(clip.id, "Reset blend", (c) => ({ ...c, blend: "normal", opacity: 1, keyframes: stripKeys(c, "opacity") }) as Clip)}>
            <Row label="Mode">
              <select className="field" value={clip.blend} onChange={(e) => patchClip(clip.id, "Blend mode", (c) => ({ ...c, blend: e.target.value as BlendMode }) as Clip)}>
                {BLENDS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Row>
            <SliderRow clip={clip} path="opacity" label="Opacity" min={0} max={100} unit="%" reset={1} {...pct} />
          </Section>
          {clip.type === "color" && (
            <Section title="Color">
              <Row label="Fill">
                <ColorInput label="Fill color" value={clip.color} onChange={(v) => patchClip(clip.id, "Color", (c) => ({ ...c, color: v }) as Clip)} />
              </Row>
            </Section>
          )}
          <Section title="Crop" defaultOpen={false} onReset={() => patchClip(clip.id, "Reset crop", (c) => ({ ...c, crop: { left: 0, top: 0, right: 0, bottom: 0 } }) as Clip)}>
            {(["left", "top", "right", "bottom"] as const).map((k) => (
              <SliderRow key={k} clip={clip} path={`crop.${k}`} label={k[0].toUpperCase() + k.slice(1)} min={0} max={95} unit="%" reset={0} keyframes={false} {...pct} />
            ))}
          </Section>
        </>
      )}
      {sub === "mask" && <MaskSection clip={clip} />}
      {sub === "key" && <ChromaSection clip={clip} />}
    </>
  );
}

const MASK_SHAPES: [Mask["shape"] | "none", string][] = [["none", "None"], ["linear", "Linear"], ["mirror", "Mirror"], ["circle", "Circle"], ["rectangle", "Rectangle"]];

function MaskSection({ clip }: { clip: Clip }) {
  if (!("transform" in clip)) return null;
  const m = clip.mask;
  const setShape = (shape: Mask["shape"] | "none") =>
    patchClip(clip.id, "Mask", (c) => {
      const next = { ...c } as Clip & { mask?: Mask };
      if (shape === "none") delete next.mask;
      else next.mask = { x: 0, y: 0, width: 0.6, height: 0.6, rotation: 0, feather: 0.05, invert: false, ...m, shape };
      return next;
    });
  return (
    <Section title="Mask">
      <div className="mask-shapes">
        {MASK_SHAPES.map(([v, l]) => (
          <button key={v} className={`mask-shape ms-${v}${(m?.shape ?? "none") === v ? " on" : ""}`} onClick={() => setShape(v)}>
            <span className="ms-icon" />
            <span>{l}</span>
          </button>
        ))}
      </div>
      {m && (
        <>
          <SliderRow clip={clip} path="mask.x" label="Position X" min={-100} max={100} unit="%" reset={0} {...pct} />
          <SliderRow clip={clip} path="mask.y" label="Position Y" min={-100} max={100} unit="%" reset={0} {...pct} />
          {m.shape !== "linear" && <SliderRow clip={clip} path="mask.width" label={m.shape === "mirror" ? "Width" : "Width"} min={1} max={200} unit="%" reset={0.6} {...pct} />}
          {(m.shape === "circle" || m.shape === "rectangle" || m.shape === "mirror") && <SliderRow clip={clip} path="mask.height" label="Height" min={1} max={200} unit="%" reset={0.6} {...pct} />}
          <SliderRow clip={clip} path="mask.rotation" label="Rotate" min={-180} max={180} unit="°" reset={0} />
          <SliderRow clip={clip} path="mask.feather" label="Feather" min={0} max={100} unit="%" reset={0.05} {...pct} />
          <Row label="Invert">
            <Toggle label="Invert mask" on={m.invert} onChange={(v) => patchClip(clip.id, "Invert mask", (c) => ({ ...c, mask: { ...m, invert: v } }) as Clip)} />
          </Row>
        </>
      )}
    </Section>
  );
}

function ChromaSection({ clip }: { clip: Clip }) {
  if (!("transform" in clip)) return null;
  const k = clip.chromaKey;
  const set = (patch: Partial<NonNullable<typeof k>>, label: string) =>
    patchClip(clip.id, label, (c) => ({ ...c, chromaKey: { enabled: true, color: "#00b140", similarity: 0.4, smoothness: 0.1, spill: 0.3, ...k, ...patch } }) as Clip);
  return (
    <Section title="Chroma key" extra={<Toggle label="Chroma key" on={!!k?.enabled} onChange={(v) => set({ enabled: v }, v ? "Chroma key on" : "Chroma key off")} />}>
      {k?.enabled ? (
        <>
          <Row label="Key color">
            <ColorInput label="Key color" value={k.color} onChange={(v) => set({ color: v }, "Key color")} />
          </Row>
          <SliderRow clip={clip} path="chromaKey.similarity" label="Strength" min={0} max={100} unit="" reset={0.4} {...pct} />
          <SliderRow clip={clip} path="chromaKey.smoothness" label="Edge feather" min={0} max={100} reset={0.1} {...pct} />
          <SliderRow clip={clip} path="chromaKey.spill" label="Spill removal" min={0} max={100} reset={0.3} {...pct} />
        </>
      ) : (
        <p className="insp-hint">Turn on to remove a green or blue background. Pick the screen's color with the swatch.</p>
      )}
    </Section>
  );
}

// ---- audio -------------------------------------------------------------------

function AudioTab({ clip }: { clip: Clip }) {
  const fps = useEditor((s) => s.project.fps);
  if (!("volume" in clip)) return null;
  const secs = { show: (v: number) => framesToSeconds(v, fps), store: (v: number) => secondsToFrames(v, fps) };
  const maxFade = framesToSeconds(Math.floor(clip.duration / 2), fps);
  return (
    <>
      <Section title="Basic" onReset={() => patchClip(clip.id, "Reset audio", (c) => ({ ...c, volume: 1, pan: 0, fadeIn: 0, fadeOut: 0, keyframes: stripKeys(c, "volume") }) as Clip)}>
        <SliderRow clip={clip} path="volume" label="Volume" min={-60} max={12} step={0.1} digits={1} unit="dB" reset={1} show={(v) => Math.max(-60, toDb(v))} store={(db) => (db <= -60 ? 0 : fromDb(db))} />
        <SliderRow clip={clip} path="fadeIn" label="Fade in" min={0} max={+maxFade.toFixed(1)} step={0.1} digits={1} unit="s" reset={0} keyframes={false} {...secs} />
        <SliderRow clip={clip} path="fadeOut" label="Fade out" min={0} max={+maxFade.toFixed(1)} step={0.1} digits={1} unit="s" reset={0} keyframes={false} {...secs} />
        <SliderRow clip={clip} path="pan" label="Pan" min={-100} max={100} reset={0} keyframes={false} {...pct} />
      </Section>
      {clip.type === "video" && (
        <Section title="Sound">
          <div className="insp-actions">
            <button className="btn" onClick={() => run("detachAudio")}>Extract audio</button>
            <button className="btn ghost" onClick={() => patchClip(clip.id, clip.muted ? "Unmute clip" : "Mute clip", (c) => ({ ...c, muted: !(c as VideoClip).muted }) as Clip)}>
              {clip.muted ? "Unmute clip" : "Mute clip"}
            </button>
          </div>
        </Section>
      )}
    </>
  );
}

// ---- speed -------------------------------------------------------------------

const SPEED_MIN = 0.1;
const SPEED_MAX = 100;
const toLog = (s: number) => Math.log(s / SPEED_MIN) / Math.log(SPEED_MAX / SPEED_MIN);
const fromLog = (v: number) => SPEED_MIN * (SPEED_MAX / SPEED_MIN) ** v;

function SpeedTab({ clip }: { clip: VideoClip }) {
  const fps = useEditor((s) => s.project.fps);
  const [text, setText] = useState<string | null>(null);
  const apply = (speed: number) => {
    const s = Math.min(SPEED_MAX, Math.max(SPEED_MIN, +speed.toFixed(2)));
    edit(`Speed ${s}x`, (p) => ops.setSpeed(p, clip.id, s));
  };
  return (
    <Section title="Standard">
      <div className="insp-row">
        <label className="insp-label">Speed</label>
        <input
          type="range"
          className="insp-slider"
          min={0}
          max={1}
          step={0.001}
          value={toLog(clip.speed)}
          onPointerDown={() => store.beginGesture()}
          onPointerUp={() => store.endGesture(`Speed ${clip.speed}x`)}
          onChange={(e) => {
            const s = +fromLog(Number(e.target.value)).toFixed(2);
            store.previewGesture((p) => ops.settle(p, ops.setSpeed(p, clip.id, s), { magnet: store.get().magnet, linkage: store.get().linkage }));
          }}
          aria-label="Speed"
        />
        <span className="insp-num">
          <input
            className="field num"
            value={text ?? clip.speed.toFixed(2)}
            onChange={(e) => setText(e.target.value)}
            onBlur={(e) => {
              setText(null);
              const v = Number(e.target.value.replace(/x/i, ""));
              if (v > 0) apply(v);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            aria-label="Speed value"
          />
          <span className="insp-unit">x</span>
        </span>
        <span className="insp-keys" />
      </div>
      <div className="speed-presets">
        {[0.25, 0.5, 1, 1.5, 2, 4].map((s) => (
          <button key={s} className={`chip-btn${clip.speed === s ? " on" : ""}`} onClick={() => apply(s)}>
            {s}x
          </button>
        ))}
      </div>
      <p className="insp-hint num">Duration {formatDuration(framesToSeconds(clip.duration, fps))}. Later clips on the track move with the change.</p>
    </Section>
  );
}

// ---- animation -----------------------------------------------------------------

function AnimationTab({ clip }: { clip: Clip }) {
  const fps = useEditor((s) => s.project.fps);
  const [slot, setSlot] = useState<"in" | "out" | "loop">("in");
  if (!("transform" in clip)) return null;
  const key = slot === "in" ? "animIn" : slot === "out" ? "animOut" : "animLoop";
  const current = (clip as unknown as Record<string, Animation | undefined>)[key];
  const list = Object.entries(ANIMATIONS).filter(([, d]) => (slot === "loop" ? !!d.loop : !!d.from));
  const set = (type: string | null, duration?: number) =>
    patchClip(clip.id, type ? `${slot === "loop" ? "Loop" : slot === "in" ? "In" : "Out"} animation` : "Remove animation", (c) => {
      const next = { ...c } as Record<string, unknown>;
      if (!type) delete next[key];
      else next[key] = { type, duration: duration ?? current?.duration ?? secondsToFrames(slot === "loop" ? 1 : 0.5, fps) };
      return next as unknown as Clip;
    });
  return (
    <>
      <div className="insp-sub">
        <Segmented value={slot} onChange={setSlot} options={[{ value: "in", label: "In" }, { value: "out", label: "Out" }, { value: "loop", label: clip.type === "text" ? "Loop" : "Combo" }]} />
      </div>
      <div className="anim-grid">
        <button className={`anim-tile${!current ? " on" : ""}`} onClick={() => set(null)}>
          <span className="anim-demo none" />
          <span>None</span>
        </button>
        {list.map(([k, d]) => (
          <button key={k} className={`anim-tile${current?.type === k ? " on" : ""}`} onClick={() => set(k)}>
            <span className={`anim-demo a-${k} slot-${slot}`} />
            <span>{d.label}</span>
          </button>
        ))}
      </div>
      {current && (
        <Section title={slot === "loop" ? "Cycle" : "Duration"}>
          <div className="insp-row">
            <label className="insp-label">{slot === "loop" ? "Cycle" : "Duration"}</label>
            <input
              type="range"
              className="insp-slider"
              min={0.1}
              max={Math.max(0.2, +framesToSeconds(slot === "loop" ? clip.duration : Math.floor(clip.duration / (slot === "in" && "animOut" in clip && clip.animOut ? 2 : 1)), fps).toFixed(1))}
              step={0.1}
              value={framesToSeconds(current.duration, fps)}
              onChange={(e) => set(current.type, Math.max(1, secondsToFrames(Number(e.target.value), fps)))}
              aria-label="Animation duration"
            />
            <span className="insp-num num">{framesToSeconds(current.duration, fps).toFixed(1)}<span className="insp-unit">s</span></span>
            <span className="insp-keys" />
          </div>
        </Section>
      )}
    </>
  );
}

// ---- adjust ----------------------------------------------------------------------

const TEMP_TRACK = "linear-gradient(90deg, #3a7bd5, #9a9a9a, #e0b13a)";
const TINT_TRACK = "linear-gradient(90deg, #3fae54, #9a9a9a, #c94fc0)";
const SAT_TRACK = "linear-gradient(90deg, #8a8a8a, #e0453a)";

function AdjustTab({ clip }: { clip: Clip }) {
  if (!("adjust" in clip)) return null;
  const a = (path: keyof typeof DEFAULT_ADJUST, label: string, min = -100, track?: string) => (
    <SliderRow key={path} clip={clip} path={`adjust.${path}`} label={label} min={min} max={100} reset={0} track={track} />
  );
  return (
    <>
      <FilterSection clip={clip} />
      <Section title="Color" onReset={() => patchClip(clip.id, "Reset color", (c) => ({ ...c, adjust: { ...DEFAULT_ADJUST }, keyframes: stripKeys(c, "adjust.") }) as Clip)}>
        <h5 className="insp-group">Color</h5>
        {a("temperature", "Temp", -100, TEMP_TRACK)}
        {a("tint", "Tint", -100, TINT_TRACK)}
        {a("saturation", "Saturation", -100, SAT_TRACK)}
        {a("vibrance", "Vibrance")}
        {a("hue", "Hue")}
        <h5 className="insp-group">Light</h5>
        {a("exposure", "Exposure")}
        {a("brightness", "Brightness")}
        {a("contrast", "Contrast")}
        {a("highlights", "Highlights")}
        {a("shadows", "Shadows")}
        {a("whites", "Whites")}
        {a("blacks", "Blacks")}
        <h5 className="insp-group">Effects</h5>
        {a("sharpen", "Sharpen", 0)}
        {a("grain", "Grain", 0)}
        {a("fade", "Fade", 0)}
        {a("vignette", "Vignette", 0)}
      </Section>
      <EffectsSection clip={clip} />
    </>
  );
}

function FilterSection({ clip }: { clip: Clip }) {
  if (!("adjust" in clip)) return null;
  const f = clip.filter;
  return (
    <Section title="Filter" extra={f ? <button className="icon-btn small" aria-label="Remove filter" data-tip="Remove filter" onClick={() => patchClip(clip.id, "Remove filter", (c) => { const n = { ...c } as Clip & { filter?: unknown }; delete n.filter; return n; })}><Trash2 size={12} /></button> : undefined}>
      <Row label="Look">
        <select
          className="field"
          value={f?.type ?? ""}
          onChange={(e) => patchClip(clip.id, "Filter", (c) => (e.target.value ? ({ ...c, filter: { type: e.target.value, intensity: f?.intensity ?? 1 } } as Clip) : (() => { const n = { ...c } as Clip & { filter?: unknown }; delete n.filter; return n; })()))}
        >
          <option value="">None</option>
          {Object.entries(FILTERS).map(([k, d]) => (
            <option key={k} value={k}>
              {d.label}
            </option>
          ))}
        </select>
      </Row>
      {f && <SliderRow clip={clip} path="filter.intensity" label="Intensity" min={0} max={100} unit="%" reset={1} keyframes={false} {...pct} />}
    </Section>
  );
}

function EffectsSection({ clip }: { clip: Clip }) {
  const [adding, setAdding] = useState(false);
  if (!("effects" in clip)) return null;
  const add = (type: string) => {
    patchClip(clip.id, `Add ${EFFECTS[type].label.toLowerCase()}`, (c) => ({ ...c, effects: [...(c as { effects: Effect[] }).effects, { id: uid("fx"), type, enabled: true, params: effectDefaults(type) }] }) as Clip);
    setAdding(false);
  };
  return (
    <Section
      title="Effects"
      extra={
        <button className="icon-btn small" aria-label="Add effect" data-tip="Add effect" onClick={() => setAdding(!adding)}>
          <Plus size={13} />
        </button>
      }
    >
      {adding && (
        <div className="fx-picker">
          {Object.entries(EFFECTS).map(([k, d]) => (
            <button key={k} className="chip-btn" onClick={() => add(k)}>
              {d.label}
            </button>
          ))}
        </div>
      )}
      {clip.effects.length === 0 && !adding && <p className="insp-hint">No effects. Add one here or drag one from the Effects tab onto the clip.</p>}
      {clip.effects.map((fx) => {
        const def = EFFECTS[fx.type];
        if (!def) return null;
        return (
          <div key={fx.id} className={`fx-card${fx.enabled ? "" : " off"}`}>
            <div className="fx-head">
              <Sparkles size={12} />
              <span>{def.label}</span>
              <button className="icon-btn small" aria-label={fx.enabled ? "Disable effect" : "Enable effect"} onClick={() => patchClip(clip.id, fx.enabled ? "Disable effect" : "Enable effect", (c) => ({ ...c, effects: (c as { effects: typeof clip.effects }).effects.map((e) => (e.id === fx.id ? { ...e, enabled: !e.enabled } : e)) }) as Clip)}>
                {fx.enabled ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
              <button className="icon-btn small" aria-label="Remove effect" onClick={() => patchClip(clip.id, "Remove effect", (c) => ({ ...c, effects: (c as { effects: typeof clip.effects }).effects.filter((e) => e.id !== fx.id), keyframes: stripKeys(c, `effects.${fx.id}.`) }) as Clip)}>
                <Trash2 size={12} />
              </button>
            </div>
            {Object.entries(def.params).map(([k, pd]) => (
              <SliderRow key={k} clip={clip} path={`effects.${fx.id}.${k}`} label={pd.label} min={pd.min} max={pd.max} step={pd.step} reset={pd.default} />
            ))}
          </div>
        );
      })}
    </Section>
  );
}

// ---- text --------------------------------------------------------------------------

const FONTS = ["Inter", "Segoe UI", "Arial", "Arial Black", "Helvetica", "Georgia", "Times New Roman", "Trebuchet MS", "Verdana", "Tahoma", "Impact", "Courier New", "Comic Sans MS"];

function TextTab({ clip }: { clip: TextClip }) {
  const s = clip.style;
  const style = (patch: Partial<TextStyle>, label: string) => patchClip(clip.id, label, (c) => ({ ...c, style: { ...(c as TextClip).style, ...patch } }) as Clip);
  return (
    <>
      {clip.caption && (
        <div className="insp-banner">
          <span>Caption · style changes apply to this caption only</span>
          <button className="btn" onClick={() => styleAllCaptions(clip.style, clip.transform.y)}>
            Apply to all captions
          </button>
        </div>
      )}
      <Section title="Text">
        <textarea
          className="field text-area"
          defaultValue={clip.text}
          key={clip.id}
          rows={3}
          onBlur={(e) => e.target.value !== clip.text && patchClip(clip.id, "Edit text", (c) => ({ ...c, text: e.target.value }) as Clip)}
          onKeyDown={(e) => e.key === "Escape" && (e.target as HTMLTextAreaElement).blur()}
          aria-label="Text"
        />
        <Row label="Font">
          <select className="field" value={s.font} onChange={(e) => style({ font: e.target.value }, "Font")}>
            {FONTS.map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>
                {f}
              </option>
            ))}
          </select>
        </Row>
        <SliderRow clip={clip} path="style.size" label="Size" min={8} max={400} reset={96} keyframes={false} />
        <Row label="Style">
          <div className="style-toggles">
            <button className={`chip-btn bold${s.bold ? " on" : ""}`} aria-pressed={s.bold} onClick={() => style({ bold: !s.bold }, "Bold")}>B</button>
            <button className={`chip-btn italic${s.italic ? " on" : ""}`} aria-pressed={s.italic} onClick={() => style({ italic: !s.italic }, "Italic")}>I</button>
            <button className={`chip-btn underline${s.underline ? " on" : ""}`} aria-pressed={s.underline} onClick={() => style({ underline: !s.underline }, "Underline")}>U</button>
            <Segmented value={s.align} onChange={(v) => style({ align: v }, "Align")} options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }]} />
          </div>
        </Row>
        <Row label="Color">
          <ColorInput label="Text color" value={s.color} onChange={(v) => style({ color: v }, "Text color")} />
        </Row>
        <SliderRow clip={clip} path="style.letterSpacing" label="Spacing" min={-20} max={100} reset={0} keyframes={false} />
        <SliderRow clip={clip} path="style.lineHeight" label="Line height" min={0.6} max={3} step={0.05} digits={2} reset={1.2} keyframes={false} />
      </Section>
      <Section title="Stroke" extra={<Toggle label="Stroke" on={!!s.stroke && s.stroke.width > 0} onChange={(v) => style({ stroke: { color: s.stroke?.color ?? "#000000", width: v ? Math.max(4, s.stroke?.width ?? 0) : 0 } }, v ? "Add stroke" : "Remove stroke")} />}>
        {s.stroke && s.stroke.width > 0 && (
          <>
            <Row label="Color">
              <ColorInput label="Stroke color" value={s.stroke.color} onChange={(v) => style({ stroke: { ...s.stroke!, color: v } }, "Stroke color")} />
            </Row>
            <SliderRow clip={clip} path="style.stroke.width" label="Width" min={0} max={40} reset={4} keyframes={false} />
          </>
        )}
      </Section>
      <Section title="Shadow" extra={<Toggle label="Shadow" on={!!s.shadow} onChange={(v) => style({ shadow: v ? { color: "#000000aa", blur: 12, x: 4, y: 6 } : undefined }, v ? "Add shadow" : "Remove shadow")} />}>
        {s.shadow && (
          <>
            <Row label="Color">
              <ColorInput label="Shadow color" value={s.shadow.color} onChange={(v) => style({ shadow: { ...s.shadow!, color: v } }, "Shadow color")} />
            </Row>
            <SliderRow clip={clip} path="style.shadow.blur" label="Blur" min={0} max={80} reset={12} keyframes={false} />
            <SliderRow clip={clip} path="style.shadow.x" label="Offset X" min={-60} max={60} reset={4} keyframes={false} />
            <SliderRow clip={clip} path="style.shadow.y" label="Offset Y" min={-60} max={60} reset={6} keyframes={false} />
          </>
        )}
      </Section>
      <Section title="Background" extra={<Toggle label="Background" on={!!s.background} onChange={(v) => style({ background: v ? { color: "#000000cc", padding: 16, radius: 8 } : undefined }, v ? "Add background" : "Remove background")} />}>
        {s.background && (
          <>
            <Row label="Color">
              <ColorInput label="Background color" value={s.background.color} onChange={(v) => style({ background: { ...s.background!, color: v } }, "Background color")} />
            </Row>
            <SliderRow clip={clip} path="style.background.padding" label="Padding" min={0} max={80} reset={16} keyframes={false} />
            <SliderRow clip={clip} path="style.background.radius" label="Corners" min={0} max={80} reset={8} keyframes={false} />
          </>
        )}
      </Section>
      <TransformSection clip={clip} />
      <Section title="Opacity" defaultOpen={false}>
        <SliderRow clip={clip} path="opacity" label="Opacity" min={0} max={100} unit="%" reset={1} {...pct} />
      </Section>
    </>
  );
}

// ---- captions list ----------------------------------------------------------------

/** CapCut's caption list: every caption with its time, editable in place;
 * clicking a row moves the playhead there and selects that caption. */
function CaptionList({ current }: { current: Id }) {
  const p = useEditor((s) => s.project);
  const caps = captionClips(p);
  return (
    <div className="cap-list">
      {caps.map((c, i) => (
        <div key={c.id} className={`cap-row${c.id === current ? " on" : ""}`} onClick={() => { store.seek(c.start); store.select([c.id]); }}>
          <span className="cap-index num">{i + 1}</span>
          <span className="cap-time num">{formatTimecode(c.start, p.fps)}</span>
          <textarea
            className="cap-text"
            defaultValue={c.text}
            key={c.text}
            rows={1}
            onClick={(e) => e.stopPropagation()}
            onFocus={() => store.seek(c.start)}
            onBlur={(e) => e.target.value !== c.text && patchClip(c.id, "Edit caption", (x) => ({ ...x, text: e.target.value }) as Clip)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
            aria-label={`Caption ${i + 1}`}
          />
        </div>
      ))}
    </div>
  );
}

// ---- transition ----------------------------------------------------------------

function TransitionTab({ clip }: { clip: Clip }) {
  const fps = useEditor((s) => s.project.fps);
  const tr = "transitionOut" in clip ? clip.transitionOut : undefined;
  if (!tr) return null;
  const set = (type: string, duration: number) => edit("Transition", (p) => ops.setTransition(p, clip.id, { type, duration }));
  const applyAll = () =>
    edit("Apply transition to all", (p) => {
      const loc = ops.findClip(p, clip.id);
      if (!loc) return p;
      for (const c of loc.track.clips) p = ops.setTransition(p, c.id, { ...tr });
      return p;
    });
  return (
    <Section title="Transition">
      <Row label="Type">
        <select className="field" value={tr.type} onChange={(e) => set(e.target.value, tr.duration)}>
          {Object.entries(TRANSITIONS).map(([k, d]) => (
            <option key={k} value={k}>
              {d.label}
            </option>
          ))}
        </select>
      </Row>
      <div className="insp-row">
        <label className="insp-label">Duration</label>
        <input type="range" className="insp-slider" min={0.1} max={5} step={0.1} value={framesToSeconds(tr.duration, fps)} onChange={(e) => set(tr.type, secondsToFrames(Number(e.target.value), fps))} aria-label="Transition duration" />
        <span className="insp-num num">{framesToSeconds(tr.duration, fps).toFixed(1)}<span className="insp-unit">s</span></span>
        <span className="insp-keys" />
      </div>
      <div className="insp-actions">
        <button className="btn" onClick={applyAll}>Apply to all cuts</button>
        <button className="btn ghost" onClick={() => edit("Remove transition", (p) => ops.setTransition(p, clip.id, null))}>
          Remove
        </button>
      </div>
    </Section>
  );
}

// ---- nothing / many selected -----------------------------------------------------

const RATIOS: { label: string; w: number; h: number }[] = [
  { label: "16:9", w: 16, h: 9 },
  { label: "9:16", w: 9, h: 16 },
  { label: "1:1", w: 1, h: 1 },
  { label: "4:5", w: 4, h: 5 },
  { label: "4:3", w: 4, h: 3 },
  { label: "21:9", w: 21, h: 9 },
];
const RESOLUTIONS = [720, 1080, 1440, 2160];

function ProjectDetails() {
  const p = useEditor((s) => s.project);
  const short = Math.min(p.width, p.height);
  const ratio = RATIOS.find((r) => Math.abs(r.w / r.h - p.width / p.height) < 0.01);
  const setCanvas = (rw: number, rh: number, res: number) => {
    // The short side is the "p" resolution, CapCut-style (1080p 9:16 = 1080x1920).
    const even = (n: number) => Math.round(n / 2) * 2;
    const [w, h] = rw >= rh ? [even((res * rw) / rh), res] : [res, even((res * rh) / rw)];
    store.edit("Canvas size", (q) => ({ ...q, width: w, height: h }));
  };
  const fpsLabel = FPS_PRESETS.find((f) => f.fps.num === p.fps.num && f.fps.den === p.fps.den)?.label ?? (p.fps.num / p.fps.den).toFixed(2);
  return (
    <>
      <nav className="insp-tabs">
        <button className="on">Details</button>
      </nav>
      <div className="insp-body">
        <Section title="Project">
          <Row label="Name">
            <input className="field" defaultValue={p.name} key={p.name} onBlur={(e) => e.target.value.trim() && e.target.value !== p.name && store.edit("Rename project", (q) => ({ ...q, name: e.target.value.trim() }))} />
          </Row>
          <Row label="Ratio">
            <div className="ratio-grid">
              {RATIOS.map((r) => (
                <button key={r.label} className={`ratio${ratio === r ? " on" : ""}`} onClick={() => setCanvas(r.w, r.h, short)} data-tip={`${r.label} canvas`}>
                  <span className="ratio-box" style={{ aspectRatio: `${r.w} / ${r.h}` }} />
                  <span>{r.label}</span>
                </button>
              ))}
            </div>
          </Row>
          <Row label="Resolution">
            <select className="field" value={RESOLUTIONS.includes(short) ? short : ""} onChange={(e) => setCanvas(p.width, p.height, Number(e.target.value))}>
              {!RESOLUTIONS.includes(short) && <option value="">{p.width}x{p.height}</option>}
              {RESOLUTIONS.map((r) => (
                <option key={r} value={r}>
                  {r === 2160 ? "4K" : r === 1440 ? "2K" : `${r}p`}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Frame rate">
            <select
              className="field"
              value={fpsLabel}
              onChange={(e) => {
                const f = FPS_PRESETS.find((x) => x.label === e.target.value);
                if (f) store.edit(`${f.label} fps`, (q) => ops.setFps(q, f.fps));
              }}
            >
              {FPS_PRESETS.map((f) => (
                <option key={f.label} value={f.label}>
                  {f.label} fps
                </option>
              ))}
            </select>
          </Row>
          <Row label="Background">
            <ColorInput label="Background color" value={p.background} onChange={(v) => store.edit("Background color", (q) => ({ ...q, background: v }))} />
          </Row>
        </Section>
        <Section title="Summary">
          <dl className="summary num">
            <dt>Canvas</dt>
            <dd>
              {p.width} × {p.height}
            </dd>
            <dt>Duration</dt>
            <dd>{formatDuration(framesToSeconds(ops.projectDuration(p), p.fps))}</dd>
            <dt>Media</dt>
            <dd>{p.assets.length} files</dd>
            <dt>Tracks</dt>
            <dd>{p.tracks.length}</dd>
          </dl>
          <p className="insp-hint">Select a clip on the timeline to edit it. Positions are kept relative to the canvas, so changing the ratio keeps layouts centered.</p>
        </Section>
      </div>
    </>
  );
}

function MultiSelection({ count }: { count: number }) {
  return (
    <>
      <nav className="insp-tabs">
        <button className="on">{count} clips</button>
      </nav>
      <div className="insp-body">
        <Section title="Selection">
          <p className="insp-hint">{count} clips selected. Move, delete, copy or split them together; select one clip to edit its properties.</p>
          <div className="insp-actions">
            <button className="btn" onClick={() => run("duplicate")}>Duplicate</button>
            <button className="btn ghost" onClick={() => run("delete")}>Delete</button>
          </div>
        </Section>
      </div>
    </>
  );
}
