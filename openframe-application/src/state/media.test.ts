import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_MEDIA_BROWSER, filterMedia } from "../lib/mediaLibrary";
import { createProject } from "../lib/project/defaults";
import { runCommand } from "../lib/commands";
import { planFrame } from "../lib/render/plan";
import type { ImportedFile } from "../platform";
import { platform } from "../platform";
import { store } from "./store";
import { importFiles } from "./media";

vi.mock("../platform", () => ({ platform: { kind: "web", adoptUrl: vi.fn() } }));
vi.mock("../engine/media", () => ({ probe: vi.fn(async () => ({ kind: "image", duration: 0, width: 1920, height: 1080, hasVideo: true, hasAudio: false, decodable: true })) }));
vi.mock("../engine/thumbs", () => ({ prepare: vi.fn() }));
vi.mock("./actions", () => ({ edit: vi.fn(), provide: vi.fn() }));
vi.mock("./proxies", () => ({ createProxies: vi.fn(), proxyAction: vi.fn() }));
vi.mock("./luts", () => ({ importLuts: vi.fn(), isLutName: (name: string) => /\.cube$/i.test(name) }));
vi.mock("./toast", () => ({ toast: () => "toast", updateToast: vi.fn(), dismiss: vi.fn() }));

beforeEach(() => {
  store.load(createProject());
  vi.mocked(platform.adoptUrl!).mockResolvedValue({ name: "stored-color-bars.png", src: "stored-color-bars.png", size: 200 });
});

it("film5-layout: imports the nameless color-bars URL and renders its library entry", async () => {
  // Exactly what automation.import handed importFiles before name was optional
  // in its TypeScript signature. The browser drive is untyped JavaScript.
  const files = [{ src: "http://localhost:1420/fixtures/media/color-bars.png", size: 0 }] as ImportedFile[];
  const [pic] = await importFiles(files);
  expect(pic.name).toBe("color-bars.png");
  expect(pic.src).toBe("stored-color-bars.png");
  expect(filterMedia(store.document().assets, new Map(), DEFAULT_MEDIA_BROWSER)).toEqual([pic]);
  expect(filterMedia(store.document().assets, new Map(), { ...DEFAULT_MEDIA_BROWSER, query: "COLOR-BARS" })).toEqual([pic]);

  // Continue the drive's command sequence through the pure render plan.
  let p = runCommand(store.document(), "set_project", { width: 1080, height: 1920 });
  p = runCommand(p, "add_color_clip", { color: "#ff0000", start: 0, duration: 4 });
  p = runCommand(p, "add_media_clip", { asset_id: pic.id, start: 0, duration: 4 });
  const c = p.tracks.flatMap(t => t.clips).find(c => c.type === "image")!;
  p = runCommand(p, "set_crop", { clip_ids: [c.id], left: 0.09, right: 0.54, top: 0.04, bottom: 0.59 });
  p = runCommand(p, "set_param", { clip_ids: [c.id], path: "transform.scale", value: 2.5 });
  p = runCommand(p, "set_canvas_fill", { clip_ids: [c.id], fill: "color", color: "#071322" });
  const fill = planFrame(p, 1).find(i => i.kind === "layer" && i.layer.clipId === `${c.id}#canvas`);
  expect(fill).toMatchObject({ kind: "layer", layer: { scale: 1, crop: { left: 0, right: 0, top: 0, bottom: 0 }, source: { kind: "color", color: "#071322" } } });
});

it("keeps an explicit display name after copying a URL into browser storage", async () => {
  const [pic] = await importFiles([{ name: "Launch still", src: "http://localhost:1420/fixtures/media/color-bars.png", size: 0 }]);
  expect(pic.name).toBe("Launch still");
});
