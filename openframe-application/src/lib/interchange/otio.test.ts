import { describe, expect, it } from "vitest";
import { describeProject, runCommand } from "../commands";
import { createProject } from "../project/defaults";
import type { Project } from "../project/types";
import { fileUrl, toOtio } from "./otio";

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// 25 fps: a 4 s talk clip at 0, a second piece at 4 s with a 10-frame
// dissolve between them, a title from 1 s on a track above, music after a
// 2 s gap, one marker.
function project(): Project {
  let p: Project = {
    ...createProject({ fps: { num: 25, den: 1 } }),
    assets: [
      { id: "a1", kind: "video", name: "talk.mp4", src: "C:\\Media\\my talk.mp4", duration: 20, hasVideo: true, hasAudio: true },
      { id: "a2", kind: "audio", name: "song.mp3", src: "/music/song.mp3", duration: 30, hasVideo: false, hasAudio: true },
    ],
  };
  p = runCommand(p, "add_media_clip", { asset_id: "a1", start: 0, in: 2, duration: 4 });
  p = runCommand(p, "add_media_clip", { asset_id: "a1", start: 4, in: 10, duration: 3 });
  const first = describeProject(p).tracks.find((t) => t.main)!.clips[0].id;
  p = runCommand(p, "set_transition", { clip_id: first, type: "dissolve", duration: 0.4 });
  p = runCommand(p, "add_text", { text: "Hello", start: 1, duration: 2 });
  p = runCommand(p, "add_media_clip", { asset_id: "a2", start: 2, duration: 5 });
  p = runCommand(p, "add_markers", { times: [3], label: "Beat" });
  return p;
}

describe("toOtio", () => {
  const t = toOtio(project()) as J;
  const tracks = t.tracks.children as J[];

  it("stacks tracks bottom to top, with the picture's sound linked below the music", () => {
    expect(tracks.map((x) => [x.kind, x.children.length])).toEqual([
      ["Video", 3], // main: clip, transition, clip
      ["Video", 2], // title track: gap, text
      ["Audio", 3], // the talk clips' own sound, with the dissolve
      ["Audio", 2], // music: gap, clip
    ]);
  });

  it("writes source ranges in the project's rate and centers transitions on the cut", () => {
    const [a, tr, b] = tracks[0].children as J[];
    expect(a.source_range.start_time).toEqual({ OTIO_SCHEMA: "RationalTime.1", rate: 25, value: 50 });
    expect(a.source_range.duration.value).toBe(100);
    expect(b.source_range.start_time.value).toBe(250);
    expect(tr).toMatchObject({ OTIO_SCHEMA: "Transition.1", transition_type: "SMPTE_Dissolve", in_offset: { value: 5 }, out_offset: { value: 5 } });
    expect(a.media_reference).toMatchObject({ target_url: "file:///C:/Media/my%20talk.mp4", available_range: { duration: { value: 500 } } });
  });

  it("keeps gaps, titles as generators, and markers", () => {
    const [g, title] = tracks[1].children as J[];
    expect(g).toMatchObject({ OTIO_SCHEMA: "Gap.1", source_range: { duration: { value: 25 } } });
    expect(title).toMatchObject({ name: "Hello", media_reference: { OTIO_SCHEMA: "GeneratorReference.1", generator_kind: "text", parameters: { text: "Hello" } } });
    expect(tracks[3].children[0].source_range.duration.value).toBe(50);
    expect(t.tracks.markers[0]).toMatchObject({ name: "Beat", marked_range: { start_time: { value: 75 } } });
  });

  it("turns paths into file URLs and leaves URLs and bare names alone", () => {
    expect(fileUrl("/music/a #1.mp3")).toBe("file:///music/a%20%231.mp3");
    expect(fileUrl("https://x.test/a.mp4")).toBe("https://x.test/a.mp4");
    expect(fileUrl("opfs-name.mp4")).toBe("opfs-name.mp4");
    expect(fileUrl("\\\\server\\share\\a #1.mov")).toBe("file://server/share/a%20%231.mov");
  });
});
