// Record browser capabilities against real fixtures, including unsupported
// formats. Each check keeps its evidence; a readable refusal is an expected
// result for optional codecs, not a promise of parity with desktop.
// Run headless: node scripts/drive/run.mjs scripts/drive/web-capabilities.js
async (page, base = "http://localhost:1420") => {
  const { execFileSync } = await import("node:child_process");
  const details = {};
  const environment = {
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    checkedAt: new Date().toISOString(),
    browser: page.context().browser().version(),
    viewport: page.viewportSize(),
  };
  const fresh = async () => {
    await page.goto(base);
    await page.waitForFunction(() => !!window.videoEditor);
    await page.locator(".create-card").click();
  };
  const check = async (name, run) => {
    console.log(`checking ${name}...`);
    try { details[name] = await run(); }
    catch (e) { details[name] = { ok: false, error: e.message }; }
  };
  const place = (name) => page.evaluate(async (name) => {
    const ve = window.videoEditor;
    const [asset] = await ve.import([{ name, src: `${location.origin}/fixtures/media/${name}` }]);
    if (!asset) return null;
    ve.exec("add_media_clip", { asset_id: asset.id, start: 0 });
    ve.seek(15);
    await ve.rendered();
    const pixels = ve.pixels(160);
    return { ...asset, drewFrame: !!pixels && pixels.data.some((v, i) => i % 4 !== 3 && v > 20) };
  }, name);
  const reopen = async (id) => {
    await page.reload();
    await page.waitForFunction(() => !!window.videoEditor);
    await page.locator(".project-card").first().click();
    await page.waitForFunction((id) => window.videoEditor.project().id === id, id);
    await page.evaluate(async () => {
      window.videoEditor.seek(15);
      await window.videoEditor.rendered();
    });
  };
  const saved = async () => {
    await page.evaluate(() => window.videoEditor.action("saveProject"));
    await page.waitForFunction(async () => {
      const p = window.videoEditor.project();
      try {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle("projects");
        const file = await (await dir.getFileHandle(`${p.id}.json`)).getFile();
        const stored = JSON.parse(await file.text());
        return stored.assets.length === p.assets.length && stored.tracks.some((t) => t.clips.length);
      } catch { return false; }
    });
    return page.evaluate(() => window.videoEditor.project().id);
  };

  await check("urlReload", async () => {
    await fresh();
    const asset = await place("h264-1080p30.mp4");
    if (!asset) return { ok: false, error: "H.264 URL import failed" };
    const id = await saved();
    await reopen(id);
    const after = await page.evaluate(() => {
      const ve = window.videoEditor;
      const pixels = ve.pixels(160);
      return { assets: ve.project().assets, drewFrame: !!pixels && pixels.data.some((v, i) => i % 4 !== 3 && v > 20) };
    });
    return { ok: after.assets.some((a) => a.id === asset.id) && after.drewFrame, projectId: id, source: asset.src, drewFrame: after.drewFrame,
      note: "Project JSON persists in OPFS; URL imports still depend on the original URL after reload." };
  });

  await check("localFileReload", async () => {
    await fresh();
    const chooser = page.waitForEvent("filechooser");
    await page.locator(".import-btn").click();
    await (await chooser).setFiles("fixtures/media/h264-1080p30.mp4");
    await page.waitForFunction(() => window.videoEditor.project().assets.length === 1);
    const asset = await page.evaluate(() => {
      const ve = window.videoEditor;
      const asset = ve.project().assets[0];
      ve.exec("add_media_clip", { asset_id: asset.id, start: 0 });
      return asset;
    });
    await page.waitForFunction(async (key) => {
      try {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle("media");
        return (await (await dir.getFileHandle(key)).getFile()).size > 0;
      } catch { return false; }
    }, asset.src);
    const id = await saved();
    // Deny fixture URL requests after reload: the local import must read OPFS.
    await page.route("**/fixtures/media/**", (route) => route.abort());
    let after;
    try {
      await reopen(id);
      after = await page.evaluate(() => {
        const ve = window.videoEditor;
        const pixels = ve.pixels(160);
        return { source: ve.project().assets[0].src, drewFrame: !!pixels && pixels.data.some((v, i) => i % 4 !== 3 && v > 20) };
      });
    } finally { await page.unroute("**/fixtures/media/**"); }
    return { ok: after.source === asset.src && after.drewFrame, projectId: id, ...after };
  });

  for (const name of ["h264-1080p30.mp4", "hevc-1080p.mp4", "vp9-opus.webm", "h264-aac.mkv", "prores-422.mov"]) {
    await check(name, async () => {
      await fresh();
      const asset = await place(name);
      const messages = await page.locator(".toast").allTextContents();
      const supported = !!asset && asset.drewFrame;
      const readableRefusal = !asset && messages.some((m) => m.includes(name) && /decode|format|open/i.test(m));
      return { ok: name === "prores-422.mov" ? readableRefusal : name === "h264-1080p30.mp4" ? supported : supported || readableRefusal,
        supported, videoCodec: asset?.videoCodec, audioCodec: asset?.audioCodec, drewFrame: asset?.drewFrame ?? false, messages };
    });
  }

  for (const format of ["mp4", "webm"]) {
    await check(`export-${format}`, async () => {
      await fresh();
      if (!await place("h264-1080p30.mp4")) throw new Error("H.264 import failed");
      return page.evaluate(async (format) => {
        const result = await window.videoEditor.render({ format, resolution: "720p", start: 0, end: 1 });
        try {
          const blob = await (await fetch(result.url)).blob();
          const video = document.createElement("video");
          video.muted = true;
          video.src = result.url;
          await new Promise((resolve, reject) => {
            video.onloadeddata = resolve;
            video.onerror = () => reject(new Error("Exported video could not be decoded"));
          });
          const decoded = { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
          video.removeAttribute("src");
          video.load();
          return { ok: blob.size > 0 && Math.abs(decoded.duration - 1) < 0.1 && decoded.width > 0,
            format, bytes: result.size, seconds: result.seconds, frames: result.frames,
            videoCodec: result.videoCodec, audioCodec: result.audioCodec, decoded };
        } finally { URL.revokeObjectURL(result.url); }
      }, format);
    });
  }

  await check("captions", async () => {
    await fresh();
    if (!await place("speech-test.wav")) throw new Error("Speech fixture import failed");
    await page.getByRole("tab", { name: "Captions", exact: true }).click();
    await page.locator(".cap-field select").nth(1).selectOption("onnx-community/whisper-tiny.en_timestamped");
    const failedRequests = [];
    const failed = (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText });
    page.on("requestfailed", failed);
    const started = Date.now();
    let error;
    try {
      await page.locator(".cap-go").click();
      await page.waitForSelector(".cap-progress", { timeout: 10000 });
      await page.waitForSelector(".cap-go", { timeout: 300000 });
    } catch (e) { error = e.message; }
    finally { page.off("requestfailed", failed); }
    const result = await page.evaluate(() => ({
      captions: window.videoEditor.project().tracks.flatMap((t) => t.clips).filter((c) => c.type === "text" && c.caption).map((c) => c.text),
      messages: [...document.querySelectorAll(".toast")].map((t) => t.textContent),
      progress: document.querySelector(".cap-progress")?.textContent,
    }));
    return { ok: !error && result.captions.length > 0, model: "onnx-community/whisper-tiny.en_timestamped", elapsedMs: Date.now() - started, error, failedRequests, ...result };
  });
  return { ok: Object.values(details).every((d) => d.ok), environment, details };
};
