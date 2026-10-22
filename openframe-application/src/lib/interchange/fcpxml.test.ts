import { expect, it } from "vitest";
import fixture from "./fixture.json";
import { createProject, createTextClip, createTrack, normalizeProject } from "../project/defaults";
import { toFcpxml, fromFcpxml } from "./fcpxml";
import type { Project } from "../project/types";

const cuts = (p: Project) => p.tracks.map(t => [t.name, t.kind, !!t.main, t.clips.map(c => [c.type, c.start, c.duration, "in" in c ? c.in : 0, "transitionOut" in c ? c.transitionOut : null])]);
it("round trips the full fixture through native FCPXML lanes, resources, transitions and compounds", () => {
  const p = normalizeProject(fixture), xml = toFcpxml(p), r = fromFcpxml(xml);
  expect(r.warnings).toEqual([]);
  expect(cuts(r.project)).toEqual(cuts(p));
  expect(r.project.markers.map(m => [m.frame, m.label])).toEqual([[50, "Cut & cue"]]);
  expect(r.project.compounds?.map(k => [k.name, cuts({ ...p, tracks: k.tracks }), k.markers.map(m => [m.frame, m.label])])).toEqual(p.compounds?.map(k => [k.name, cuts({ ...p, tracks: k.tracks }), k.markers.map(m => [m.frame, m.label])]));
  expect(xml).toContain('version="1.10"');
  expect(xml).toContain('src="file:///C:/Media/Long%20shot.mp4"');
  expect(xml).toContain('<filter-video ref="dissolve"/>');
});
it("snapshots a minimal timeline's XML", () => {
  const p = createProject({ name: 'A & "B"', fps: { num: 25, den: 1 } });
  expect(toFcpxml(p)).toMatchSnapshot();
  expect(toFcpxml(normalizeProject(fixture))).toMatchSnapshot();
});
it("reads plain Final Cut exports with source-clock connections, gap markers and NTSC rational time", () => {
  const r = fromFcpxml(`<?xml version="1.0"?><!DOCTYPE fcpxml><fcpxml version="1.10"><resources>
    <format id="f" frameDuration="1001/30000s" width="1280" height="720"/>
    <asset id="a" name="Shot" start="3600s" duration="10s" hasVideo="1" hasAudio="1"><media-rep src="file:///shots/a.mov"/></asset>
    <asset id="b" name="Music" hasAudio="1" duration="10s"><media-rep src="file:///music.wav"/></asset>
    </resources><library><event><project name="Plain"><sequence format="f" tcStart="3600s"><spine>
    <gap offset="3600s" start="0s" duration="1001/30000s"><marker start="0s" value="Head"/></gap>
    <asset-clip ref="a" offset="108001001/30000s" start="3602s" duration="1001/3000s">
      <asset-clip ref="b" lane="-1" offset="3602s" start="1s" duration="1001/3000s"/>
    </asset-clip></spine></sequence></project></event></library></fcpxml>`);
  expect(r.project.fps).toEqual({ num: 30000, den: 1001 });
  expect(r.project.tracks[0].clips[0]).toMatchObject({ start: 1, duration: 10, in: 2 });
  expect(r.project.tracks[1].clips[0]).toMatchObject({ type: "audio", start: 1, duration: 10, in: 1 });
  expect(r.project.markers[0]).toMatchObject({ frame: 0, label: "Head" });
});
it("reports unsupported effects and rejects malformed XML and cyclic compounds", () => {
  expect(() => fromFcpxml("<fcpxml><library></fcpxml>")).toThrow(/Mismatched/);
  expect(() => fromFcpxml("<fcpxml/> ")).toThrow(/sequence/);
  const xml = toFcpxml(normalizeProject(fixture));
  expect(fromFcpxml(xml.replace('<spine>', '<spine><title duration="1s"/>')).warnings.join(" ")).toMatch(/title/);
  expect(() => fromFcpxml(xml.replace('ref="a1"', 'ref="c1"').replace('ref="a1"', 'ref="c1"'))).toThrow(/Cyclic/);
});
it("round trips generated overlays in connected storylines, odd dissolves and repeated compounds", () => {
  const p = normalizeProject(fixture);
  const title = createTrack("video", "Titles");
  title.clips.push(createTextClip('Hello <&> "world"', 25, 40));
  p.tracks.unshift(title);
  const c = p.tracks[1].clips[1];
  p.tracks[1].clips.push({ ...c, id: "again", start: 200 });
  const mainClip = p.tracks.find(t => t.main)!.clips[0];
  if ("transitionOut" in mainClip) mainClip.transitionOut!.duration = 9;
  const xml = toFcpxml(p), r = fromFcpxml(xml);
  expect(cuts(r.project)).toEqual(cuts(p));
  expect(r.project.compounds).toHaveLength(1);
  expect(r.project.tracks[0].clips[0]).toMatchObject({ type: "text", text: 'Hello <&> "world"' });
  expect(xml).toMatch(/<title[^>]+lane="2"/);
  expect(xml).not.toMatch(/<gap[^>]+lane=/);
});
it("reads clip/video wrappers and asset-clip's default resource duration", () => {
  const r = fromFcpxml(`<fcpxml version="1.10"><resources><format id="f" frameDuration="1/25s"/><asset id="a" start="3600s" duration="10s"><media-rep src="file:///a.mov"/></asset></resources><library><event><project><sequence format="f"><spine>
    <clip offset="0s" start="0s" duration="2s"><video ref="a" offset="0s" start="3601s" duration="2s"/></clip>
    <asset-clip ref="a" offset="2s" start="3602s"/>
    </spine></sequence></project></event></library></fcpxml>`);
  expect(r.project.tracks[0].clips.map(c => [c.start, c.duration, "in" in c && c.in])).toEqual([[0, 50, 1], [50, 200, 2]]);
});
it("carries dissolves on connected overlay storylines", () => {
  const p = normalizeProject(fixture), overlay = p.tracks[0];
  overlay.clips = [{ ...p.tracks[1].clips[0], start: 25 }, { ...p.tracks[1].clips[1], start: 75 }];
  const r = fromFcpxml(toFcpxml(p));
  expect(r.warnings).toEqual([]);
  expect(cuts(r.project)).toEqual(cuts(p));
});

it("film 5: writes visible native titles, chapter markers and ducked volume with fades", () => {
  const p = normalizeProject(fixture);
  const title = createTrack("video", "Titles");
  title.clips.push(createTextClip("Jeanette Epps\nNASA astronaut", 25, 100));
  p.tracks.unshift(title);
  p.markers.push({ id: "chapter", frame: 75, label: "Discovery", chapter: true, color: "red" });
  const t = p.tracks.find(t => t.kind === "audio")!;
  const c = t.clips[0];
  if (c.type !== "audio") throw Error("audio");
  c.volume = 0.5; c.fadeIn = 5; c.fadeOut = 10;
  c.keyframes = { volume: [{ f: 0, v: 0.5 }, { f: 25, v: 0.1 }, { f: 75, v: 0.5 }] };
  const xml = toFcpxml(p);
  expect(xml).toContain('<title ref="basic-title"');
  expect(xml).toContain('<text><text-style ref=');
  expect(xml).toContain('Jeanette Epps&#10;NASA astronaut');
  expect(xml).toContain('<chapter-marker start=');
  expect(xml).toContain('<adjust-volume amount="-6.0206dB">');
  expect(xml).toContain('<fadeIn type="linear" duration="5/25s"/>');
  expect(xml).toContain('<fadeOut type="linear" duration="10/25s"/>');
  expect(xml).toContain('value="-20dB"');
  expect(xml).toContain('<keyframe time="50/25s" value="-20dB" interp="linear" curve="linear"/>');
  expect(xml).toContain('<chapter-marker start="150/25s" duration="1/25s" value="Discovery"/>');
});
