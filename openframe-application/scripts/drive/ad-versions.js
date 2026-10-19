// A 9:16 ad refit to other shapes: a logo picture, set_brand, a logo
// reveal over the footage (no card), a kinetic headline, an offer badge
// with a tag, and an end card (logo, headline, button, url), all through
// MCP. export_versions with check: true for 16:9, 1:1 and 4:5 answers a
// contact sheet (scratch/ad-versions-sheet.png). Then each version's
// project (lib/versions.ts, the same function export_versions renders)
// is measured at the end card's last frame and at the badge's: no two
// text boxes of one element may intersect, and every box must sit inside
// the frame's safe area (90% title-safe; on 9:16 also clear of the
// bottom 35% and the right 19%). The 9:16 master is measured the same
// way, plus the ad elements' design rules: no text under 40 px at a
// 1080 short side, the end card centered, the badge in the top right.
async (page) => {
  const fs = await import("node:fs");
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  page.setDefaultTimeout(20000);
  const details = {};
  const mcp = (name, args) => page.evaluate(([name, args]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), [name, args]);
  const call = async (name, args) => {
    const r = await mcp(name, args);
    if (r.result?.isError) throw new Error(`${name}: ${r.result.content[0].text}`);
    return r.result.content;
  };
  const origin = await page.evaluate(() => location.origin);

  // A logo: a coral disc with a white mark and a wordmark, on transparency.
  const logo = await page.evaluate(async () => {
    const c = new OffscreenCanvas(900, 300);
    const g = c.getContext("2d");
    g.fillStyle = "#ff5a5f";
    g.beginPath();
    g.arc(150, 150, 130, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#ffffff";
    g.font = "bold 170px Arial Black, Arial";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("E", 150, 160);
    g.font = "bold 120px Arial Black, Arial";
    g.textAlign = "left";
    g.fillText("EMBER", 310, 160);
    const bytes = new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer());
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  fs.mkdirSync("__REPO__/scratch", { recursive: true });
  fs.writeFileSync("__REPO__/scratch/ad-versions-logo.png", Buffer.from(logo, "base64"));

  await call("set_project", { width: 1080, height: 1920, name: "Ember" });
  const [photo, music, mark] = JSON.parse((await call("import_media", { files: [{ src: `${origin}/fixtures/media/photo.jpg` }, { src: `${origin}/fixtures/media/music-30s.mp3` }, { src: `${origin}/scratch/ad-versions-logo.png` }] }))[0].text);
  await call("add_media_clip", { asset_id: photo.id, start: 0, duration: 12 });
  await call("add_media_clip", { asset_id: music.id, start: 0, duration: 12 });
  await call("set_brand", { name: "Ember Roast", primary: "#ff5a5f", secondary: "#2b2d42", accent: "#ffd23f", background: "#1b1b2f", text: "#ffffff", heading_font: "Arial Black", body_font: "Segoe UI", logo: mark.id, url: "emberroast.example", tagline: "Small-batch coffee" });
  await call("add_ad_element", { element: "logo_reveal", start: 0, duration: 2.5, background: "none", headline: "Ember Roast", logo: "none" });
  await call("add_text", { text: "Wake up to fire", start: 2.5, duration: 3, y: -0.12, role: "headline" });
  const kinetic = await page.evaluate(() => window.videoEditor.project().tracks.flatMap((t) => t.clips).find((c) => c.type === "text" && c.text === "Wake up to fire").id);
  await call("set_animation", { clip_id: kinetic, slot: "in", type: "wordRise", duration: 0.8 });
  await call("add_ad_element", { element: "offer_badge", start: 5.5, duration: 3, headline: "-30%", subline: "Today only" });
  await call("add_ad_element", { element: "end_card", start: 9, duration: 3, headline: "Fresh roast, every morning", cta: "Order now" });

  // ---- look first ------------------------------------------------------------------
  const master = await call("preview_frames", { times: [1.8, 4, 6.5, 11.5], tile_width: 360, columns: 4 });
  fs.writeFileSync("__REPO__/scratch/ad-versions-master.png", Buffer.from(master[0].data, "base64"));
  const ratios = ["16:9", "1:1", "4:5"];
  const sheet = await call("export_versions", { versions: ratios.map((ratio) => ({ ratio })), check: true });
  fs.writeFileSync("__REPO__/scratch/ad-versions-sheet.png", Buffer.from(sheet[0].data, "base64"));
  details.sheet = { ok: sheet[0].type === "image" };

  // ---- measure ---------------------------------------------------------------------
  const measured = await page.evaluate(async (ratios) => {
    const { versionProject } = await import("/src/lib/versions.ts");
    const { safeArea } = await import("/src/lib/ads.ts");
    const { layerBox } = await import("/src/lib/align.ts");
    const { layerAt } = await import("/src/lib/render/plan.ts");
    const master = window.videoEditor.project();
    const shapes = [{ ratio: "9:16 master", q: master }, ...ratios.map((ratio) => ({ ratio, q: versionProject(master, { ratio }) }))];
    const r2 = (v) => +v.toFixed(1);
    return shapes.map(({ ratio, q }) => {
      const s = safeArea(q);
      const area = { left: s.left * q.width, right: q.width * (1 - s.right), top: s.top * q.height, bottom: q.height * (1 - s.bottom) };
      const all = q.tracks.flatMap((t) => t.clips);
      // Each part at the element's last frame, its intro done, at rest (a
      // pulse loop swells a button by a few percent and back).
      const element = (name) => {
        const parts = all.filter((c) => c.name === name && c.type !== "color");
        const at = Math.max(...parts.map((c) => c.start + c.duration)) - 1;
        return parts.map((c) => {
          const layer = layerAt(q, { ...c, animLoop: undefined }, at);
          const b = layerBox(q, c, layer);
          return { id: c.id, type: c.type, text: c.text, size: c.style?.size, x: c.transform.x, rot: layer.rotation, cx: b.cx, cy: b.cy, w: b.w, h: b.h, left: r2(b.cx - b.hw), right: r2(b.cx + b.hw), top: r2(b.cy - b.hh), bottom: r2(b.cy + b.hh) };
        });
      };
      // Two boxes, each turned about its center (a tilted badge), overlap
      // unless some edge direction separates them (separating axes).
      const intersect = (a, b) => {
        const corners = (r) => {
          const t = (r.rot * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
          return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [r.cx + (u * r.w * c) / 2 - (v * r.h * s) / 2, r.cy + (u * r.w * s) / 2 + (v * r.h * c) / 2]);
        };
        const A = corners(a), B = corners(b);
        for (const r of [a, b]) {
          const t = (r.rot * Math.PI) / 180;
          for (const [ax, ay] of [[Math.cos(t), Math.sin(t)], [-Math.sin(t), Math.cos(t)]]) {
            const pa = A.map(([x, y]) => x * ax + y * ay), pb = B.map(([x, y]) => x * ax + y * ay);
            if (Math.max(...pa) <= Math.min(...pb) + 0.5 || Math.max(...pb) <= Math.min(...pa) + 0.5) return false;
          }
        }
        return true;
      };
      const overlaps = (boxes) => {
        const out = [];
        for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j];
            if (a.type !== "text" || b.type !== "text") continue;
            if (intersect(a, b)) out.push(`${a.text} x ${b.text}`);
          }
        return out;
      };
      const outside = (boxes) => boxes.filter((b) => b.left < area.left - 1 || b.right > area.right + 1 || b.top < area.top - 1 || b.bottom > area.bottom + 1).map((b) => b.text ?? b.type);
      const card = element("End card"), badge = element("Offer badge");
      const texts = all.filter((c) => c.type === "text");
      const floor = (40 * Math.min(q.width, q.height)) / q.height;
      return {
        ratio,
        size: `${q.width}x${q.height}`,
        area: Object.fromEntries(Object.entries(area).map(([k, v]) => [k, r2(v)])),
        card,
        badge,
        overlaps: [...overlaps(card), ...overlaps(badge)],
        outside: [...outside(card), ...outside(badge)],
        floor: r2(floor),
        small: texts.filter((c) => c.style.size < floor - 0.01).map((c) => `${c.text} ${c.style.size}`),
      };
    });
  }, ratios);
  for (const m of measured) details[m.ratio] = { ok: m.overlaps.length === 0 && m.outside.length === 0 && m.small.length === 0, ...m };

  // The master's own layout: the end card centered on the frame, the badge
  // against the safe area's top-right corner.
  const m0 = measured[0];
  const cardCenter = (Math.min(...m0.card.map((b) => b.left)) + Math.max(...m0.card.map((b) => b.right))) / 2;
  const badgeRight = Math.max(...m0.badge.map((b) => b.right));
  details.placement = { ok: Math.abs(cardCenter - 540) < 2 && Math.abs(badgeRight - m0.area.right) < 2 && m0.badge.every((b) => b.left > 540), cardCenter, badgeRight, badgeLeft: Math.min(...m0.badge.map((b) => b.left)) };

  // Text over footage carries a shadow, outline or box.
  const bare = await page.evaluate(() =>
    window.videoEditor
      .project()
      .tracks.flatMap((t) => t.clips)
      .filter((c) => c.type === "text" && c.name === "Logo reveal" && !c.style.shadow && !c.style.background && !(c.style.stroke?.width > 0))
      .map((c) => c.text),
  );
  details.contrast = { ok: bare.length === 0, bare };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
