// export_versions keeps each shot's subject (ADR-097), over
// window.videoEditor.mcp as an agent calls it. Two 16:9 shots made here
// with ffmpeg (scratch/, git-ignored): a dark tower right of center on a
// sunset (the Eiffel Tower case) and a white boat left of center that
// moves right over a sea below an island (the speedboat case). A 9:16
// version center-cropped both out of frame in Codex's film. Here:
// - the check sheet reports no cut subject, and a reframe "center" sheet
//   reports both, each with the focus that keeps it (sheets saved to
//   scratch/versions-subject-*.png for a look);
// - save_projects saves the 9:16 version as a project of its own, the
//   master untouched; opened, its frames show the tower and the boat
//   inside the frame at every moment looked at, the boat followed;
// - a focus on the tower's clip places the picture by hand; saliency
//   does not second-guess that explicit subject choice (ADR-139).
async (page) => {
  const fs = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const rpc = (name, args) => page.evaluate(([name, args]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), [name, args]);
  const call = async (name, args = {}) => {
    const r = await rpc(name, args);
    if (r.result?.isError) throw new Error(`${name}: ${r.result.content[0].text}`);
    return r.result.content;
  };
  const text = async (name, args) => JSON.parse((await call(name, args))[0].text);
  const origin = await page.evaluate(() => location.origin);
  const details = {};

  // ---- the two shots --------------------------------------------------------------
  const dir = "__REPO__/scratch";
  const ff = (...args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
  if (!fs.existsSync(`${dir}/subject-tower.mp4`))
    ff("-f", "lavfi", "-i", "color=c=0x000000:s=960x540:d=3:r=30,geq=r='230-150*Y/H':g='140-90*Y/H':b='120+50*Y/H',drawbox=x=0:y=350:w=960:h=190:color=0x1c1a26:t=fill,drawbox=x=636:y=70:w=16:h=290:color=0x140c18:t=fill,drawbox=x=626:y=300:w=36:h=60:color=0x140c18:t=fill,scale=1920:1080", "-c:v", "libx264", "-pix_fmt", "yuv420p", `${dir}/subject-tower.mp4`);
  if (!fs.existsSync(`${dir}/subject-boat.mp4`))
    ff("-f", "lavfi", "-i", "color=c=0x1a5f6e:s=960x540:d=4:r=30,noise=alls=10:allf=t,drawbox=x=0:y=0:w=960:h=125:color=0x96bee1:t=fill,drawbox=x=300:y=100:w=500:h=55:color=0x3c6e37:t=fill", "-f", "lavfi", "-i", "color=c=0xf5f8fa:s=55x18:d=4:r=30", "-filter_complex", "[0][1]overlay=x='300+t*40':y=210,scale=1920:1080", "-c:v", "libx264", "-pix_fmt", "yuv420p", `${dir}/subject-boat.mp4`);
  await text("new_project", { name: "Subject master" });
  const [tower, boat] = await text("import_media", { files: [{ src: `${origin}/scratch/subject-tower.mp4`, name: "subject-tower.mp4" }, { src: `${origin}/scratch/subject-boat.mp4`, name: "subject-boat.mp4" }] });
  const main = (await text("describe_project")).tracks.find((t) => t.main).id;
  await text("batch", { commands: [{ command: "add_media_clip", args: { asset_id: tower.id, start: 0, duration: 3, track_id: main } }, { command: "add_media_clip", args: { asset_id: boat.id, start: 3, duration: 4, track_id: main } }] });
  const clips = (await text("describe_project")).tracks.find((t) => t.main).clips;
  const towerClip = clips.find((c) => c.asset === tower.id).id, boatClip = clips.find((c) => c.asset === boat.id).id;
  const before = await page.evaluate(() => JSON.stringify(window.videoEditor.project()));

  // ---- the check sheet: subject framing, then the old center crop -------------------------
  const at = [0.2, 0.55, 0.75, 0.97];
  const sheet = await call("export_versions", { ratios: ["9:16"], check: true, check_at: at });
  fs.writeFileSync(`${dir}/versions-subject-sheet.png`, Buffer.from(sheet[0].data, "base64"));
  const said = JSON.parse(sheet[1].text);
  details.subjectSheetClean = { ok: sheet[0].type === "image" && !said.subjects, said };
  const center = await call("export_versions", { ratios: ["9:16"], reframe: "center", check: true, check_at: at });
  fs.writeFileSync(`${dir}/versions-subject-center.png`, Buffer.from(center[0].data, "base64"));
  const cut = JSON.parse(center[1].text).subjects?.[0]?.reports ?? [];
  details.centerCropFlagged = {
    ok: cut.some((r) => r.clip_id === towerClip) && cut.some((r) => r.clip_id === boatClip) && cut.every((r) => r.kept < 0.65 && /focus \{clip_id/.test(r.note)),
    cut,
  };

  // ---- a version saved as a project, the master untouched -----------------------------
  const saved = await text("export_versions", { versions: [{ ratio: "9:16", name: "Subject 9x16" }], save_projects: true });
  const after = await page.evaluate(() => JSON.stringify(window.videoEditor.project()));
  const listed = await text("list_projects", {});
  details.savedAsProject = { ok: saved.projects?.[0]?.name === "Subject 9x16" && saved.projects[0].width === 1080 && saved.projects[0].height === 1920 && after === before && listed.some((p) => p.name === "Subject 9x16"), saved };

  // ---- opened, its frames keep the tower and follow the boat --------------------------
  await text("open_project", { project: "Subject 9x16" });
  const d = await text("describe_project");
  const vClips = d.tracks.find((t) => t.main).clips;
  const framing = () => page.evaluate(([id, other]) => {
    const clips = window.videoEditor.project().tracks.flatMap((t) => t.clips);
    return { tower: clips.find((c) => c.id === id)?.transform.x, boat: clips.find((c) => c.id === other)?.transform.x };
  }, [towerClip, boatClip]);
  const autoFrame = await framing();
  const keyed = vClips.find((c) => c.asset === boat.id)?.keyframes?.["transform.x"];
  // Where the subject is in a frame: the darkest column of the sky (the
  // tower), or the brightest blob of the sea (the boat), as a share of the width.
  const find = async (time, what) => {
    const png = (await call("preview_frame", { at: time, max_width: 360 }))[0].data;
    return page.evaluate(async ([png, what]) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext("2d");
      g.drawImage(bmp, 0, 0);
      const { data, width, height } = g.getImageData(0, 0, bmp.width, bmp.height);
      const lum = (x, y) => { const i = (y * width + x) * 4; return 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]; };
      let best = -1, at = -1;
      for (let x = 0; x < width; x++) {
        let s = 0;
        for (let y = Math.floor(height * (what === "tower" ? 0.3 : 0.35)); y < Math.floor(height * (what === "tower" ? 0.55 : 0.45)); y++) s += what === "tower" ? 255 - lum(x, y) : Math.max(0, lum(x, y) - 200);
        if (s > best) [best, at] = [s, x];
      }
      return +(at / width).toFixed(3);
    }, [png, what]);
  };
  const towerAt = [await find(0.5, "tower"), await find(2.5, "tower")];
  const boatAt = [await find(3.3, "boat"), await find(5, "boat"), await find(6.8, "boat")];
  const inside = (x) => x > 0.12 && x < 0.88;
  details.towerInFrame = { ok: towerAt.every(inside), towerAt };
  details.boatFollowed = { ok: boatAt.every(inside) && Array.isArray(keyed) && keyed.length >= 2, boatAt, keys: keyed };
  const frames = await call("preview_frames", { times: [0.5, 2.5, 3.3, 5, 6.8], tile_width: 200, columns: 5 });
  fs.writeFileSync(`${dir}/versions-subject-saved.png`, Buffer.from(frames[0].data, "base64"));

  // ---- a focus by hand owns the subject choice, and still moves the picture -----------
  await text("open_project", { project: "Subject master" });
  const byHand = await call("export_versions", { versions: [{ ratio: "9:16", focus: [{ clip_id: towerClip, x: 0.2 }] }], check: true, check_at: [0.2] });
  const hand = JSON.parse(byHand[1].text);
  const handCut = hand.subjects?.flatMap((v) => v.reports) ?? [];
  // Save and inspect this exact spec too: an empty report alone would
  // also pass if focus silently stopped applying.
  const handSaved = await text("export_versions", { versions: [{ ratio: "9:16", name: "Hand focus 9x16", focus: [{ clip_id: towerClip, x: 0.2 }] }], save_projects: true });
  await text("open_project", { project: "Hand focus 9x16" });
  const handFrame = await framing();
  details.focusByHand = { ok: byHand[0].type === "image" && handCut.length === 0 && handSaved.projects?.length === 1 && Number.isFinite(handFrame.tower) && handFrame.tower > 0 && Math.abs(handFrame.tower - autoFrame.tower) > 0.1 && handFrame.boat === autoFrame.boat, handCut, handFrame, autoFrame };

  return { ok: Object.values(details).every((x) => x.ok), details };
};
