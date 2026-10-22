// One graph builder for preview, export and all measurements (ADR-134).
import workletUrl from "./dynamics.worklet.ts?worker&url";
import type { Insert, Project } from "../lib/project/types";
import { echoNodes, reverbNodes, type FxChain } from "./soundFx";
const modules = new WeakMap<BaseAudioContext, Promise<void>>();
export function prepareInserts(ctx: BaseAudioContext, p: Project): Promise<void> {
  const tracks = [...p.tracks, ...(p.compounds ?? []).flatMap(k => k.tracks)];
  const lists = tracks.flatMap(t => [t.inserts, ...t.clips.map(c => "inserts" in c ? c.inserts : undefined)]);
  if (!lists.some(list => list?.some(i => i.on && ["gate", "deesser", "limiter"].includes(i.type)))) return Promise.resolve();
  if (!ctx.audioWorklet) return Promise.reject(new Error("Audio dynamics require AudioWorklet support in this audio context"));
  let ready = modules.get(ctx);
  if (!ready) {
    ready = ctx.audioWorklet.addModule(workletUrl).catch(e => { modules.delete(ctx); throw e; });
    modules.set(ctx, ready);
  }
  return ready;
}
export function insertChain(ctx: BaseAudioContext, inserts?: Insert[]): FxChain | null {
  let chain: FxChain | null = null;
  for (const i of inserts ?? []) {
    if (!i.on) continue;
    let next: FxChain;
    if (i.type === "eq") {
      const filters = i.params.bands.filter(b => b.on).map(b => new BiquadFilterNode(ctx, { type: b.type, frequency: Math.min(b.freq, ctx.sampleRate * 0.475), gain: b.gain, Q: b.type === "highpass" || b.type === "lowpass" ? 20 * Math.log10(b.q) : b.q }));
      if (!filters.length) continue;
      filters.slice(1).forEach((f, n) => filters[n].connect(f));
      next = { input: filters[0], output: filters.at(-1)! };
    } else if (i.type === "compressor") {
      const c = i.params;
      const comp = new DynamicsCompressorNode(ctx, c), makeup = new GainNode(ctx, { gain: 10 ** (c.makeup / 20) });
      comp.connect(makeup); next = { input: comp, output: makeup };
    } else if (i.type === "echo") next = echoNodes(ctx, i.params, () => null, () => {});
    else if (i.type === "reverb") next = reverbNodes(ctx, i.params, () => null, () => {});
    else {
      // One input/output follows the input's channel count. Forcing stereo
      // duplicates a mono source before its panner, raising center gain 3 dB.
      const node = new AudioWorkletNode(ctx, "openframe-dynamics", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: "clamped-max", processorOptions: i });
      next = { input: node, output: node };
    }
    if (chain) { chain.output.connect(next.input); chain.output = next.output; } else chain = next;
  }
  return chain;
}
