import { LayoutsSection } from "./LayoutsSection";
import { runStyle } from "../../lib/textRuns";
import { EmptyState } from "../EmptyState";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Bold, CaseLower, CaseSensitive, CaseUpper, Crop as CropIcon, Crosshair, Eye, EyeOff, FlipHorizontal2, FlipVertical2, Heart, Italic, Loader2, Pin, PinOff, Plus, Ratio, RotateCcw, WandSparkles, Sparkles, Star, Trash2, Underline, X } from "../../icons";
import { EQ_BANDS, fromDb, soundingClips, toDb } from "../../lib/audio";
import { COMPRESSOR_PRESETS, compressorPreset } from "../../lib/compressor";
import { crossfadeJoin } from "../../lib/crossfadeJoin";
import { MATTE_MODELS } from "../../engine/cutout";
import { clipWindow, covers } from "../../lib/matte";
import { ANIMATIONS, BLEND_MODES, EFFECTS, FILTERS, FONTS, TRANSITIONS } from "../../lib/catalog";
import { DEFAULT_STAGGER, KINETIC_ORDERS, type KineticOrder } from "../../lib/kinetic";
import { animThumb, type ThumbSlot } from "../../lib/animThumb";
import { previewAnimation } from "../../state/apply";
import { brandOf, type ColorRole } from "../../lib/brandKit";
import { runCommand } from "../../lib/commands";
import type { EffectAction } from "../../lib/effectStack";
import { compoundView } from "../../lib/project/compound";
import { DEFAULT_ADJUST, DEFAULT_TRANSFORM } from "../../lib/project/defaults";
import * as ops from "../../lib/project/ops";
import type { Animation, AudioClip, BlendMode, CanvasFill, Clip, CompoundClip, Id, Mask, Project, TextClip, TextStyle, VideoClip, VisualClip } from "../../lib/project/types";
import { frameClips, pictureAspect } from "../../lib/align";
import { footageUnder, underPoint } from "../../lib/anchors";
import { layerAt } from "../../lib/render/plan";
import { MASK_LABELS, MASK_SHAPES, newMask, type MaskShape } from "../../lib/mask";
import { canCrop, NO_CROP } from "../../lib/crop";
import { applyCrop, beginCrop, resetCrop } from "../../state/cropEdit";
import { canvasSize, ratioOf, RATIOS } from "../../lib/canvas";
import { PRESETS } from "../../lib/speed";
import { FPS_PRESETS, formatDuration, formatTimecode, framesToSeconds, secondsToFrames } from "../../lib/time";
import { captionClips, styleAllCaptions } from "../../state/captions";
import { edit, run, settleOptions, tipFor } from "../../state/actions";
import { store, useEditor } from "../../state/store";
import { beginTyping, endTyping, typeText } from "../../state/textEdit";
import { ColorInput, KeyCluster, patchClip, rangeGesture, Row, Section, Segmented, SliderRow, Toggle, useClip, useCommitOnLeave, useRel } from "./controls";
import { parseTyped } from "../../lib/numberInput";
import { colorAt, colorKey } from "../../lib/textAnim";
import { fontWeight, WEIGHT_NAMES } from "../../lib/textLook";
import { useFontWeights } from "../../state/fontWeights";
import { BorderSection, CompositingSection, ShadowSection, ShapeSection } from "./GraphicsSection";
import { SectionKey } from "./KeyTools";
import { SoundFxSection } from "./SoundFx";
import { CurvesPanel } from "./CurvesPanel";
import { HslPanel } from "./HslPanel";
import { LutPanel } from "./LutPanel";
import { ColorizeSection } from "./ColorizeSection";
import { WheelsPanel } from "./WheelsPanel";
import { CurvePreview, SpeedGraph } from "./SpeedGraph";
import { EffectClipboard } from "./EffectClipboard";
import { AttributeClipboard } from "./AttributeClipboard";
import { AlignBar, useMovable } from "./AlignBar";
import { stretchClip } from "../../lib/project/stretch";
import { autoAdjustClip } from "../../state/autoColor";
import { toast } from "../../state/toast";
import { cancelSpeech, textToSpeech, useSpeaking } from "../../state/tts";
import { DEFAULT_VOICE, VOICES } from "../../lib/tts";
import { aiStore, setBackgroundRemoval, stabilizeClip, useAi } from "../../state/ai";
import { applyTextStyle, deleteTextStyle, saveTextStyle, useTextStyles } from "../../state/textStyles";
import { beginTrackBox, cancelTrackBox, cancelTracking, cannotTrack, trackMotion, useTrackBox, useTracking } from "../../state/tracking";
import { LEVELS, type StabilizeLevel } from "../../lib/analysis/stabilize";
import { canListSystemFonts, importFonts, loadSystemFonts, pickFontFiles, useFonts } from "../../state/fonts";
import "./inspector.css";

export type Tab = "video" | "audio" | "speed" | "animation" | "adjust" | "effects" | "text" | "captions" | "transition";

// The clip menu's Speed opens that tab: a request waits for the clip's
// inspector if it is not showing yet (the menu selects the clip first).
let requestedTab: Tab | null = null;
const tabListeners = new Set<(t: Tab) => void>();
/** Show a tab of the selected clip's inspector. */
export function showInspectorTab(t: Tab) {
  requestedTab = t;
  tabListeners.forEach((l) => l(t));
}

const TAB_LABEL: Record<Tab, string> = {
  video: "Video",
  audio: "Audio",
  speed: "Speed",
  animation: "Animation",
  adjust: "Adjust",
  effects: "Effects",
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
      return ["video", ...(hasSound ? (["audio"] as Tab[]) : []), "speed", "animation", "adjust", "effects", ...tr];
    case "image":
    case "color":
      return ["video", "animation", "adjust", "effects", ...tr];
    case "text":
      return c.caption ? ["text", "captions", "animation", "effects"] : ["text", "animation", "effects", ...tr];
    case "audio":
      return ["audio", "speed"];
    case "adjustment":
      return ["adjust", "effects"];
    case "compound":
      return ["video", "audio", "speed", "animation", "adjust", "effects", ...tr];
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
  const [tab, setTab] = useState<Tab | null>(() => {
    const t = requestedTab;
    requestedTab = null;
    return t;
  });
  useEffect(() => {
    const l = (t: Tab) => {
      requestedTab = null;
      setTab(t);
    };
    tabListeners.add(l);
    return () => void tabListeners.delete(l);
  }, []);
  const transitionEdit = useEditor(s => s.transitionEdit);
  if (!clip) return null;
  const tabs = tabsFor(clip, project);
  const active = transitionEdit === id && tabs.includes("transition") ? "transition" : tab && tabs.includes(tab) ? tab : tabs[0];
  return (
    <>
      <nav className="insp-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t} role="tab" aria-selected={active === t} className={active === t ? "on" : ""} onClick={() => { store.set({ transitionEdit: null }); setTab(t); }}>
            {TAB_LABEL[t]}{t === "effects" && "effects" in clip && clip.effects.length > 0 ? ` (${clip.effects.length})` : ""}
          </button>
        ))}
      </nav>
      <div className="insp-body" key={active}>
        <AttributeClipboard clip={clip} />
        {active === "video" && <VideoTab clip={clip} />}
        {active === "audio" && <AudioTab clip={clip} />}
        {active === "speed" && <SpeedTab clip={clip as ops.TimedClip} />}
        {active === "animation" && <AnimationTab clip={clip} />}
        {active === "adjust" && <AdjustTab clip={clip} />}
        {active === "effects" && <EffectsSection clip={clip} />}
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
  const stretched = clip.transform.scaleY !== undefined;
  const paths = ["transform.scale", ...(stretched ? ["transform.scaleY"] : []), "transform.x", "transform.y", "transform.rotation", ...(clip.transform.rotateX || clip.keyframes?.["transform.rotateX"] ? ["transform.rotateX"] : []), ...(clip.transform.rotateY || clip.keyframes?.["transform.rotateY"] ? ["transform.rotateY"] : [])];
  return (
    <Section
      title="Transform"
      extra={<SectionKey clip={clip} paths={paths} title="Transform" />}
      onReset={() => patchClip(clip.id, "Reset transform", (c) => ({ ...c, transform: { ...DEFAULT_TRANSFORM }, keyframes: stripKeys(c, "transform.") }) as Clip)}
    >
      <SliderRow clip={clip} path="transform.scale" label={stretched ? "Scale X" : "Scale"} min={1} max={500} unit="%" reset={1} {...pct} />
      {stretched && <SliderRow clip={clip} path="transform.scaleY" label="Scale Y" min={1} max={500} unit="%" reset={1} {...pct} />}
      <Row label="Uniform scale">
        <Toggle on={!stretched} label="Uniform scale" onChange={(on) => store.edit(on ? "Uniform scale" : "Separate scale", (p) => ops.setUniformScale(p, [clip.id], on))} />
      </Row>
      <SliderRow clip={clip} path="transform.x" label="Position X" min={-w} max={w} unit="px" reset={0} show={(v) => v * w} store={(v) => v / w} />
      <SliderRow clip={clip} path="transform.y" label="Position Y" min={-h} max={h} unit="px" reset={0} show={(v) => -v * h} store={(v) => -v / h} />
      <SliderRow clip={clip} path="transform.rotation" label="Rotate" min={-360} max={360} step={0.1} digits={1} unit="°" reset={0} />
      {/* Perspective tilt (ADR-070): a floating window turned in depth. */}
      <SliderRow clip={clip} path="transform.rotateX" label="Tilt X" min={-80} max={80} step={0.5} digits={1} unit="°" reset={0} />
      <SliderRow clip={clip} path="transform.rotateY" label="Tilt Y" min={-80} max={80} step={0.5} digits={1} unit="°" reset={0} />
      <SliderRow clip={clip} path="transform.anchorX" label="Anchor X" min={-100} max={100} unit="%" reset={0} {...pct} />
      <SliderRow clip={clip} path="transform.anchorY" label="Anchor Y" min={-100} max={100} unit="%" reset={0} show={(v) => -v * 100} store={(v) => -v / 100} />
      <Row label="Frame">
        <div className="frame-btns segmented">
          {(
            [
              ["fit", "Fit", "Show the whole picture"],
              ["fill", "Fill", "Cover the canvas, cropping the overflow"],
              ["stretch", "Stretch", "Cover the canvas, ignoring proportions"],
            ] as const
          ).map(([mode, label, tip]) => (
            <button key={mode} aria-label={`${label} to canvas`} data-tip={tip} onClick={() => store.edit(label, (p) => frameClips(p, [clip.id], mode, store.get().playhead))}>
              {label}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Flip">
        <div className="flip-pair">
          <button className={`icon-btn${clip.transform.flipX ? " on" : ""}`} aria-label="Flip horizontally" aria-pressed={clip.transform.flipX} data-tip="Flip horizontally" onClick={() => store.edit("Flip horizontally", (p) => ops.setFlip(p, [clip.id], { horizontal: !clip.transform.flipX }))}>
            <FlipHorizontal2 />
          </button>
          <button className={`icon-btn${clip.transform.flipY ? " on" : ""}`} aria-label="Flip vertically" aria-pressed={clip.transform.flipY} data-tip="Flip vertically" onClick={() => store.edit("Flip vertically", (p) => ops.setFlip(p, [clip.id], { vertical: !clip.transform.flipY }))}>
            <FlipVertical2 />
          </button>
        </div>
      </Row>
      <AlignBar ids={[clip.id]} />
    </Section>
  );
}

function stripKeys(c: Clip, prefix: string, keep?: RegExp) {
  if (!c.keyframes) return undefined;
  const k = Object.fromEntries(Object.entries(c.keyframes).filter(([p]) => !p.startsWith(prefix) || keep?.test(p)));
  return Object.keys(k).length ? k : undefined;
}

const BLENDS = BLEND_MODES;

function VideoTab({ clip }: { clip: Clip }) {
  // CapCut's order: Basic / Remove BG / Mask (research §3.0, §3.3).
  const [sub, setSub] = useState<"basic" | "removebg" | "mask">("basic");
  // CapCut draws the mask on the viewer while its tab is open.
  useEffect(() => {
    if (sub !== "mask") return;
    store.set({ maskHandles: true });
    return () => store.set({ maskHandles: false });
  }, [sub]);
  if (!("transform" in clip)) return null;
  return (
    <>
      <div className="insp-sub">
        <Segmented
          value={sub}
          onChange={setSub}
          options={[
            { value: "basic", label: "Basic" },
            { value: "removebg", label: "Remove BG" },
            { value: "mask", label: "Mask" },
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
          {clip.type === "color" && <ShapeSection clip={clip} />}
          <CompositingSection clip={clip} />
          <ShadowSection clip={clip} />
          <BorderSection clip={clip} />
          {(clip.type === "video" || clip.type === "image") && <CanvasSection clip={clip} />}
          <CropSection clip={clip} />
          {clip.type === "video" && <StabilizeSection clip={clip} />}
        </>
      )}
      {sub === "removebg" && (
        <>
          <AutoRemovalSection clip={clip} />
          <ChromaSection clip={clip} />
        </>
      )}
      {sub === "mask" && <MaskSection clip={clip} />}
    </>
  );
}

/** CapCut's Auto removal: a switch that makes the background matte once
 * (with progress, cancelable) and then just turns it on and off. */
function AutoRemovalSection({ clip }: { clip: Clip }) {
  const running = useAi((s) => s.jobs.cutout);
  const job = running?.clipId === clip.id ? running : undefined;
  // One matte at a time: the model and the GPU are shared.
  const busy = !!running && !job;
  const fps = useEditor((s) => s.project.fps);
  const video = clip.type === "video" ? clip : null;
  const cut = video?.cutout;
  const on = !!cut?.enabled;
  // A clip trimmed longer than its matte: the new frames need processing.
  const short = on && video && !covers(cut!, ...clipWindow(video, fps));
  const toggle = (v: boolean) => (job ? aiStore.cancel("cutout") : void setBackgroundRemoval(clip.id, v).catch(() => {}));
  const stage = job?.stage ?? "Removing the background";
  return (
    <Section title="Auto removal" on={on || !!job} extra={video && <Toggle label="Remove background" on={on || !!job} onChange={toggle} disabled={busy} />}>
      {job ? (
        <>
          <p className="insp-hint cutout-stage">{stage}</p>
          <div className="cutout-progress" role="progressbar" aria-label={stage} aria-valuenow={Math.round(job.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <span className="cutout-bar">
              <span style={{ transform: `scaleX(${job.progress})` }} />
            </span>
            <span className="cutout-pct num">
              <Loader2 size={13} className="spin" /> {Math.round(job.progress * 100)}%
            </span>
            <button className="icon-btn small" aria-label="Cancel" data-tip="Cancel" onClick={() => aiStore.cancel("cutout")}>
              <X size={13} />
            </button>
          </div>
        </>
      ) : !video ? (
        <p className="insp-hint">Works on video clips.</p>
      ) : busy ? (
        <p className="insp-hint">Another clip's background is being removed. This one can start when it is done.</p>
      ) : short ? (
        <>
          <p className="insp-hint">Part of this clip was added after its background was removed.</p>
          <div className="insp-actions">
            <button className="btn" onClick={() => void setBackgroundRemoval(clip.id, true).catch(() => {})}>
              Update
            </button>
          </div>
        </>
      ) : on ? (
        <p className="insp-hint">The subject stays and everything behind it shows the tracks below. Made on this computer.</p>
      ) : (
        <p className="insp-hint">
          Finds the person or main subject in every frame and removes everything behind it. Runs on this computer; the first time downloads the model ({MATTE_MODELS.quality.size}).
        </p>
      )}
    </Section>
  );
}

/** CapCut's Stabilize in Video > Basic: a switch and a level. Turning it on
 * (or changing the level) measures the shake; the switch shows progress. */
function StabilizeSection({ clip }: { clip: VideoClip }) {
  const job = useAi((s) => (s.jobs.stabilize?.clipId === clip.id ? s.jobs.stabilize : null));
  const preferred = useAi((s) => s.settings.stabilize.level);
  const level = clip.stabilize?.level ?? preferred;
  const run = (l: StabilizeLevel) => {
    aiStore.setSettings("stabilize", { level: l });
    void stabilizeClip(clip.id, { level: l }).catch(() => undefined);
  };
  // The switch sits in the header, as CapCut's checkbox does, so it works
  // with the section closed.
  const toggle = <Toggle on={!!clip.stabilize || !!job} label="Stabilize" onChange={(on) => (on ? run(level) : job ? aiStore.cancel("stabilize") : void stabilizeClip(clip.id, { level: "off" }))} />;
  return (
    // Turning it on opens the section, to show the progress and the zoom.
    <Section title="Stabilize" defaultOpen={!!clip.stabilize || !!job} on={!!clip.stabilize || !!job} extra={toggle}>
      <Row label="Level">
        <select className="field" aria-label="Stabilize level" value={level} disabled={!!job} onChange={(e) => (clip.stabilize ? run(e.target.value as StabilizeLevel) : aiStore.setSettings("stabilize", { level: e.target.value as StabilizeLevel }))}>
          {(Object.keys(LEVELS) as StabilizeLevel[]).map((k) => (
            <option key={k} value={k}>{LEVELS[k].label}</option>
          ))}
        </select>
      </Row>
      {job ? (
        <p className="insp-hint" role="status">Measuring the shake… {Math.round(job.progress * 100)}%</p>
      ) : clip.stabilize ? (
        <p className="insp-hint">Zoomed {Math.round((clip.stabilize.zoom - 1) * 100)}% to hide the edges. Measured on this clip's range; stabilize again after lengthening it.</p>
      ) : null}
    </Section>
  );
}

/** The four edges as sliders, and the button that opens CapCut's crop on
 * the viewer (handles and ratios), which the sliders give way to. */
function CropSection({ clip }: { clip: Clip }) {
  const cropping = useEditor((s) => s.cropEdit?.id === clip.id);
  const can = useEditor((s) => canCrop(s.project, clip.id));
  const open = (
    <button className={`icon-btn small${cropping ? " on" : ""}`} aria-label="Crop on the viewer" aria-pressed={cropping} data-tip={cropping ? "Done cropping" : "Crop on the viewer, with ratios"} disabled={!can} onClick={() => (cropping ? applyCrop() : beginCrop(clip.id))}>
      <CropIcon size={13} />
    </button>
  );
  return (
    <Section title="Crop" defaultOpen={false} extra={open} onReset={() => (cropping ? resetCrop() : patchClip(clip.id, "Reset crop", (c) => ({ ...c, crop: { ...NO_CROP } }) as Clip))}>
      {cropping ? (
        <p className="insp-hint">Drag the handles on the viewer or pick a ratio under it. Done keeps the crop; Cancel leaves it as it was.</p>
      ) : (
        (["left", "top", "right", "bottom"] as const).map((k) => (
          <SliderRow key={k} clip={clip} path={`crop.${k}`} label={k[0].toUpperCase() + k.slice(1)} min={0} max={95} unit="%" reset={0} keyframes={false} {...pct} />
        ))
      )}
    </Section>
  );
}

// CapCut's blur strengths (its draft file stores 0.0625, 0.375, 0.75, 1.0).
const BLURS: [number, string][] = [[25, "Light"], [50, "Medium"], [80, "Strong"], [100, "Max"]];

/** CapCut's Canvas: fill what a clip leaves uncovered (a 16:9 shot in a
 * 9:16 project) with a blurred copy of itself or a color. */
function CanvasSection({ clip }: { clip: Clip }) {
  if (!("transform" in clip)) return null;
  const fill = clip.canvas;
  const set = (canvas: CanvasFill | undefined, label: string) =>
    patchClip(clip.id, label, (c) => {
      const next = { ...c } as Clip & { canvas?: CanvasFill };
      if (canvas) next.canvas = canvas;
      else delete next.canvas;
      return next;
    });
  const applyAll = () =>
    store.edit("Canvas on all clips", (p) => ({
      ...p,
      tracks: p.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => {
          if (c.type !== "video" && c.type !== "image") return c;
          const next = { ...c } as Clip & { canvas?: CanvasFill };
          if (fill) next.canvas = fill;
          else delete next.canvas;
          return next;
        }),
      })),
    }));
  return (
    <Section title="Canvas">
      <Segmented
        value={fill?.type ?? "none"}
        onChange={(v) => set(v === "none" ? undefined : v === "blur" ? { type: "blur", amount: 50 } : { type: "color", color: "#000000" }, v === "none" ? "Remove canvas" : "Canvas")}
        options={[
          { value: "none", label: "None" },
          { value: "blur", label: "Blur" },
          { value: "color", label: "Color" },
        ]}
      />
      {fill?.type === "blur" && (
        <div className="canvas-blurs">
          {BLURS.map(([amount, label]) => (
            <button key={amount} className={`chip-btn${fill.amount === amount ? " on" : ""}`} onClick={() => set({ type: "blur", amount }, "Canvas blur")}>
              {label}
            </button>
          ))}
        </div>
      )}
      {fill?.type === "color" && (
        <Row label="Color">
          <ColorInput label="Canvas color" value={fill.color} onChange={(v) => set({ type: "color", color: v }, "Canvas color")} />
        </Row>
      )}
      <p className="insp-hint">Fills the frame around a clip that doesn't cover it, like a horizontal shot in a vertical video.</p>
      <div className="insp-actions">
        <button className="btn" onClick={applyAll}>Apply to all</button>
      </div>
    </Section>
  );
}

/** The mask's shapes as CapCut lists them; heart and star wear icons. */
const MASK_ICONS: Partial<Record<MaskShape, React.ReactNode>> = { heart: <Heart size={16} />, star: <Star size={16} /> };

function MaskSection({ clip }: { clip: Clip }) {
  if (!("transform" in clip)) return null;
  const m = clip.mask;
  const setShape = (shape: MaskShape | "none") =>
    patchClip(clip.id, "Mask", (c) => {
      const next = { ...c } as Clip & { mask?: Mask };
      if (shape === "none") delete next.mask;
      else next.mask = m ? { ...m, shape } : newMask(shape, pictureAspect(store.get().project, c as VisualClip, store.get().playhead));
      return next;
    });
  const sized = m && m.shape !== "linear" && m.shape !== "mirror";
  return (
    <Section title="Mask">
      <div className="mask-shapes">
        {(["none", ...MASK_SHAPES] as const).map((v) => (
          <button key={v} className={`mask-shape ms-${v}${(m?.shape ?? "none") === v ? " on" : ""}`} aria-pressed={(m?.shape ?? "none") === v} onClick={() => setShape(v)}>
            {MASK_ICONS[v as MaskShape] ?? <span className="ms-icon" />}
            <span>{v === "none" ? "None" : MASK_LABELS[v]}</span>
          </button>
        ))}
      </div>
      {m && (
        <>
          <SliderRow clip={clip} path="mask.x" label="Position X" min={-100} max={100} unit="%" reset={0} {...pct} />
          <SliderRow clip={clip} path="mask.y" label="Position Y" min={-100} max={100} unit="%" reset={0} {...pct} />
          {sized && <SliderRow clip={clip} path="mask.width" label="Width" min={1} max={200} unit="%" reset={0.6} {...pct} />}
          {m.shape !== "linear" && <SliderRow clip={clip} path="mask.height" label="Height" min={1} max={200} unit="%" reset={0.6} {...pct} />}
          <SliderRow clip={clip} path="mask.rotation" label="Rotate" min={-180} max={180} unit="°" reset={0} />
          <SliderRow clip={clip} path="mask.feather" label="Feather" min={0} max={100} unit="%" reset={0.05} {...pct} />
          {m.shape === "rectangle" && <SliderRow clip={clip} path="mask.radius" label="Round corners" min={0} max={100} unit="%" reset={0} {...pct} />}
          <Row label="Invert">
            <Toggle label="Invert mask" on={m.invert} onChange={(v) => patchClip(clip.id, "Invert mask", (c) => ({ ...c, mask: { ...m, invert: v } }) as Clip)} />
          </Row>
          <p className="insp-hint">On the viewer, drag inside the mask to move it, its edges to size it, the knob to turn it and the arrow to feather it.</p>
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
    <Section title="Chroma key" on={!!k?.enabled} extra={<Toggle label="Chroma key" on={!!k?.enabled} onChange={(v) => set({ enabled: v }, v ? "Chroma key on" : "Chroma key off")} />}>
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
        {clip.type === "audio" && <CrossfadeRow clip={clip} />}
        <SliderRow clip={clip} path="pan" label="Pan" min={-100} max={100} reset={0} {...pct} />
        {/* Not on a compound clip: its channel fill is not mixed (ADR-100),
            and set_channel_fill leaves it as it is. */}
        {clip.type !== "compound" && <Row label="Channels">
          <Segmented
            value={clip.fill ?? "both"}
            onChange={(v) => edit(v === "both" ? "Channels as recorded" : `Fill from ${v}`, (p) => runCommand(p, "set_channel_fill", { clip_ids: [clip.id], fill: v }))}
            options={[
              { value: "both", label: "Stereo" },
              { value: "left", label: "Left to both" },
              { value: "right", label: "Right to both" },
            ]}
          />
        </Row>}
      </Section>
      <Section
        title="Equalizer"
        defaultOpen={!!clip.eq}
        onReset={() => patchClip(clip.id, "Reset EQ", (c) => {
          const { eq: _, ...rest } = c as AudioClip;
          return rest as Clip;
        })}
      >
        {EQ_BANDS.map((b) => (
          <SliderRow key={b.key} clip={clip} path={`eq.${b.key}`} label={b.label} min={-12} max={12} step={0.5} digits={1} unit="dB" reset={0} keyframes={false} />
        ))}
      </Section>
      <CompressorSection clip={clip} />
      {clip.type !== "compound" && <SoundFxSection clip={clip} />}
      {clip.type === "video" && (
        <Section title="Sound">
          <div className="insp-actions">
            <button className="btn" data-tip={tipFor("detachAudio")} onClick={() => run("detachAudio")}>Extract audio</button>
            <button className="btn ghost" onClick={() => patchClip(clip.id, clip.muted ? "Unmute clip" : "Mute clip", (c) => ({ ...c, muted: !(c as VideoClip).muted }) as Clip)}>
              {clip.muted ? "Unmute clip" : "Mute clip"}
            </button>
          </div>
        </Section>
      )}
    </>
  );
}

/** The join into the next audio clip on the track, crossfaded at equal
 * power over the seconds before the cut (ADR-104), through set_crossfade
 * (ADR-109). Shown where a crossfade fits; the clip menu says why not. */
function CrossfadeRow({ clip }: { clip: AudioClip }) {
  const project = useEditor((s) => s.project);
  const join = crossfadeJoin(project, clip.id);
  if (!join || !join.most) return null;
  const apply = (s: number) => (p: Project) => runCommand(p, "set_crossfade", { clip_id: clip.id, seconds: +Math.min(join.most, Math.max(0, s)).toFixed(4) });
  return <SliderRow clip={clip} path="crossfade" label="Crossfade" min={0} max={+join.most.toFixed(4)} step={0.01} unit="s" reset={0} keyframes={false} value={join.plays} apply={apply} />;
}

/** CapCut's Enhance voice and Premiere's Dynamics: presets first, the
 * three settings that matter most once one is on. */
function CompressorSection({ clip }: { clip: AudioClip | VideoClip | CompoundClip }) {
  const c = clip.compressor;
  const set = (preset: string) =>
    edit(preset === "off" ? "Compressor off" : `Compressor: ${COMPRESSOR_LABELS[preset]}`, (p) => runCommand(p, "set_compressor", { clip_ids: [clip.id], preset }));
  const voice = COMPRESSOR_PRESETS.voice;
  return (
    <Section title="Compressor" defaultOpen={!!c} onReset={() => set("off")}>
      <Row label="Preset">
        <Segmented value={c ? compressorPreset(c) : "off"} onChange={set} options={Object.entries(COMPRESSOR_LABELS).map(([value, label]) => ({ value, label }))} />
      </Row>
      {c ? (
        <>
          <SliderRow clip={clip} path="compressor.threshold" label="Threshold" min={-60} max={0} step={0.5} digits={1} unit="dB" reset={voice.threshold} keyframes={false} />
          <SliderRow clip={clip} path="compressor.ratio" label="Ratio" min={1} max={20} step={0.5} digits={1} unit=":1" reset={voice.ratio} keyframes={false} />
          <SliderRow clip={clip} path="compressor.makeup" label="Makeup" min={0} max={24} step={0.5} digits={1} unit="dB" reset={voice.makeup} keyframes={false} />
        </>
      ) : (
        <p className="insp-hint">{clip.type === "compound" ? "Evens out the mix of everything inside, as one sound: a voice and its music together." : "Evens out loud and quiet words. Enhance voice suits speech and voiceovers."}</p>
      )}
    </Section>
  );
}

const COMPRESSOR_LABELS: Record<string, string> = { off: "Off", voice: "Enhance voice", gentle: "Gentle", strong: "Strong" };

// ---- speed -------------------------------------------------------------------

const SPEED_MIN = 0.1;
const SPEED_MAX = 100;
const toLog = (s: number) => Math.log(s / SPEED_MIN) / Math.log(SPEED_MAX / SPEED_MIN);
const fromLog = (v: number) => SPEED_MIN * (SPEED_MAX / SPEED_MIN) ** v;

/** CapCut's Speed tab: Standard (one rate) or Curve (presets and a graph),
 * plus direction and pitch, which apply to either. */
function SpeedTab({ clip }: { clip: ops.TimedClip }) {
  const [mode, setMode] = useState<"standard" | "curve">(clip.speedCurve ? "curve" : "standard");
  const hasSound = useEditor((s) =>
    clip.type === "compound"
      ? !clip.muted && soundingClips(compoundView(s.project, clip.compoundId), (id) => ops.getAsset(s.project, id)?.hasAudio ?? false).length > 0
      : (clip.type === "audio" || !clip.muted) && (ops.getAsset(s.project, clip.assetId)?.hasAudio ?? false),
  );
  // ponytail: a compound clip's sound is mixed through linear time maps
  // (lib/audio.ts), so it has one speed; curves and reverse need composed
  // maps there first (ADR-037).
  if (clip.type === "compound") {
    return (
      <>
        <StandardSpeed clip={clip} />
        <Section title="Playback">
          {hasSound && (
            <Row label="Change pitch">
              <Toggle label="Change pitch" on={!!clip.changePitch} onChange={(v) => edit(v ? "Change pitch with speed" : "Keep pitch", (p) => ops.setChangePitch(p, [clip.id], v))} />
            </Row>
          )}
          <p className="insp-hint">Speed curves and reverse work inside the compound clip: open it and set them on its clips.</p>
        </Section>
      </>
    );
  }
  return (
    <>
      <div className="insp-sub">
        <Segmented value={mode} onChange={setMode} options={[{ value: "standard", label: "Standard" }, { value: "curve", label: "Curve" }]} />
      </div>
      {mode === "standard" ? <StandardSpeed clip={clip} /> : <CurveSpeed clip={clip} />}
      {!clip.freeze && (
        <Section title="Playback">
          <Row label="Reverse">
            <Toggle label="Reverse" on={!!clip.reverse} onChange={(v) => edit(v ? "Reverse" : "Play forward", (p) => ops.setReverse(p, clip.id, v))} />
          </Row>
          {clip.type === "video" && !clip.reverse && (
            <Row label="Frame blending">
              <Toggle
                label="Frame blending"
                on={!!clip.frameBlend}
                onChange={(v) => edit(v ? "Frame blending" : "No frame blending", (p) => runCommand(p, "set_frame_blending", { clip_ids: [clip.id], on: v }))}
              />
            </Row>
          )}
          {hasSound && (
            <Row label="Change pitch">
              <Toggle label="Change pitch" on={!!clip.changePitch} onChange={(v) => edit(v ? "Change pitch with speed" : "Keep pitch", (p) => ops.setChangePitch(p, [clip.id], v))} />
            </Row>
          )}
          <p className="insp-hint">{clip.changePitch ? "Pitch rises and falls with the speed, like tape." : "Voices keep their pitch at any speed."}</p>
        </Section>
      )}
    </>
  );
}

function CurveSpeed({ clip }: { clip: VideoClip | AudioClip }) {
  const fps = useEditor((s) => s.project.fps);
  const curve = clip.speedCurve;
  const [lo, hi] = ops.sourceRange(clip, fps);
  return (
    <>
      <div className="anim-grid">
        <button className={`anim-tile${!curve ? " on" : ""}`} onClick={() => curve && edit("Remove speed curve", (p) => ops.setSpeedCurve(p, clip.id, null))}>
          <span className="anim-demo none" />
          <span>None</span>
        </button>
        {Object.entries(PRESETS).map(([k, d]) => (
          <button key={k} className={`anim-tile${curve?.preset === k ? " on" : ""}`} onClick={() => curve?.preset !== k && edit(`Speed curve: ${d.label}`, (p) => ops.setSpeedCurve(p, clip.id, d.points, k))}>
            <CurvePreview points={d.points} />
            <span>{d.label}</span>
          </button>
        ))}
      </div>
      {curve && (
        <Section title="Graph">
          <SpeedGraph clip={clip} />
          <p className="insp-hint num">
            Duration {formatDuration(framesToSeconds(clip.duration, fps))} for {formatDuration(hi - lo)} of source. Later clips on the track move with the change.
          </p>
        </Section>
      )}
    </>
  );
}

function StandardSpeed({ clip }: { clip: ops.TimedClip }) {
  const fps = useEditor((s) => s.project.fps);
  const [text, setText] = useState<string | null>(null);
  const [dur, setDur] = useState<string | null>(null);
  // CapCut's Speed > Duration: type a length and the speed follows, the
  // same source filling it (Rate stretch by the numbers).
  const fit = (seconds: number) => edit(`Duration ${seconds}s`, (p) => stretchClip(p, clip.id, "end", clip.start + Math.max(1, secondsToFrames(seconds, fps))));
  const apply = (speed: number) => {
    const s = Math.min(SPEED_MAX, Math.max(SPEED_MIN, +speed.toFixed(2)));
    edit(`Speed ${s}x`, (p) => ops.setSpeed(p, clip.id, s));
  };
  // What was typed applies on Enter, on leaving the field, and when the
  // field goes away unblurred (another clip selected); junk changes nothing.
  const commitSpeed = (raw: string) => {
    setText(null);
    const v = parseTyped(raw);
    if (v !== null && v > 0) apply(v);
  };
  const commitDur = (raw: string) => {
    setDur(null);
    const v = parseTyped(raw);
    if (v !== null && v > 0) fit(v);
  };
  useCommitOnLeave(text, commitSpeed);
  useCommitOnLeave(dur, commitDur);
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
          {...rangeGesture(() => `Speed ${(ops.findClip(store.get().project, clip.id)?.clip as ops.TimedClip | undefined)?.speed ?? clip.speed}x`)}
          onChange={(e) => {
            const s = +fromLog(Number(e.target.value)).toFixed(2);
            store.previewGesture((p) => ops.settle(p, ops.setSpeed(p, clip.id, s), { magnet: store.get().magnet, linkage: store.get().linkage }), `Speed ${s}x`);
          }}
          aria-label="Speed"
        />
        <span className="insp-num">
          <input
            className="field num"
            value={text ?? clip.speed.toFixed(2)}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => text !== null && commitSpeed(text)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            aria-label="Speed value"
          />
          <span className="insp-unit">x</span>
        </span>
        <span className="insp-keys" />
      </div>
      <div className="speed-presets">
        {[0.25, 0.5, 1, 1.5, 2, 4].map((s) => (
          <button key={s} className={`chip-btn${!clip.speedCurve && clip.speed === s ? " on" : ""}`} onClick={() => apply(s)}>
            {s}x
          </button>
        ))}
      </div>
      {!clip.speedCurve && !clip.freeze && (
        <div className="insp-row">
          <label className="insp-label">Duration</label>
          <span />
          <span className="insp-num">
            <input
              className="field num"
              value={dur ?? framesToSeconds(clip.duration, fps).toFixed(2)}
              onChange={(e) => setDur(e.target.value)}
              onBlur={() => dur !== null && commitDur(dur)}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              aria-label="Duration value"
            />
            <span className="insp-unit">s</span>
          </span>
          <span className="insp-keys" />
        </div>
      )}
      <p className="insp-hint num">
        {clip.speedCurve ? `Duration ${formatDuration(framesToSeconds(clip.duration, fps))}. A speed here replaces the curve.` : "Later clips on the track move with the change."}
      </p>
    </Section>
  );
}

// ---- animation -----------------------------------------------------------------

const ORDER_LABELS: Record<KineticOrder, string> = { forward: "First to last", backward: "Last to first", center: "From the center", random: "Random" };

/** A preset's tile picture (lib/animThumb.ts): the layer settled and a
 * dashed ghost where it moves from or to; it plays on hover. */
function AnimThumb({ type, slot }: { type: string | null; slot: ThumbSlot }) {
  const marks = animThumb(type, slot, ANIMATIONS);
  return (
    <span className={`anim-demo${type ? ` a-${type}` : " none"} slot-${slot}`} aria-hidden="true">
      {marks.map((m, i) => (
        <i
          key={i}
          className={`am am-${m.kind}`}
          style={{
            left: m.x - m.w / 2,
            top: m.y - m.h / 2,
            width: m.w,
            height: m.h,
            opacity: m.opacity,
            transform: m.scale !== 1 || m.rotation ? `rotate(${m.rotation}deg) scale(${m.scale})` : undefined,
            filter: m.blur ? "blur(1.5px)" : undefined,
          }}
        />
      ))}
    </span>
  );
}

function AnimationTab({ clip }: { clip: Clip }) {
  const fps = useEditor((s) => s.project.fps);
  const [slot, setSlot] = useState<"in" | "out" | "loop">("in");
  if (!("transform" in clip)) return null;
  const key = slot === "in" ? "animIn" : slot === "out" ? "animOut" : "animLoop";
  const current = (clip as unknown as Record<string, Animation | undefined>)[key];
  const text = clip.type === "text";
  // Titles also get the kinetic presets (typewriter, word pop...), which
  // move their letters and words; other clips only the whole-layer ones.
  const list = Object.entries(ANIMATIONS).filter(([, d]) => (d.text ? text && slot !== "loop" : slot === "loop" ? !!d.loop : !!d.from));
  const slotLabel = `${slot === "loop" ? "Loop" : slot === "in" ? "In" : "Out"} animation`;
  /** This slot's animation set (or removed with null), as an edit of the
   * project: the sliders preview it through a gesture, a pick commits it. */
  const animate = (type: string | null, duration?: number, perUnit?: Pick<Animation, "unit" | "stagger" | "order">) => (p: Project) =>
    ops.updateClip(p, clip.id, (c) => {
      const next = { ...c } as Record<string, unknown>;
      if (!type) delete next[key];
      else {
        // Changing the animation keeps how it plays per unit; a sweep has none.
        const keep = perUnit ?? (current && !ANIMATIONS[type].text?.sweep ? { unit: current.unit, stagger: current.stagger, order: current.order } : {});
        const clean = Object.fromEntries(Object.entries(keep).filter(([, v]) => v !== undefined));
        next[key] = { type, duration: duration ?? current?.duration ?? secondsToFrames(slot === "loop" ? 1 : 0.5, fps), ...clean };
      }
      return next as unknown as Clip;
    });
  const set = (type: string | null, duration?: number, perUnit?: Pick<Animation, "unit" | "stagger" | "order">) => store.edit(type ? slotLabel : "Remove animation", animate(type, duration, perUnit));
  // CapCut plays what was picked: the slot's stretch of the clip once,
  // silently, stopping where it ends (lib/overlays.ts animationSpan).
  const pick = (type: string | null) => {
    set(type);
    if (type) previewAnimation(clip.id, slot);
  };
  const def = current && ANIMATIONS[current.type];
  const unit = current ? (current.unit ?? def?.text?.unit) : undefined;
  return (
    <>
      <div className="insp-sub">
        <Segmented value={slot} onChange={setSlot} options={[{ value: "in", label: "In" }, { value: "out", label: "Out" }, { value: "loop", label: clip.type === "text" ? "Loop" : "Combo" }]} />
      </div>
      <div className="anim-grid">
        <button className={`anim-tile${!current ? " on" : ""}`} onClick={() => pick(null)}>
          <AnimThumb type={null} slot={slot} />
          <span>None</span>
        </button>
        {list.map(([k, d]) => (
          <button key={k} className={`anim-tile${current?.type === k ? " on" : ""}`} onClick={() => pick(k)}>
            <AnimThumb type={k} slot={slot} />
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
              {...rangeGesture(slotLabel)}
              onChange={(e) => store.previewGesture(animate(current.type, Math.max(1, secondsToFrames(Number(e.target.value), fps))), slotLabel)}
              aria-label="Animation duration"
            />
            <span className="insp-num num">{framesToSeconds(current.duration, fps).toFixed(1)}<span className="insp-unit">s</span></span>
            <span className="insp-keys" />
          </div>
        </Section>
      )}
      {current && text && def?.text?.sweep && (
        <Section title="Text motion">
          <Row label={def.text.sweep === "marker" ? "Marker" : "Line"}>
            <ColorInput
              label={def.text.sweep === "marker" ? "Marker color" : "Line color"}
              value={(clip as TextClip).style.accent ?? (def.text.sweep === "marker" ? "#ffd84d" : (clip as TextClip).style.color)}
              onChange={(v) => patchClip(clip.id, "Accent color", (c) => ({ ...c, style: { ...(c as TextClip).style, accent: v } }) as Clip)}
            />
          </Row>
        </Section>
      )}
      {current && text && !def?.text?.sweep && (
        <Section title="Text motion">
          <Row label="Moves by">
            <Segmented
              value={unit ?? "whole"}
              onChange={(v) => set(current.type, current.duration, v === "whole" ? {} : { unit: v, stagger: current.stagger, order: current.order })}
              options={[
                ...(def?.text ? [] : [{ value: "whole" as const, label: "Whole" }]),
                { value: "letter" as const, label: "Letter" },
                { value: "word" as const, label: "Word" },
                { value: "line" as const, label: "Line" },
              ]}
            />
          </Row>
          {unit && (
            <>
              <div className="insp-row">
                <label className="insp-label">Stagger</label>
                <input
                  type="range"
                  className="insp-slider"
                  min={0}
                  max={1}
                  step={0.05}
                  value={current.stagger ?? def?.text?.stagger ?? DEFAULT_STAGGER}
                  {...rangeGesture(slotLabel)}
                  onChange={(e) => store.previewGesture(animate(current.type, current.duration, { unit: current.unit, stagger: Number(e.target.value), order: current.order }), slotLabel)}
                  aria-label="Stagger"
                />
                <span className="insp-num num">{Math.round((current.stagger ?? def?.text?.stagger ?? DEFAULT_STAGGER) * 100)}<span className="insp-unit">%</span></span>
                <span className="insp-keys" />
              </div>
              <Row label="Order">
                <select className="field" aria-label="Order" value={current.order ?? (slot === "out" ? def?.text?.outOrder : undefined) ?? "forward"} onChange={(e) => set(current.type, current.duration, { unit: current.unit, stagger: current.stagger, order: e.target.value as KineticOrder })}>
                  {KINETIC_ORDERS.map((o) => (
                    <option key={o} value={o}>
                      {ORDER_LABELS[o]}
                    </option>
                  ))}
                </select>
              </Row>
            </>
          )}
        </Section>
      )}
      <TrackingSection clip={clip as VisualClip} />
    </>
  );
}

/** Pinned to footage (ADR-120): the clip whose picture this layer follows
 * through its zooms and pans, and the buttons that pin it there (at its
 * center, on the video under it at the playhead) or let it go: set_anchor,
 * as an agent pins it. */
function PinRow({ clip }: { clip: VisualClip }) {
  const target = useEditor((s) => (clip.anchor ? ops.findClip(s.project, clip.anchor.clipId)?.clip : undefined));
  const under = useEditor((s) => (clip.anchor || s.playhead < clip.start || s.playhead >= clip.start + clip.duration ? undefined : footageUnder(s.project, s.playhead, clip.id)));
  const name = (c: Clip) => c.name ?? ("assetId" in c ? ops.getAsset(store.get().project, c.assetId)?.name : undefined) ?? c.id;
  const command = (label: string, args: Record<string, unknown>) => {
    try {
      store.edit(label, (p) => runCommand(p, "set_anchor", args));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };
  const pin = () => {
    const s = store.get(), l = layerAt(s.project, clip, s.playhead);
    if (!under || !l) return;
    const at = underPoint(s.project, under, s.playhead, l.x, l.y);
    command("Pin to footage", { clip_ids: [clip.id], anchor: { clip_id: under.id, x: +at.x.toFixed(4), y: +at.y.toFixed(4) } });
  };
  // A callout's ring and dim let go together.
  const unpin = () => {
    const mates = store.get().project.tracks.flatMap((t) => t.clips).filter((c) => c.id === clip.id || (!!clip.group && c.group === clip.group && "anchor" in c && !!c.anchor));
    command("Unpin", { clip_ids: mates.map((c) => c.id), none: true });
  };
  return (
    <>
      <p className="insp-hint">
        {clip.anchor
          ? `Pinned to ${target ? name(target) : clip.anchor.clipId}: it follows that clip's zooms and pans. Drag it to pin it somewhere else.`
          : "Pin this layer to the video under it, where its center is now, to follow that video's zooms and pans."}
      </p>
      <div className="insp-actions">
        {clip.anchor ? (
          <button className="btn" onClick={unpin}>
            <PinOff size={14} /> Unpin
          </button>
        ) : (
          <button className="btn" disabled={!under} data-tip={under ? undefined : "Move the playhead over this layer and a video under it"} onClick={pin}>
            <Pin size={14} /> Pin to footage
          </button>
        )}
      </div>
    </>
  );
}

/** CapCut's Tracking: place a box on a subject in the video under this
 * layer, and the layer follows it from the playhead; on a video, the box
 * can instead keep its subject centered (reframe). state/tracking.ts. */
function TrackingSection({ clip }: { clip: VisualClip }) {
  const pinWhy = useEditor((s) => cannotTrack(s.project, clip.id, s.playhead, "pin"));
  const centerWhy = useEditor((s) => (clip.type === "video" ? cannotTrack(s.project, clip.id, s.playhead, "center") : "Not a video"));
  const box = useTrackBox();
  const placing = box?.target === clip.id ? box.mode : null;
  const job = useTracking();
  const mine = job?.target === clip.id;
  const track = () => void trackMotion(clip.id).catch(() => undefined);
  const idle =
    clip.type === "video"
      ? (centerWhy ?? "Keep a moving subject centered while the picture fills the canvas (reframe), or pin this clip to a subject in a video under it.")
      : (pinWhy ?? "Pin this layer to a moving subject in the video under it, from the playhead on.");
  return (
    <Section title="Tracking">
      {clip.type !== "video" && <PinRow clip={clip} />}
      <p className="insp-hint" role={mine ? "status" : undefined}>
        {mine ? `Following the subject… ${Math.round(job.progress * 100)}%` : placing ? `Drag the box onto the subject and size it to fit, then ${placing === "center" ? "Reframe" : "Track"}.` : idle}
      </p>
      <div className="insp-actions">
        {mine ? (
          <button className="btn ghost" onClick={cancelTracking}>Cancel</button>
        ) : placing ? (
          <>
            <button className="btn primary" onClick={track}>{placing === "center" ? "Reframe" : "Track"}</button>
            <button className="btn ghost" onClick={cancelTrackBox}>Cancel</button>
          </>
        ) : (
          <>
            {(clip.type !== "video" || !pinWhy) && (
              <button className="btn" disabled={!!pinWhy || !!job} onClick={() => beginTrackBox(clip.id)}>
                <Crosshair size={14} /> Pick subject
              </button>
            )}
            {clip.type === "video" && (
              <button className="btn" disabled={!!centerWhy || !!job} onClick={() => beginTrackBox(clip.id, "center")}>
                <Ratio size={14} /> Keep subject centered
              </button>
            )}
          </>
        )}
      </div>
    </Section>
  );
}

// ---- adjust ----------------------------------------------------------------------

const TEMP_TRACK = "linear-gradient(90deg, #3a7bd5, #9a9a9a, #e0b13a)";
const TINT_TRACK = "linear-gradient(90deg, #3fae54, #9a9a9a, #c94fc0)";
const SAT_TRACK = "linear-gradient(90deg, #8a8a8a, #e0453a)";

type AdjustSub = "basic" | "hsl" | "curves" | "wheels" | "lut";
/** Kept across clips, like CapCut keeps the open sub-tab. */
let lastAdjustSub: AdjustSub = "basic";
const GRADE_PATH = /^adjust\.(hsl|curves|wheels|lut|colorize)\./;

function AdjustTab({ clip }: { clip: Clip }) {
  const [sub, setSubState] = useState<AdjustSub>(lastAdjustSub);
  const setSub = (s: AdjustSub) => {
    lastAdjustSub = s;
    setSubState(s);
  };
  if (!("adjust" in clip)) return null;
  return (
    <>
      <div className="insp-sub adjust-sub">
        <Segmented
          value={sub}
          onChange={setSub}
          options={[
            { value: "basic", label: "Basic" },
            { value: "hsl", label: "HSL" },
            { value: "curves", label: "Curves" },
            { value: "wheels", label: "Color wheel" },
            { value: "lut", label: "LUT" },
          ]}
        />
      </div>
      <div className="grade-pane" key={sub}>
        {sub === "basic" && (clip.type === "video" || clip.type === "image") && (
          <div className="insp-actions auto-adjust">
            <button className="btn" data-tip="Correct exposure, white balance and levels from the frame at the playhead" onClick={() => void autoAdjustClip(clip.id).catch((e) => toast((e as Error).message, "error"))}>
              <WandSparkles size={13} /> Auto adjust
            </button>
          </div>
        )}
        {sub === "basic" && <AdjustBasic clip={clip} />}
        {sub === "hsl" && <HslPanel clip={clip} />}
        {sub === "curves" && <CurvesPanel clip={clip} />}
        {sub === "wheels" && <WheelsPanel clip={clip} />}
        {sub === "lut" && <LutPanel clip={clip} />}
      </div>
    </>
  );
}

function AdjustBasic({ clip }: { clip: Clip }) {
  if (!("adjust" in clip)) return null;
  const a = (path: keyof typeof DEFAULT_ADJUST, label: string, min = -100, track?: string) => (
    <SliderRow key={path} clip={clip} path={`adjust.${path}`} label={label} min={min} max={100} reset={0} track={track} />
  );
  return (
    <>
      <FilterSection clip={clip} />
      {/* Resets the sliders only; the grade's HSL, curves, wheels and LUT stay. */}
      <Section title="Color" onReset={() => patchClip(clip.id, "Reset color", (c) => ({ ...c, adjust: { ...(c as { adjust: object }).adjust, ...DEFAULT_ADJUST }, keyframes: stripKeys(c, "adjust.", GRADE_PATH) }) as Clip)}>
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
      <ColorizeSection clip={clip} />
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
  const locked = useEditor(s => ops.findClip(s.project, clip.id)?.track.locked ?? false);
  if (!("effects" in clip)) return null;
  const change = (label: string, action: EffectAction, effectId?: string) =>
    store.edit(label, p => runCommand(p, "edit_effects", { clip_id: clip.id, action, ...(effectId ? { effect_id: effectId } : {}) }));
  const add = (type: string) => {
    store.edit(`Add ${EFFECTS[type].label.toLowerCase()}`, p => runCommand(p, "add_effect", { clip_id: clip.id, type }));
    setAdding(false);
  };
  return (
    <Section
      title="Effects"
      extra={
        <button className="icon-btn small" aria-label="Add effect" data-tip="Add effect" disabled={locked} onClick={() => setAdding(!adding)}>
          <Plus size={13} />
        </button>
      }
    >
      <EffectClipboard clip={clip} />
      {locked && <p className="insp-hint">Unlock the track to edit effects.</p>}
      <fieldset className="fx-stack" disabled={locked}>
      {clip.effects.length > 0 && <>
        <p className="insp-hint">Effects run from top to bottom. Changing the order changes the result.</p>
        <div className="insp-actions">
          <button className="btn" onClick={() => change(clip.effects.some(e => e.enabled) ? "Disable all effects" : "Enable all effects", clip.effects.some(e => e.enabled) ? "disable" : "enable")}>
            {clip.effects.some(e => e.enabled) ? "Disable all" : "Enable all"}
          </button>
          <button className="btn" onClick={() => change("Remove all effects", "clear")}>Remove all</button>
        </div>
      </>}
      {adding && (
        <div className="fx-picker">
          {Object.entries(EFFECTS).map(([k, d]) => (
            <button key={k} className="chip-btn" onClick={() => add(k)}>
              {d.label}
            </button>
          ))}
        </div>
      )}
      {clip.effects.length === 0 && !adding && <EmptyState icon={<Sparkles size={24} />} title="No effects" hint="Add one here or drag one from the Effects tab onto the clip." />}
      {clip.effects.map((fx, index) => {
        const def = EFFECTS[fx.type];
        if (!def) return null;
        return (
          <div key={fx.id} className={`fx-card${fx.enabled ? "" : " off"}`}>
            <div className="fx-head">
              <Sparkles size={12} />
              <span className="fx-name">{def.label}</span>
              <span className="fx-tools">
                <button className="icon-btn small" aria-label="Move effect up" data-tip="Move effect up" disabled={index === 0} onClick={() => change("Move effect up", "move_up", fx.id)}><ArrowUp /></button>
                <button className="icon-btn small" aria-label="Move effect down" data-tip="Move effect down" disabled={index === clip.effects.length - 1} onClick={() => change("Move effect down", "move_down", fx.id)}><ArrowDown /></button>
                <button className="icon-btn small" aria-label="Reset effect" data-tip="Reset effect and its keyframes" onClick={() => change("Reset effect", "reset", fx.id)}><RotateCcw /></button>
                <button className="icon-btn small" aria-label={fx.enabled ? "Disable effect" : "Enable effect"} data-tip={fx.enabled ? "Disable effect" : "Enable effect"} onClick={() => change(fx.enabled ? "Disable effect" : "Enable effect", fx.enabled ? "disable" : "enable", fx.id)}>
                  {fx.enabled ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
                <button className="icon-btn small" aria-label="Remove effect" data-tip="Remove effect" onClick={() => change("Remove effect", "remove", fx.id)}>
                  <Trash2 size={12} />
                </button>
              </span>
            </div>
            {Object.entries(def.params).map(([k, pd]) =>
              pd.options ? (
                <Row key={k} label={pd.label}>
                  <Segmented
                    value={String(Math.round(fx.params[k] ?? pd.default))}
                    options={pd.options.map((label, i) => ({ value: String(pd.min + i), label }))}
                    onChange={(v) => store.edit(`Set ${pd.label.toLowerCase()}`, (p) => ops.setParam(p, [clip.id], `effects.${fx.id}.${k}`, Number(v)))}
                  />
                </Row>
              ) : (
                <SliderRow key={k} clip={clip} path={`effects.${fx.id}.${k}`} label={pd.label} min={pd.min} max={pd.max} step={pd.step} unit={pd.unit} reset={pd.default} />
              ),
            )}
          </div>
        );
      })}
      </fieldset>
    </Section>
  );
}

// ---- text --------------------------------------------------------------------------

/** The font list: built in, imported (CapCut's font upload) and, once
 * asked for, the computer's installed families. */
function FontPicker({ value, onChange }: { value: string; onChange: (font: string) => void }) {
  const { imported, system } = useFonts();
  const known = new Set([...FONTS, ...imported, ...system]);
  const option = (f: string) => (
    <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>
      {f}
    </option>
  );
  return (
    <div className="font-picker">
      <select className="field" value={value} aria-label="Font" data-tip={value} onChange={(e) => onChange(e.target.value)}>
        {!known.has(value) && <option value={value}>{value} (not on this computer)</option>}
        <optgroup label="Built in">{FONTS.map(option)}</optgroup>
        {imported.length > 0 && <optgroup label="Imported">{imported.map(option)}</optgroup>}
        {system.length > 0 && <optgroup label="On this computer">{system.filter((f) => !FONTS.includes(f) && !imported.includes(f)).map(option)}</optgroup>}
      </select>
      <div className="font-picker-actions">
        <button
          className="btn ghost"
          onClick={async () => {
            const [first] = await importFonts(await pickFontFiles());
            if (first) onChange(first);
          }}
        >
          Import font…
        </button>
        {canListSystemFonts() && !system.length && (
          <button className="btn ghost" onClick={() => void loadSystemFonts()}>
            Installed fonts
          </button>
        )}
      </div>
    </div>
  );
}


/** Black or white, whichever a color reads better on: the swatch behind
 * a saved style's sample, so a dark style's "Aa" still shows. */
const swatchFor = (hex: string) => {
  const n = parseInt(hex.slice(1, 7), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum > 140 ? "#000000" : "#ffffff";
};

/** CapCut's Save as preset for text: this title's look under a name, and
 * the saved looks as chips that give a title that look in one click, in
 * any project (state/textStyles.ts). */
function SavedStylesSection({ clip }: { clip: TextClip }) {
  const saved = useTextStyles();
  const [naming, setNaming] = useState<string | null>(null);
  const [error, setError] = useState("");
  const save = () => {
    try {
      saveTextStyle(clip.style, naming ?? "");
      setNaming(null);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Section title="Saved styles">
      {saved.length ? (
        <div className="style-chips">
          {saved.map((t) => (
            <span key={t.id} className="style-chip">
              <button className="chip-btn" data-tip={`Give this title the ${t.name} style`} onClick={() => applyTextStyle(t.id, [clip.id])}>
                <span className="style-sample" aria-hidden="true" style={{ fontFamily: t.style.font, color: t.style.color, background: swatchFor(t.style.color), fontWeight: fontWeight(t.style), fontStyle: t.style.italic ? "italic" : undefined }}>
                  Aa
                </span>
                <span className="style-chip-name">{t.name}</span>
              </button>
              <button className="icon-btn small" aria-label={`Delete style ${t.name}`} data-tip="Delete style" onClick={() => deleteTextStyle(t.id)}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="insp-hint">Save this title's look to give it to other titles in one click, in any project.</p>
      )}
      {naming === null ? (
        <div className="insp-actions">
          <button className="btn" onClick={() => setNaming("")}>
            <Plus size={14} /> Save this style
          </button>
        </div>
      ) : (
        <div className="insp-actions">
          <input
            className="field style-name"
            aria-label="Style name"
            placeholder="Style name"
            autoFocus
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation(); // typing is not the editor's keys
              if (e.key === "Enter") save();
              if (e.key === "Escape") setNaming(null);
            }}
          />
          <button className="btn primary" onClick={save}>Save</button>
          <button className="btn ghost" onClick={() => setNaming(null)}>Cancel</button>
        </div>
      )}
      {error && <p className="insp-hint" role="alert">{error}</p>}
    </Section>
  );
}

/** The weights the title's font has (state/fontWeights.ts), named; a
 * weight it lacks stays listed while the title uses it. */
function WeightRow({ style, onChange }: { style: TextStyle; onChange: (weight: number) => void }) {
  const has = useFontWeights(style.font);
  const now = fontWeight(style);
  const list = has.includes(now) ? has : [...has, now].sort((a, b) => a - b);
  return (
    <Row label="Weight">
      <select className="field" aria-label="Font weight" value={now} onChange={(e) => onChange(Number(e.target.value))}>
        {list.map((w) => (
          <option key={w} value={w}>
            {WEIGHT_NAMES[w] ?? "Weight"} {w}
          </option>
        ))}
      </select>
    </Row>
  );
}

/** The text color, keyable (ADR-071): once it has keys, a new color keys
 * the playhead, and the swatch shows the color there. */
function TextColorRow({ clip }: { clip: TextClip }) {
  const rel = useRel(clip);
  const keys = clip.keyframes?.["style.color"];
  const value = keys?.length ? colorAt(keys, rel) : clip.style.color;
  const set = (v: string) =>
    keys?.length
      ? store.edit("Text color", (p) => ops.setParam(p, [clip.id], "style.color", colorKey(v) ?? 0, rel))
      : patchClip(clip.id, "Text color", (c) => ({ ...c, style: { ...(c as TextClip).style, color: v } }) as Clip);
  return (
    <div className="insp-row">
      <label className="insp-label">Color</label>
      <span className="insp-wide">
        <ColorInput label="Text color" value={value} onChange={set} />
      </span>
      <KeyCluster clip={clip} path="style.color" value={colorKey(value) ?? 0} />
    </div>
  );
}

function WordStyle({ clip }: { clip: TextClip }) {
  const [index, setIndex] = useState(0);
  const words = [...clip.text.matchAll(/\S+/g)];
  const word = words[Math.min(index, words.length - 1)];
  if (!word) return null;
  const current = runStyle(clip.style, word.index);
  const apply = (patch: Record<string, unknown>) => edit("Style text range", p => runCommand(p, "style_text_range", { clip_id: clip.id, start: word.index, end: word.index + word[0].length, ...patch }));
  return <Section title="Style range">
    <Row label="Word"><select className="field" aria-label="Style word" data-tip={word[0]} value={Math.min(index, words.length - 1)} onChange={e => setIndex(Number(e.target.value))}>
      {words.map((w, i) => <option key={i} value={i}>{i + 1}. {w[0]}</option>)}
    </select></Row>
    <Row label="Color"><ColorInput label="Word color" value={current.color} onChange={color => apply({ color })} /></Row>
    <WeightRow style={current} onChange={weight => apply({ weight })} />
    <button className="btn" onClick={() => apply({ clear: true })}>Clear word style</button>
  </Section>;
}

function TextTab({ clip }: { clip: TextClip }) {
  const s = clip.style;
  const heavy = fontWeight(s) >= 600;
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
      <WordStyle clip={clip} />
      <Section title="Text">
        {/* Live, like the canvas editor: the viewer redraws as you type, and
            the canvas editor's typing shows up here (ADR-031). */}
        <textarea
          className="field text-area"
          value={clip.text}
          rows={3}
          onFocus={(e) => beginTyping(clip.id, e.currentTarget)}
          onChange={(e) => {
            beginTyping(clip.id, e.currentTarget);
            typeText(e.target.value);
          }}
          onBlur={endTyping}
          onKeyDown={(e) => e.key === "Escape" && (e.target as HTMLTextAreaElement).blur()}
          aria-label="Text"
        />
        <Row label="Font">
          <FontPicker value={s.font} onChange={(font) => style({ font }, "Font")} />
        </Row>
        <WeightRow style={s} onChange={(weight) => style({ weight, bold: weight >= 600 }, "Font weight")} />
        <SliderRow clip={clip} path="style.size" label="Size" min={8} max={400} reset={96} />
        <Row label="Style">
          <div className="style-toggles">
            <button className={`chip-btn${heavy ? " on" : ""}`} aria-label="Bold" data-tip="Bold" aria-pressed={heavy} onClick={() => style({ bold: !heavy, weight: undefined }, "Bold")}><Bold size={14} /></button>
            <button className={`chip-btn${s.italic ? " on" : ""}`} aria-label="Italic" data-tip="Italic" aria-pressed={s.italic} onClick={() => style({ italic: !s.italic }, "Italic")}><Italic size={14} /></button>
            <button className={`chip-btn${s.underline ? " on" : ""}`} aria-label="Underline" data-tip="Underline" aria-pressed={s.underline} onClick={() => style({ underline: !s.underline }, "Underline")}><Underline size={14} /></button>
            <Segmented value={s.align} onChange={(v) => style({ align: v }, "Align")} options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }]} />
          </div>
        </Row>
        <Row label="Case">
          <Segmented
            value={s.case ?? "none"}
            onChange={(v) => style({ case: v === "none" ? undefined : v }, "Text case")}
            options={[
              { value: "none", label: "As typed" },
              { value: "upper", label: <CaseUpper size={16} />, tip: "UPPERCASE" },
              { value: "lower", label: <CaseLower size={16} />, tip: "lowercase" },
              { value: "title", label: <CaseSensitive size={16} />, tip: "Title Case" },
            ]}
          />
        </Row>
        <TextColorRow clip={clip} />
        {clip.caption && (
          <Row label="Spoken word">
            <div className="spoken-word">
              <Toggle on={!!s.highlight} label="Highlight the spoken word" onChange={(on) => style({ highlight: on ? (s.highlight ?? "#ffe14d") : undefined }, on ? "Highlight spoken word" : "No spoken-word highlight")} />
              {s.highlight && <ColorInput label="Spoken word color" value={s.highlight} onChange={(v) => style({ highlight: v }, "Spoken word color")} />}
            </div>
          </Row>
        )}
        <SliderRow clip={clip} path="style.letterSpacing" label="Spacing" min={-20} max={100} reset={0} />
        <SliderRow clip={clip} path="style.lineHeight" label="Line height" min={0.6} max={3} step={0.05} digits={2} reset={1.2} keyframes={false} />
      </Section>
      <Section title="Stroke" on={!!s.stroke && s.stroke.width > 0} extra={<Toggle label="Stroke" on={!!s.stroke && s.stroke.width > 0} onChange={(v) => style({ stroke: { color: s.stroke?.color ?? "#000000", width: v ? Math.max(4, s.stroke?.width ?? 0) : 0 } }, v ? "Add stroke" : "Remove stroke")} />}>
        {s.stroke && s.stroke.width > 0 && (
          <>
            <Row label="Color">
              <ColorInput label="Stroke color" value={s.stroke.color} onChange={(v) => style({ stroke: { ...s.stroke!, color: v } }, "Stroke color")} />
            </Row>
            <SliderRow clip={clip} path="style.stroke.width" label="Width" min={0} max={40} reset={4} keyframes={false} />
            <Row label="Second">
              <div className="spoken-word">
                <Toggle label="Second outline" on={!!s.stroke2 && s.stroke2.width > 0} onChange={(v) => style({ stroke2: v ? { color: s.stroke2?.color ?? "#ffffff", width: Math.max(6, s.stroke2?.width ?? 0) } : undefined }, v ? "Add second outline" : "Remove second outline")} />
                {s.stroke2 && <ColorInput label="Second outline color" value={s.stroke2.color} onChange={(v) => style({ stroke2: { ...s.stroke2!, color: v } }, "Second outline color")} />}
              </div>
            </Row>
            {s.stroke2 && <SliderRow clip={clip} path="style.stroke2.width" label="Second width" min={0} max={40} reset={6} keyframes={false} />}
          </>
        )}
      </Section>
      <Section title="Glow" defaultOpen={!!s.glow} on={!!s.glow} extra={<Toggle label="Glow" on={!!s.glow} onChange={(v) => style({ glow: v ? { color: s.glow?.color ?? "#00e5ff", blur: 24 } : undefined }, v ? "Add glow" : "Remove glow")} />}>
        {s.glow && (
          <>
            <Row label="Color">
              <ColorInput label="Glow color" value={s.glow.color} onChange={(v) => style({ glow: { ...s.glow!, color: v } }, "Glow color")} />
            </Row>
            <SliderRow clip={clip} path="style.glow.blur" label="Size" min={0} max={120} reset={24} keyframes={false} />
            <Row label="Strength">
              <Segmented value={String(s.glow.strength ?? 1) as "1" | "2" | "3"} onChange={(v) => style({ glow: { ...s.glow!, strength: Number(v) } }, "Glow strength")} options={[{ value: "1", label: "Soft" }, { value: "2", label: "Bright" }, { value: "3", label: "Neon" }]} />
            </Row>
          </>
        )}
      </Section>
      <Section title="Gradient" defaultOpen={!!s.gradient} on={!!s.gradient} extra={<Toggle label="Gradient fill" on={!!s.gradient} onChange={(v) => style({ gradient: v ? { from: s.color, to: "#ff3d7f", angle: 0 } : undefined }, v ? "Gradient fill" : "Solid fill")} />}>
        {s.gradient && (
          <>
            <Row label="From">
              <ColorInput label="Gradient start color" value={s.gradient.from} onChange={(v) => style({ gradient: { ...s.gradient!, from: v } }, "Gradient color")} />
            </Row>
            <Row label="To">
              <ColorInput label="Gradient end color" value={s.gradient.to} onChange={(v) => style({ gradient: { ...s.gradient!, to: v } }, "Gradient color")} />
            </Row>
            <SliderRow clip={clip} path="style.gradient.angle" label="Angle" min={-180} max={180} unit="°" reset={0} keyframes={false} />
          </>
        )}
      </Section>
      <Section title="Shadow" on={!!s.shadow} extra={<Toggle label="Shadow" on={!!s.shadow} onChange={(v) => style({ shadow: v ? { color: "#000000aa", blur: 12, x: 4, y: 6 } : undefined }, v ? "Add shadow" : "Remove shadow")} />}>
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
      <Section title="Background" on={!!s.background} extra={<Toggle label="Background" on={!!s.background} onChange={(v) => style({ background: v ? { color: "#000000cc", padding: 16, radius: 8 } : undefined }, v ? "Add background" : "Remove background")} />}>
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
      {/* What a title carries as a picture (an agent's set_shadow,
          set_border or set_colorize) shows here while it has it, so it can
          be seen, changed and removed: a title has no Video or Adjust tab
          (ADR-109). */}
      {clip.shadow && <ShadowSection clip={clip} title="Drop shadow" />}
      {clip.border && <BorderSection clip={clip} />}
      {clip.adjust.colorize && <ColorizeSection clip={clip} />}
      <SavedStylesSection clip={clip} />
      <TransformSection clip={clip} />
      <Section title="Opacity" defaultOpen={false}>
        <SliderRow clip={clip} path="opacity" label="Opacity" min={0} max={100} unit="%" reset={1} {...pct} />
      </Section>
      {!clip.caption && <SpeechSection clip={clip} />}
    </>
  );
}

/** CapCut's Text to speech: the title read aloud in a chosen voice, made on
 * this computer and placed under it (ADR-050). */
function SpeechSection({ clip }: { clip: TextClip }) {
  const speaking = useSpeaking();
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  // A pace, not a speed: the speed is chosen to land the read on a
  // narrator's words a second, moved for slow or fast (ADR-096).
  const [pace, setPace] = useState<"slow" | "normal" | "fast">("normal");
  const [quality, setQuality] = useState<"best" | "draft">("best");
  const busy = speaking?.clipId === clip.id;
  return (
    <Section title="Text to speech" defaultOpen={false}>
      <Row label="Voice">
        <select className="field" aria-label="Voice" value={voice} disabled={busy} onChange={(e) => setVoice(e.target.value)}>
          {VOICES.map((v) => (
            <option key={v.id} value={v.id}>{v.label}</option>
          ))}
        </select>
      </Row>
      <Row label="Pace">
        <Segmented value={pace} onChange={(v) => setPace(v as typeof pace)} options={[{ value: "slow", label: "Slow" }, { value: "normal", label: "Normal" }, { value: "fast", label: "Fast" }]} />
      </Row>
      <Row label="Quality">
        <Segmented value={quality} onChange={(v) => setQuality(v as "best" | "draft")} options={[{ value: "best", label: "Best" }, { value: "draft", label: "Draft" }]} />
      </Row>
      <div className="insp-actions">
        {busy ? (
          <>
            <span className="insp-hint" role="status">Making the voice… {Math.round((speaking?.progress ?? 0) * 100)}%</span>
            <button className="btn ghost" onClick={cancelSpeech}>Cancel</button>
          </>
        ) : (
          <button className="btn" disabled={!!speaking || !clip.text.trim()} onClick={() => void textToSpeech(clip.id, { voice, pace, quality }).catch(() => undefined)}>
            Add voice
          </button>
        )}
      </div>
      <p className="insp-hint">Made on this computer. The first voice downloads the speech model once: about 325 MB for Best (full precision), 90 MB for Draft (8-bit weights).</p>
    </Section>
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
        <input
          type="range"
          className="insp-slider"
          min={0.1}
          max={5}
          step={0.1}
          value={framesToSeconds(tr.duration, fps)}
          {...rangeGesture("Transition")}
          onChange={(e) => store.previewGesture((p) => ops.settle(p, ops.setTransition(p, clip.id, { type: tr.type, duration: secondsToFrames(Number(e.target.value), fps) }), settleOptions()), "Transition")}
          aria-label="Transition duration"
        />
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

const RESOLUTIONS = [720, 1080, 1440, 2160];

function ProjectDetails() {
  const p = useEditor((s) => s.project);
  const short = Math.min(p.width, p.height);
  const ratio = ratioOf(p.width, p.height);
  const setCanvas = (rw: number, rh: number, res: number) => {
    const [w, h] = canvasSize(rw, rh, res);
    store.edit("Canvas size", (q) => ({ ...q, width: w, height: h, canvasFixed: true }));
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
            <ProjectName name={p.name} />
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
            <select className="field" aria-label="Resolution" value={RESOLUTIONS.includes(short) ? short : ""} onChange={(e) => setCanvas(p.width, p.height, Number(e.target.value))}>
              {!RESOLUTIONS.includes(short) && <option value="">{p.width}×{p.height}</option>}
              {RESOLUTIONS.map((r) => (
                <option key={r} value={r}>
                  {r === 2160 ? "4K" : r === 1440 ? "2K" : `${r}p`}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Size">
            <div className="size-fields">
              <SizeField label="Canvas width" value={p.width} onSet={(width) => store.edit("Canvas size", (q) => ({ ...q, width, canvasFixed: true }))} />
              <span aria-hidden="true">×</span>
              <SizeField label="Canvas height" value={p.height} onSet={(height) => store.edit("Canvas size", (q) => ({ ...q, height, canvasFixed: true }))} />
            </div>
          </Row>
          <Row label="Frame rate">
            <select
              className="field"
              aria-label="Frame rate"
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
        {/* Opens when a kit arrives (an agent's set_brand), closed without one. */}
        <BrandSection key={p.brand ? "brand" : "none"} />
        <Section title="Summary">
          <dl className="summary num">
            <dt>Canvas</dt>
            <dd>
              {p.width} × {p.height}
            </dd>
            <dt>Duration</dt>
            <dd>{formatDuration(framesToSeconds(ops.projectDuration(p), p.fps))}</dd>
            <dt>Media</dt>
            {/* As the library counts: stickers are not listed there. */}
            <dd>{((n) => `${n} ${n === 1 ? "file" : "files"}`)(p.assets.filter((a) => !a.sticker).length)}</dd>
            <dt>Tracks</dt>
            <dd>{p.tracks.length}</dd>
          </dl>
          <p className="insp-hint">Select a clip on the timeline to edit it. Positions are kept relative to the canvas, so changing the ratio keeps layouts centered.</p>
        </Section>
      </div>
    </>
  );
}

/** The project's brand kit (set_brand): the colors, fonts and logo that
 * ad elements and branded titles draw with. */
function BrandSection() {
  const p = useEditor((s) => s.project);
  const b = brandOf(p);
  const set = (label: string, args: Record<string, string>) => store.edit(label, (q) => runCommand(q, "set_brand", args));
  const pictures = p.assets.filter((a) => a.kind === "image" && !a.sticker);
  const roles: [ColorRole, string][] = [["primary", "Primary"], ["secondary", "Secondary"], ["accent", "Accent"], ["background", "Background"], ["text", "Text"]];
  return (
    <Section title="Brand" defaultOpen={!!p.brand}>
      {roles.map(([role, label]) => (
        <Row key={role} label={label}>
          <ColorInput label={`Brand ${role} color`} value={b.colors[role]} onChange={(v) => set("Brand color", { [role]: v })} />
        </Row>
      ))}
      <Row label="Headings">
        <FontPicker value={b.fonts.heading} onChange={(font) => set("Brand font", { heading_font: font })} />
      </Row>
      <Row label="Body">
        <FontPicker value={b.fonts.body} onChange={(font) => set("Brand font", { body_font: font })} />
      </Row>
      <Row label="Logo">
        <select className="field" aria-label="Brand logo" data-tip={pictures.find((a) => a.id === b.logos?.main)?.name} value={b.logos?.main ?? ""} onChange={(e) => set("Brand logo", { logo: e.target.value })}>
          <option value="">None</option>
          {pictures.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Row>
      <p className="insp-hint">Ad elements and branded titles use these. Agents set them with set_brand.</p>
    </Section>
  );
}

/** Details > Name: committed on Enter, on leaving the field, and when
 * selecting a clip takes the field away unblurred; Escape reverts, as in
 * the title bar's rename. */
function ProjectName({ name }: { name: string }) {
  const [text, setText] = useState<string | null>(null);
  const commit = (raw: string) => {
    setText(null);
    const v = raw.trim().slice(0, 120);
    if (v && v !== name) store.edit("Rename project", (q) => ({ ...q, name: v }));
  };
  useCommitOnLeave(text, commit);
  return (
    <input
      className="field"
      aria-label="Project name"
      value={text ?? name}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== null && commit(text)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setText(null);
      }}
    />
  );
}

/** A canvas side in pixels (CapCut's custom ratio): even, as encoders
 * need, between 16 and 8192; committed on Enter or leaving the field. */
function SizeField({ label, value, onSet }: { label: string; value: number; onSet: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const commit = (raw: string) => {
    setText(null);
    const typed = parseTyped(raw);
    const n = typed === null ? null : Math.round(typed / 2) * 2;
    if (n !== null && n !== value) onSet(Math.min(8192, Math.max(16, n)));
  };
  useCommitOnLeave(text, commit);
  return (
    <input
      className="field num"
      inputMode="numeric"
      aria-label={label}
      value={text ?? String(value)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== null && commit(text)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setText(null);
      }}
    />
  );
}

function MultiSelection({ count }: { count: number }) {
  const sel = useEditor((s) => s.selection);
  const project = useEditor((s) => s.project);
  const movable = useMovable(sel);
  const clips = sel.flatMap((id) => {
    const c = ops.findClip(project, id)?.clip;
    return c ? [c] : [];
  });
  const pictures = clips.filter((c) => "transform" in c);
  const sounds = clips.filter((c) => "volume" in c);
  return (
    <>
      <nav className="insp-tabs">
        <button className="on">{count} clips</button>
      </nav>
      <div className="insp-body">
        <Section title="Selection">
          <p className="insp-hint">{count} clips selected. Move, delete, copy or split them together; what they share can be set below for all of them at once.</p>
          <div className="insp-actions">
            <button className="btn" data-tip={tipFor("duplicate")} onClick={() => run("duplicate")}>Duplicate</button>
            <button className="btn ghost" data-tip={tipFor("delete")} onClick={() => run("delete")}>Delete</button>
          </div>
          <EffectClipboard />
          <AttributeClipboard />
        </Section>
        <LayoutsSection ids={pictures.map(c => c.id)} />
        {pictures.length > 1 && (
          <Section title={`Picture (${pictures.length} clips)`}>
            <SliderRow clip={pictures[0]} also={pictures.slice(1)} path="transform.scale" label="Scale" min={1} max={500} unit="%" reset={1} keyframes={false} {...pct} />
            <SliderRow clip={pictures[0]} also={pictures.slice(1)} path="transform.rotation" label="Rotate" min={-360} max={360} step={0.1} digits={1} unit="°" reset={0} keyframes={false} />
            <SliderRow clip={pictures[0]} also={pictures.slice(1)} path="opacity" label="Opacity" min={0} max={100} unit="%" reset={1} keyframes={false} {...pct} />
          </Section>
        )}
        {sounds.length > 1 && (
          <Section title={`Sound (${sounds.length} clips)`}>
            <SliderRow clip={sounds[0]} also={sounds.slice(1)} path="volume" label="Volume" min={-60} max={12} step={0.1} digits={1} unit="dB" reset={1} keyframes={false} show={(v) => Math.max(-60, toDb(v))} store={(db) => (db <= -60 ? 0 : fromDb(db))} />
          </Section>
        )}
        {movable > 0 && (
          <Section title="Align">
            <AlignBar ids={sel} />
          </Section>
        )}
      </div>
    </>
  );
}
