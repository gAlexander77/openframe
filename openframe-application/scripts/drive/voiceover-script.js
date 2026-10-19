// add_voiceover over MCP: each spoken line is trimmed to its words (the
// voice model pads about half a second of silence first, which put every
// reported time and caption early), and a line's caption can show other
// words than it says.
async (page) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.reload();
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").click();
  await page.locator(".timeline-panel").waitFor();
  const rpc = (method, params = {}) => page.evaluate(([method, params]) => window.videoEditor.mcp({ jsonrpc: "2.0", id: 1, method, params }), [method, params]);
  const call = async (name, args = {}) => {
    const r = await rpc("tools/call", { name, arguments: args });
    if (r.result?.isError) throw new Error(`${name}: ${r.result.content[0].text}`);
    return JSON.parse(r.result.content[0].text);
  };
  const details = {};
  const vo = await call("add_voiceover", { lines: [{ text: "Twenty percent off, this week only.", caption: "20% off, this week only" }, { text: "Run further." }], voice: "am_michael" });
  const doc = JSON.parse((await rpc("resources/read", { uri: "project://current" })).result.contents[0].text);
  const clips = doc.tracks.flatMap((t) => t.clips);
  // Speech right from each line's reported start: the loudest 400 ms of its
  // first 0.45 s is speech, where the padded voice was still silent.
  const first = [];
  for (const l of vo.lines) first.push(await call("measure_loudness", { spec: "online", start: l.start, end: l.start + 0.45 }));
  const loud = first.map((r) => r.momentary_max_lufs ?? r.momentary_max ?? null);
  details.trimmed = { ok: loud.every((x) => x !== null && x > -25), loud, keys: Object.keys(first[0]) };
  const caps = clips.filter((c) => c.type === "text" && c.caption).map((c) => c.text);
  details.caption = { ok: caps[0] === "20% off, this week only" && caps[1] === "Run further.", caps };
  details.answer = { ok: vo.lines.length === 2 && vo.lines[1].start > vo.lines[0].end, lines: vo.lines.map((l) => [l.start, l.end]) };
  return { ok: Object.values(details).every((d) => d.ok), details };
};
