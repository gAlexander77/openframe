// Monitor mute silences the shared preview bus (including auditions),
// both controls agree, and the offline WAV still contains sound.
async (page) => {
  page.setDefaultTimeout(20000);
  await page.waitForFunction(() => !!window.videoEditor);
  await page.locator(".create-card").first().click();
  await page.locator(".timeline-panel").waitFor();
  const details = {};
  const check = (name, ok, extra = {}) => details[name] = { ok: !!ok, ...extra };
  await page.evaluate(async () => {
    const ve = window.videoEditor;
    const [a] = await ve.import([{ name: "music", src: `${location.origin}/fixtures/media/music-stereo.m4a` }]);
    ve.exec("add_media_clip", { asset_id: a.id, start: 0, duration: 3 });
  });
  const snapshot = await page.evaluate(() => JSON.stringify(window.videoEditor.project()));
  const button = page.locator(".transport").getByRole("button", { name: "Mute playback", exact: true });
  await button.click();
  const output = expected => page.evaluate(async expected => {
    const { masterBus } = await import("/src/engine/audio.ts");
    // setValueAtTime applies on the audio rendering thread. A read in the
    // next page task can still see the previous quantum's gain value.
    const until = performance.now() + 2000;
    let state;
    do {
      state = {
        gain: masterBus().output.gain.value,
        muted: window.videoEditor.state().monitorMuted,
        pressed: document.querySelector('.transport button[aria-label="Mute playback"]').getAttribute("aria-pressed"),
        stageFocused: document.activeElement?.classList.contains("player-stage"),
      };
      if (state.gain === (expected ? 0 : 1) && state.muted === expected && state.pressed === String(expected)) break;
      await new Promise(r => setTimeout(r, 20));
    } while (performance.now() < until);
    return state;
  }, expected);
  const matches = (state, muted) => state.gain === (muted ? 0 : 1) && state.muted === muted && state.pressed === String(muted);
  const buttonMuted = await output(true);
  check("button mutes output", matches(buttonMuted, true), buttonMuted);
  await page.getByRole("button", { name: "Mixer", exact: true }).click();
  const masterMute = page.locator(".mix-strip.master").getByRole("button", { name: "Mute playback", exact: true });
  check("master shows mute", await masterMute.getAttribute("aria-pressed") === "true");
  await page.evaluate(() => window.videoEditor.action("playPause"));
  await page.waitForTimeout(600);
  const peaks = await page.locator(".mix-strip.master meter").evaluateAll(els => els.map(e => e.value));
  check("master meter silent", peaks.every(v => v === -60), { peaks });
  await page.evaluate(() => window.videoEditor.action("playPause"));
  await page.getByRole("button", { name: "Close mixer", exact: true }).click();
  const mutedExport = await page.evaluate(async () => {
    const ve = window.videoEditor;
    const r = await ve.render({ video: false, audioFormat: "wav" });
    const bytes = await (await fetch(r.url)).arrayBuffer(); URL.revokeObjectURL(r.url);
    const ctx = new AudioContext();
    try {
      const audio = await ctx.decodeAudioData(bytes);
      const data = audio.getChannelData(0);
      let sum = 0, peak = 0;
      for (const v of data) { sum += v * v; peak = Math.max(peak, Math.abs(v)); }
      return { rms: Math.sqrt(sum / data.length), peak, samples: data.length, muted: ve.state().monitorMuted };
    } finally { await ctx.close(); }
  });
  check("muted export still sounds", mutedExport.muted && mutedExport.rms > 0.001 && mutedExport.peak > 0.01, mutedExport);
  await page.locator(".player-stage").click({ position: { x: 5, y: 5 } });
  const clicked = await output(true);
  check("stage click preserves mute and takes focus", matches(clicked, true) && clicked.stageFocused, clicked);
  await page.keyboard.press("Shift+s");
  const unmuted = await output(false);
  check("key unmutes output", matches(unmuted, false), unmuted);
  await page.keyboard.press("Shift+s");
  const muted = await output(true);
  check("key mutes output", matches(muted, true), muted);
  const audition = await page.evaluate(async () => {
    const { auditionSoundEffect } = await import("/src/state/sfx.ts");
    const { masterBus, readMeter } = await import("/src/engine/audio.ts");
    auditionSoundEffect("click");
    await new Promise(r => setTimeout(r, 100));
    return { gain: masterBus().output.gain.value, peak: readMeter(masterBus().left).peak };
  });
  check("auditions muted", audition.gain === 0 && audition.peak === -Infinity, audition);
  check("document untouched", snapshot === await page.evaluate(() => JSON.stringify(window.videoEditor.project())));
  return { ok: Object.values(details).every(d => d.ok), details };
}
