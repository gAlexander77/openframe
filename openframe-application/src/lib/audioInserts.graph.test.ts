// Graph topology needs no browser: fake nodes record the actual scheduler's
// connections, while dynamics sample behavior is tested in dynamics.test.ts.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createCompoundClip, createProject, createTrack, clipForAsset } from "./project/defaults";
import { splitAt } from "./project/ops";
import { newInsert } from "./audioInserts";
import type { AudioClip, CompoundClip, Project } from "./project/types";
vi.mock("../engine/media", () => ({ DECODE_PREROLL: 0.1, mediaFor: async () => ({ audioStart: 0, audioSink: { async *buffers() { yield { buffer: { duration: 20 }, timestamp: 0 }; } } }) }));
import { scheduleAudio } from "../engine/audio";
import { insertChain } from "../engine/audioInserts";
import { mixPreroll } from "../engine/mixdown";
class Param {
  value = 0;
  setValueAtTime() {} setValueCurveAtTime() {}
}
const nodes: Node[] = [];
class Node {
  edges: Node[] = [];
  gain = new Param(); pan = new Param(); playbackRate = new Param();
  constructor(readonly ctx?: unknown, readonly options: Record<string, unknown> = {}) { nodes.push(this); }
  connect(next: Node) { this.edges.push(next); return next; }
  disconnect() { this.edges = []; }
  start() {} stop() {}
}
class Worklet extends Node {
  constructor(ctx: unknown, _name: string, options: Record<string, unknown>) { super(ctx, options); }
}
class Compressor extends Node {}
class Gain extends Node {}
class Pan extends Node {}
class Context {
  sampleRate = 48000;
  currentTime = 0;
  destination = new Node();
  audioWorklet = { addModule: vi.fn(async () => {}) };
  createGain() { return new Gain(this); }
  createStereoPanner() { return new Pan(this); }
  createBufferSource() { return new Node(this); }
}
class LiveContext extends Context {}
beforeEach(() => {
  nodes.length = 0;
  vi.stubGlobal("AudioContext", LiveContext);
  vi.stubGlobal("AudioWorkletNode", Worklet);
  vi.stubGlobal("DynamicsCompressorNode", Compressor);
  vi.stubGlobal("GainNode", Gain);
  vi.stubGlobal("StereoPannerNode", Pan);
});
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const p = createProject(), track = createTrack("audio", "Dialog");
  p.assets = [{ id: "a", name: "Voice", src: "voice.wav", kind: "audio", duration: 20, hasAudio: true, hasVideo: false }];
  const c = { ...clipForAsset(p.assets[0], 0, p.fps), duration: 30 } as AudioClip;
  // Different source offsets: these are two cuts, not a coalesced split.
  track.clips = [c, { ...c, id: "second", start: 30, in: 5 }];
  track.inserts = [newInsert("compressor"), newInsert("limiter")];
  p.tracks.push(track);
  return { p, track, c };
}
const render = async (p: Project) => {
  const ctx = new Context();
  const s = scheduleAudio(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, p, 0, 2, 0);
  await s.done; return { ctx, s };
};
it("preserves mono through dynamics before the clip panner, without a 3 dB gain jump", () => {
  for (const type of ["gate", "deesser", "limiter"] as const) {
    insertChain(new Context() as unknown as BaseAudioContext, [newInsert(type)]);
    const node = nodes.at(-1)!;
    expect(node).toBeInstanceOf(Worklet);
    // A single input/output with no fixed outputChannelCount follows its
    // computed input channels; clamped-max caps stereo without upmixing mono.
    expect(node.options).toMatchObject({ numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: "clamped-max" });
    expect(node.options).not.toHaveProperty("outputChannelCount");
  }
});
it("builds one ordered track chain for both sides of a cut, before its fader and pan", async () => {
  const { p, track } = setup(); track.volume = 0.4; track.pan = -0.2;
  const { ctx, s } = await render(p);
  expect(ctx.audioWorklet.addModule).toHaveBeenCalledTimes(1);
  const compressors = nodes.filter(n => n instanceof Compressor), worklets = nodes.filter(n => n instanceof Worklet);
  expect(compressors).toHaveLength(1); expect(worklets).toHaveLength(1);
  // sum -> compressor -> makeup -> limiter -> track fader -> pan
  const makeup = compressors[0].edges[0];
  expect(makeup.edges[0]).toBe(worklets[0]);
  const fader = worklets[0].edges[0];
  expect(fader.options).toHaveProperty("gain", 0.4);
  expect(fader.edges[0]).toBeInstanceOf(Pan);
  expect(fader.edges[0].options).toHaveProperty("pan", -0.2);
  const sum = nodes.find(n => n.edges[0] === compressors[0])!;
  expect(nodes.filter(n => n.edges.includes(sum))).toHaveLength(2);
  expect(mixPreroll(p)).toBe(Infinity);
  s.stop(); s.stop();
});
it("sums an inserted inner track with its dry sibling before the compound compressor", async () => {
  const { p, track, c } = setup();
  const sibling = { ...createTrack("audio", "Bed"), clips: [{ ...c, id: "bed" }] };
  const compound: CompoundClip = { ...createCompoundClip("k", 0, 60), id: "outer", compressor: { threshold: -20, ratio: 4, attack: 0.01, release: 0.1, knee: 6, makeup: 0 } };
  p.tracks = [{ ...p.tracks[0], clips: [compound] }];
  p.compounds = [{ id: "k", name: "Nested", tracks: [track, sibling], markers: [] }];
  await render(p);
  const compressors = nodes.filter(n => n instanceof Compressor);
  expect(compressors).toHaveLength(2);
  const outer = compressors.find(n => n.options.threshold === -20)!;
  const compoundSum = nodes.find(n => n.edges.includes(outer))!;
  expect(nodes.filter(n => n instanceof Pan && n.edges.includes(compoundSum))).toHaveLength(2);
});
it("isolates the same nested track's detector for each compound instance", async () => {
  const { p, track } = setup();
  const compound = createCompoundClip("k", 0, 30);
  p.tracks = [{ ...p.tracks[0], clips: [{ ...compound, id: "one" }, { ...compound, id: "two", start: 30 }] }];
  p.compounds = [{ id: "k", name: "Nested", tracks: [track], markers: [] }];
  await render(p);
  expect(nodes.filter(n => n instanceof Worklet)).toHaveLength(2);
  expect(nodes.filter(n => n instanceof Compressor)).toHaveLength(2);
});

it("retains a compound clip insert's state across an identical split", async () => {
  const { p, track } = setup(); track.inserts = undefined;
  const compound = { ...createCompoundClip("k", 0, 60), inserts: [newInsert("gate")] };
  p.tracks = [{ ...p.tracks[0], clips: [compound] }];
  p.compounds = [{ id: "k", name: "Nested", tracks: [track], markers: [] }];
  await render(splitAt(p, 30, [compound.id]));
  expect(nodes.filter(n => n instanceof Worklet)).toHaveLength(1);
});
