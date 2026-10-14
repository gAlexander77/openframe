---
tags: [ai, analysis, silence, scenes, beats]
created: 2026-10-13
updated: 2026-10-13
status: living
---

# AI tools

The first local "AI" tools: **Remove silences**, **Split scenes** and **Beat
markers**. None of them is a neural network. Each one is a small piece of
classic signal processing that runs on the user's machine, in the webview,
with no model download, no key and no network. Choices and sources are in
[[AI and automation]] §2.3, §2.5 and §2.6; this note is what we actually
built, its parameters and defaults, and where each idea came from.

Code: the algorithms are pure TypeScript in `src/lib/analysis/` (tested on
synthetic signals), the decoding is `src/engine/analyze.ts`, and the app
glue is `src/state/ai.ts`.

## Remove silences

`src/lib/analysis/silence.ts`. The audio is decoded to mono at 16 kHz, cut
into 20 ms windows, and each window's RMS level is measured in dBFS.

1. **Threshold relative to the noise floor.** The noise floor is the 10th
   percentile of the window levels: the quietest tenth of the clip, which in
   any recording with pauses is room tone. The threshold is the floor + 8 dB,
   clamped to −50…−30 dBFS. The clamp matters at both ends: digital silence
   has a floor of −∞ (so the threshold would be meaningless), and a clip
   with no pauses has a "floor" that is speech (so the threshold would cut
   words). An absolute threshold (`thresholdDb`) overrides all of this.
2. **Hysteresis.** A silence starts when the level drops 3 dB below the
   threshold and ends when it reaches the threshold, so a level hovering at
   the threshold does not chatter into dozens of tiny cuts.
3. **Blips.** A loud run shorter than 100 ms (a click, a tap on the desk)
   does not split a pause in two.
4. **Minimum length and padding.** Pauses shorter than 0.4 s stay (they are
   the rhythm of speech). Longer ones are cut, minus 0.1 s of padding on
   each side that touches speech, so words keep their breath and attack.
   The start and end of the file get no padding.

| Option | Default | UI |
|---|---|---|
| `window` | 0.02 s | — |
| `marginDb` | 8 dB over the floor | — |
| `minDb` / `maxDb` | −50 / −30 dBFS | — |
| `biasDb` | 0 | Sensitivity: 0…100 maps to −8…+8 dB (higher cuts quieter sound) |
| `thresholdDb` | automatic | Agents only |
| `hysteresisDb` | 3 dB | — |
| `minSilence` | 0.4 s | Min pause |
| `padding` | 0.1 s | Padding |
| `minSpeech` | 0.1 s | — |

Where it came from: ffmpeg's `silencedetect` (an RMS gate with a minimum
duration) for the core, and the editor variant in [[AI and automation]]
§2.3 (floor-relative threshold, clamp, hysteresis, padding) for everything
an editor needs on top. Cuts fall inside the silence, so the joins need no
crossfade to avoid clicks.

**Gaps.** Energy cannot tell a pause with music or traffic under it from
speech. A voice activity model (Silero VAD, MIT, 2 MB) is the planned
upgrade; it replaces step 1 and keeps steps 2–4.
