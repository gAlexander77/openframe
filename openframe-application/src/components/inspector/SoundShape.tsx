// Sound shaping uses the same commands as an agent; one gesture, one edit.
import { FADE_CURVES, type AudioClip, type CompoundClip, type Project, type VideoClip } from "../../lib/project/types";
import { RotateCcw } from "../../icons";
import { runCommand } from "../../lib/commands";
import { VOICE_PRESETS } from "../../lib/soundFx";
import { auditionClip } from "../../state/audition";
import { store } from "../../state/store";
import { toast } from "../../state/toast";
import { Row, Section, SliderRow, Toggle } from "./controls";

type SoundClip = AudioClip | VideoClip;
export function FadeCurveRow({ clip, side }: { clip: SoundClip | CompoundClip; side: "in" | "out" | "crossfade" }) {
  const cross = side === "crossfade";
  const value = cross ? (clip as AudioClip).crossfadeCurve ?? "equalPower" : (side === "in" ? clip.fadeInCurve : clip.fadeOutCurve) ?? "linear";
  const label = cross ? "Crossfade curve" : `Fade ${side} curve`;
  return <select className="field" aria-label={label} title={FADE_CURVES[value]} disabled={cross && !(clip as AudioClip).crossfade} value={value} onChange={(e) => store.edit(label, (p) => runCommand(p, cross ? "set_crossfade" : "set_fades", cross ? { clip_id: clip.id, seconds: (clip as AudioClip).crossfade ?? 0, curve: e.target.value } : { clip_ids: [clip.id], [`curve_${side}`]: e.target.value }))}>
    {Object.entries(FADE_CURVES).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
  </select>;
}

export function PitchRow({ clip }: { clip: SoundClip }) {
  return <SliderRow clip={clip} path="pitch" label="Pitch" min={-12} max={12} step={0.1} digits={1} unit="st" reset={0} keyframes={false} apply={(v) => (p: Project) => runCommand(p, "set_pitch", { clip_ids: [clip.id], semitones: v })} accessory={<button className="icon-btn small" aria-label="Reset pitch" data-tip="Reset pitch" onClick={() => store.edit("Reset pitch", (p) => runCommand(p, "set_pitch", { clip_ids: [clip.id], semitones: 0 }))}><RotateCcw size={12} /></button>} />;
}

export function VoiceChangerSection({ clip }: { clip: SoundClip }) {
  const apply = (preset: string) => {
    store.edit("Voice changer", (p) => runCommand(p, "apply_voice_preset", { clip_ids: [clip.id], preset }));
    void auditionClip(clip.id).catch((e) => toast(String(e), "error"));
  };
  return <Section title="Voice changer" onReset={() => apply("none")}>
    <div className="voice-presets" role="group" aria-label="Voice changer presets">
      {[{ id: "none", label: "None" }, ...Object.entries(VOICE_PRESETS).map(([id, p]) => ({ id, label: p.label }))].map(({ id, label }) => <button key={id} className={`btn${(clip.voice ?? "none") === id ? " active" : " ghost"}`} data-tip={label} aria-pressed={(clip.voice ?? "none") === id} onClick={() => apply(id)}>{label}</button>)}
    </div>
    <p className="insp-hint">Applies and auditions the first three seconds. Fine-tune Pitch, Equalizer, Compressor and Effects below.</p>
    {clip.voice && <p className="insp-hint">Based on {VOICE_PRESETS[clip.voice]?.label ?? clip.voice}; the settings remain editable.</p>}
    {clip.saturation && <SliderRow clip={clip} path="saturation.drive" label="Saturation drive" min={0} max={100} unit="%" reset={0} keyframes={false} show={(v) => v * 100} store={(v) => v / 100} />}
    {clip.ringMod && <>
      <SliderRow clip={clip} path="ringMod.frequency" label="Robot frequency" min={20} max={200} unit="Hz" reset={65} keyframes={false} />
      <SliderRow clip={clip} path="ringMod.mix" label="Robot mix" min={0} max={100} unit="%" reset={0} keyframes={false} show={(v) => v * 100} store={(v) => v / 100} />
    </>}
    {clip.voice && <Row label="Mono"><Toggle label="Mono" on={!!clip.mono} onChange={(mono) => store.edit("Mono", (p) => ({ ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => c.id === clip.id ? { ...c, mono } : c) })) }))} /></Row>}
  </Section>;
}
