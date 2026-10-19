---
tags: [ai, analysis, silence, scenes, beats, loudness, ducking, matting, sync]
created: 2026-10-13
updated: 2026-10-17
status: living
---

# AI tools

The first local "AI" tools: **Remove silences**, **Split scenes**, **Beat
markers**, **Normalize loudness** and **Auto ducking**. None of them is a neural network. Each one is a small piece of
classic signal processing that runs on the user's machine, in the webview,
with no model download, no key and no network. Choices and sources are in
[[AI and automation]] §2.3, §2.5 and §2.6; this note is what we actually
built, its parameters and defaults, and where each idea came from.
**Remove background** is the exception: a segmentation model, downloaded
once and run on this machine (see its section).

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

## Split scenes

`src/lib/analysis/scenes.ts`, a port of PySceneDetect's ContentDetector,
FlashFilter and AdaptiveDetector (see the credits below). Frames are
decoded 128 px wide, converted to HSV in OpenCV's 8-bit ranges (H 0–179,
S and V 0–255, which is what PySceneDetect's thresholds are tuned in), and
each frame gets a **content score**: the mean absolute per-pixel difference
from the previous frame, averaged over H, S and V. Only the scores are
kept, so analysis memory does not grow with the video's length.

- **AdaptiveDetector (default).** A frame is a cut when its score is at
  least 3× the mean of its 2 neighbors on each side *and* at least 15. A
  fast pan or handheld shake scores high on every frame, so its ratio stays
  near 1; a cut stands out from both sides. The tests pin exactly this
  case: the content detector sees a pan as two cuts, the adaptive one does
  not.
- **ContentDetector.** A cut is any frame scoring 27 or more. Simpler,
  zero latency, fooled by motion. Offered for footage the adaptive detector
  under-cuts.
- **Minimum scene length** (0.5 s, PySceneDetect's 15 frames at 30 fps).
  The content detector applies it through the FlashFilter: in *merge* mode
  (default) a burst of cuts closer together than the minimum (a strobe, a
  flash-frame edit) becomes one cut at the burst's last frame; *suppress*
  keeps the first. Like PySceneDetect, the first cut must also be the
  minimum length from the start of the clip.

| Option | Default | UI |
|---|---|---|
| `detector` | `adaptive` | Detector: Adaptive / Fixed |
| `adaptiveThreshold` | 3.0 | Sensitivity: 0…100 maps to 6.0…1.5 (halving per 50) |
| `threshold` (content) | 27 | Sensitivity: 0…100 maps to 38…19 |
| `minContentVal` | 15 | Sensitivity: 0…100 maps to 21…11 |
| `windowWidth` | 2 frames | — |
| `minScene` | 0.5 s | Min scene |
| `filter` | `merge` | — |

Output: the clip is split at each cut (`split_at_times`), or markers are
dropped there (`add_markers`), Premiere's "Scene Edit Detection" options.

**Gaps.** No edge component (PySceneDetect's default weight for it is 0
anyway). Dissolves and fades are not cuts to this detector; PySceneDetect's
ThresholdDetector (fades to black) and TransNetV2 (MIT, gradual
transitions) are the upgrades listed in [[AI and automation]] §2.5.

## Beat markers

`src/lib/analysis/beats.ts`. The audio is decoded to mono at 22.05 kHz.

1. **Onset strength (spectral flux).** Hann-windowed 1024-point FFTs, 100
   frames a second, magnitudes summed into 64 mel-spaced bands (30 Hz to
   11 kHz), log-compressed (`log1p(100·x)`), and the increases from the
   previous frame summed. Mel bands matter: with plain FFT bins a hi-hat's
   noise covers hundreds of bins and outvotes the kick drum that carries
   the beat. Frames are centered, so the flux peaks a little before the
   attack; 8 ms is added back (measured on the test click tracks).
2. **Tempo.** Autocorrelation of the onset envelope (smoothed with a 20 ms
   Gaussian first, or a period of 46.9 frames splits its peak between lags
   46 and 47 and the doubled period wins), weighted by a log-normal prior
   centered on 120 BPM with one octave of spread, over 40–240 BPM. The
   peak is refined to a fraction of a frame by parabolic interpolation.
3. **Beat tracking.** Ellis's dynamic programming tracker, as in librosa's
   `beat_track`: each frame's score is its onset strength plus the best
   earlier beat between half and twice a period back, penalized by
   `tightness · log(gap / period)²` (tightness 100). Backtracking from the
   end yields the chain of beats that best balances landing on onsets with
   keeping time.
   - *Last beat:* librosa starts from the latest strong peak. Beats and
     off-beats form two chains with the same period, and whichever ends
     later would win; we take the strongest peak within a period of the
     end instead (pinned by a test).
   - *Trim:* leading and trailing beats weaker than half the RMS onset
     strength at the beats are dropped (count-ins, fade-outs, and the
     phantom beat the DP places one period after the music stops).
4. **BPM.** 60 / the least-squares slope of beat time against beat index,
   which averages out each beat's 10 ms frame grid.

| Option | Default | UI |
|---|---|---|
| `minBpm` / `maxBpm` | 40 / 240 | — |
| `priorBpm` | 120 | — |
| `tightness` | 100 | — |
| marker every N beats | 1 | Every: 1, 2 or 4 beats |

Measured on synthetic loops (kick, high-passed hat on the off-beat, a held
chord): 90, 100 and 128 BPM come out within 0.1 BPM, every beat within
5 ms of the truth.

Where it came from: spectral flux onset detection (Bello et al., "A
Tutorial on Onset Detection in Music Signals", 2005; log compression after
Böck and Widmer), the tempo prior and the DP tracker from Ellis (2007) and
their librosa implementation (ISC license; we read its documentation and
behavior, no code was copied). Beat This! (MIT) is the planned upgrade for
downbeats and tempo changes; madmom (non-commercial models), aubio (GPL)
and Essentia (AGPL) are ruled out ([[AI and automation]] §2.6).

**Gaps.** One tempo per clip and no tempo changes; bars and song parts
are the next section's. Markers sit on the timeline, not on the clip, so
they stay put if the music clip moves (`fit_music` moves the music's
markers with it).

## Music structure (analyze_music)

`musicStructure` in `src/lib/analysis/beats.ts`, for epic edits: the
beats above, grouped the way Final Cut's beat grid shows a song (parts,
bars, beats). `analyze_music` answers in timeline seconds and can drop
Beat, Bar, Phrase, section and Drop markers, one undo step.

1. **Beats** as above, but the tracker's trim is replaced by a gentler
   one (a tenth of the RMS onset strength, not half): the strict trim
   dropped a quiet intro's beats, and a song's parts need them.
2. **Per-beat features.** The beat's loudness (RMS dB) and its spectral
   shape: 12 mel bands from 2048-point windows half a window apart
   across the beat, averaged as power. The band levels compare in dB
   floored 60 dB under the loudest, so a band that is silent somewhere
   moves a mean by what it lost.
3. **Novelty.** At each beat, the RMS dB difference between the two bars
   after it and the two before (Foote's idea, as a moving pair of
   windows). A song changes part where it peaks.
4. **Bars.** Parts change on bar lines, so novelty peaks of 3 dB or more
   vote for the phase of the bar (which beat of four is the first).
   Without them, accents decide: onset strength at the beat (a fifth
   stronger counts one point), bass at it (2 dB) and how much the sound
   changes there (2 dB); a phase must lead the first beat's by a point, or
   the first beat starts bar one.
5. **Phrases** are every fourth bar, counted from where the parts change.
6. **Sections** start at bar lines with novelty of 3 dB or more, at least
   four bars apart. Each is named by its loudness against the loudest
   (within 0.15 of it, about 4 dB, is a drop); a quiet part before a drop
   is a build if it rises 3 dB or more, else the intro when first; one
   after a drop is a breakdown, the last one quieter than the one before
   an outro, the rest verses. **The drop** is the biggest rise (3 dB or
   more, two bars after against two before) into a drop section.
7. **Hits:** onset envelope peaks two deviations above its mean, 100 ms
   apart, on or off the beat.

Measured: beat-128.m4a reads 128 BPM, one section, no drop, bars from the
first beat; synthetic songs (`musicStructure.test.ts`) find an 18 dB drop
to the beat, a breakdown between two drops, a swelling build, and the bar
line after a one-beat pickup.

Three early versions read structure that was not there, all by measuring
at the wrong place: a 20-a-second frame grid falls at a different spot in each beat at 128
BPM, and the pattern repeats every eight beats, so it read as accents;
four fixed spots per beat missed the off-beat hat in some beats and not
others, the same way; and a window reaching past a beat's end heard the
next beat's attack, so a part seemed to start a beat early. Pure test
tones also beat against each other in patterns that repeat every few
beats, which is why accents need a clear lead.

**Gaps.** 4/4 only; one tempo; section names come from loudness alone,
so a loud verse reads as a drop. Beat This! (MIT) remains the upgrade for
downbeats in real music.

## Normalize loudness

`src/lib/analysis/loudness.ts`, CapCut's "Normalize loudness" measured the
broadcast way (ITU-R BS.1770 / EBU R128, [[AI and automation]] §2.10).

1. **Measure.** The clip's source window streams through a meter at the
   source's own rate and channels (nothing is held but one number per
   100 ms): K-weighting (a +4 dB shelf above ~1.7 kHz and a 38 Hz
   high-pass, coefficients computed for any rate as libebur128 does; at
   48 kHz they equal the standard's table), mean square per 100 ms,
   400 ms blocks overlapping 75%, an absolute gate at −70 LUFS and a
   relative gate 10 LU under the mean. Channels are summed; **mono counts
   twice** because it plays on both speakers — the same reading as
   `ffmpeg -af ebur128=dualmono=true`.
2. **Set the volume.** `target − measured` dB, held back so the true
   peak (4x oversampled, `src/lib/analysis/truePeak.ts`) stays under its
   ceiling, −1 dBTP or ATSC's −2 at −24, and within the inspector's
   −60…+12 dB. All selected clips in one undo step ("Normalize loudness
   of 2 clips"). `spec` (online, ebu_r128, atsc_a85) names a delivery
   spec's target and ceiling
   ([[ADR-061 Delivery holds the true peak and says whether it passes]]).

| Option | Default | UI |
|---|---|---|
| target | −14 LUFS | Social −14, Podcast −16, TV (EU) −23, TV (US) −24 |
| peak ceiling | −1 dBTP (true peak); −2 at −24 | — |

Measured: the fixtures read −14.17 and −14.63 LUFS where ffmpeg's
`ebur128` reads −14.2 and −14.6; a stereo clip normalized to −16 and
exported measures −16.0 LUFS in ffmpeg.

**Gaps.** Surround weights (1.41 on the rear pair, no LFE) need the
channel layout; clips with volume keyframes are skipped; track volume and
a clip's filters, echo and reverb are not taken into account (each clip
is measured alone, through its compressor): `measure_loudness` reads the
mix as it exports.

## Auto ducking

`src/lib/analysis/duck.ts`. Select the music; every other clip with sound
that plays with it (not muted or disabled) is listened to for speech with
the silence detector above (speech = wherever it finds no silence). The
music then gets **volume keyframes** — editable afterwards in the keyframe
panel, unlike CapCut's ducking, which is a switch you cannot shape:

- down by the depth (Light 6, **Medium 12**, Strong 18 dB; guides put
  music 10–15 dB under dialogue) from 0.1 s before each stretch of speech
  (attack, so the first word is clear) to its end;
- back up over 0.4 s (release);
- pauses shorter than attack + release + 0.6 s stay ducked, so the music
  does not pump between sentences.

Existing volume keyframes on the music are replaced, in one undo step
("Duck under speech"). Measured on the fixtures: four 1.6 s bursts of
speech every 3 s give four dips, −12.00 dB inside speech and 0 dB in every
pause, and the exported music is 12.0 dB quieter under speech than in the
pauses.

**Gaps.** Every other audible clip counts as speech, music included; a
speech/music classifier is the upgrade. One depth for the whole clip.

## Stabilize

`src/lib/analysis/stabilize.ts`. CapCut's Stabilize (Video > Basic, or the
AI tools card): every frame of the clip's source range is shrunk to
128 x 64 gray and compared with the one before by phase correlation
(windowed FFT, sub-pixel peak), which gives how far the picture moved.
The camera's path is the sum of those moves; a Gaussian smooths it
(Least cropping 8, **Recommended** 20, Most stable 45 frames at 30 fps,
scaled to the footage's rate; past the ends the path is reflected
through its end point so a steady pan carries on straight), and each
frame stores the move onto the smooth path with just enough zoom to hide
the edges it uncovers, capped per level (8, 15, 30 %); past the cap a
correction is held at the margin.

The render plan applies the stored move in the picture's own axes (it
turns and mirrors with the clip) to preview and export alike. Corrections
are looked up per source frame, never blended: shake can reverse every
frame, and the first version, which interpolated a quarter frame ahead,
left half the shake. Measured by the drive on `shaky.mp4` (a photo behind
a window jittering 40 x 30 px each frame): the rendered picture's
frame-to-frame movement fell from 6.16 to 0.06 px.

**Gaps.** Translation only: roll and zoom wobble stay (a feature-based
similarity fit is the upgrade). The analysis covers the clip's range;
lengthening the clip later needs Stabilize again. Variable-frame-rate
footage is indexed by its average rate.

## Tracking

`src/lib/analysis/track.ts`, `src/lib/follow.ts`, `src/state/tracking.ts`.
CapCut's Tracking (Text/Sticker > Tracking there; Animation > Tracking
here): select a title, sticker or picture over a video, *Pick subject*
puts a yellow box on the viewer, drag it onto the subject and size it,
then *Track*. The video under the layer (the main track's first) is
decoded from the playhead to the end of the shorter clip as 320 px wide
gray frames; the box's pixels are matched by normalized cross-correlation
in a window around their last place (sub-pixel by a parabola through the
peak). The path becomes the layer's position keyframes, smoothed and
thinned to a handful ([[ADR-054 Tracking writes position keyframes]]).
Measured by the drive on `person-pan.mp4` (the photo slides one source
pixel a frame): 60 frames later the title had moved 0.0614 of the canvas
for 0.0625, and kept 5 keys.

**Gaps.** Position only (no scale or angle); forward only; reversed and
frozen clips are refused. Moving the followed video later does not move
the pin: track again.

## Auto reframe

The AI tools card (and `auto_reframe`): pick 9:16, 1:1, 4:5 or Keep, then
Reframe. The canvas takes the shape with its short side kept, the clip is
scaled to fill it, and the tracker above follows what is at the center
of the clip's first frame through the whole clip; position keyframes then
keep that subject centered, clamped at the picture's edges and smoothed
like a camera pan ([[ADR-054 Tracking writes position keyframes]]). On a
video clip, Animation > Tracking > Keep subject centered does the same
from a box placed on the viewer, from the playhead. Measured by the drive
on `person-pan.mp4` reframed from 16:9 to 9:16: the picture slid 0.1961
of the canvas in 60 frames for the true 0.1975, with two keys.

**Gaps.** No subject detector (a face or saliency model is the upgrade):
the default box assumes the subject starts centered. One subject per
clip; cuts inside the clip are not seen, so split scenes first.

## Sync audio

`src/lib/analysis/sync.ts`, `src/lib/project/sync.ts`. CapCut's Sync
video and audio, Resolve's Auto Sync Audio > Based on Waveform,
PluralEyes: select a separately recorded sound (a lav, a recorder) and
the video it was recorded with, right-click, *Sync audio by waveform* (or
*Sync audio and mute camera sound*); the AI tools card does the same for
the selected audio clip and the selected video, or the video with sound
that plays with it longest.

Both clips' source windows are decoded to mono at 4 kHz. Two microphones
hear one take differently (gain, EQ, noise, room), so the samples are
not compared; their onsets are: each sound becomes the mel-band spectral
flux envelope of Beat markers (40 bands, a 64 ms window every 10 ms),
which drops a gain or a static EQ because each is a constant per band in
the log. One FFT cross-correlates the two envelopes at every lag where
they overlap by a second or more; each lag is normalized over its own
overlap and scaled by the square root of how much of the shorter sound
it covers, and a parabola through the best lag refines it between
frames. The first frames do not count: a window filling up at the start
reads as an attack, and every pair of sounds would match there.

**Confidence is the margin, not the peak.** At its best lag an unrelated
sound still scores 0.13 to 0.28 (speech against speech, music, a steady
tone); a true match 0.5 to 0.93, and over a short overlap the best wrong
lag rises with it. What separates them is how far the best lag stands
above the best one at least 0.15 s away: 0.46 to 0.74 for one take (0.32
with only a third of it overlapping, in the unit test), 0.00 to 0.06 for
every unrelated pair of fixtures. Below 0.15 the tool refuses
("The two sounds don't match clearly enough to sync"), as it does for a
sound that repeats (a click track matches every beat equally) and for a
video without sound of its own.

**Exact, not to the nearest frame.** A clip starts on a whole frame, so
rounding the start would leave up to half a frame (17 ms at 30 fps). The
command `sync_to_clip` starts the clip on the nearest frame and moves its
in-point by the rest. Sound before the timeline's start (the recorder ran
before the camera) is trimmed off the head, a taken spot puts it on a
new track below, and *mute camera sound* sets the video's volume to 0
(its volume keyframes go). One undo step ("Sync audio").

Measured by `scripts/drive/audio-sync.js` in Edge on `sync-camera.mp4`
(thin, roomy AAC) and `sync-lav.wav` (warm, quieter, pink noise; started
1.37 s earlier): offset 1.3692 s, 0.8 ms early, confidence 0.74, 0.24 s
for 12 s of camera against 19 s of lav. On the same files decoded by
ffmpeg (Node), a 3 s piece of the camera found its place in the lav, and
in ten minutes of noise around it, 1.2 ms early (confidence 0.54, 0.47).
The unit tests hold 2 ms with gain, EQ, echoes and noise (5 ms in heavy
noise).

**Gaps.** One constant offset: a recorder whose clock drifts (a few
milliseconds a minute on cheap ones) slides out of sync over a long take
(fit the drift from several windows). Only the clips' windows are
searched, so a trimmed audio clip must still cover the take. Both clips
need the same constant speed, forward. Clips on the main track are not
moved (the magnet would close the gap back): sync the other clip to them.
The match runs on the main thread: 0.4 s per ten minutes of recorder
(measured in Node).

## Reduce noise

`src/lib/analysis/denoise.ts`. CapCut's Reduce noise and Audacity's Noise
Reduction, as a spectral gate: 2048-point frames at a quarter hop learn
the noise's spectrum from the quietest tenth of the frames wholly inside
the audio (edge frames are part zero padding and would always look
quietest, which halved the measured noise and the reduction in the first
version). Each frame then keeps a frequency in proportion to how far it
stands above that noise (Light, **Medium**, Strong set how far above, and
what a noise-only frequency keeps: 1 − 0.9 × strength), smoothed over
three bins and over time (open at once, close slowly) so it does not
warble. One mask from the channels' mix applies to every channel, so
stereo stays stereo.

The clip then plays a new WAV of exactly its source window ("name (noise
reduced).wav"); a video's own sound is extracted to an audio clip first,
as CapCut does, so the picture keeps its file. One undo step ("Reduce
noise"). Measured in the unit test: hiss in the pauses drops by more
than 9 dB while a tone keeps over 85 % of its level.

**Gaps.** Stationary noise only (hum, hiss, fans, room tone); changing
noise wants a learned model (DeepFilterNet, MIT/Apache). Clips with a
speed curve or reversed sound are refused. **Filler words** ("um", "uh")
are not offered: Whisper, our caption model, leaves most of them out of
its transcripts, so a remover built on it would miss them.

## Remove background

CapCut's Video > Remove BG > Auto removal: the person (or the main subject)
stays and everything behind them shows the tracks below. The inspector's
Video tab has it as the **Remove BG** sub-tab, with Chroma key under it,
and the AI tools tab has a card for it.

- **Model** ([[ADR-032 Remove BG runs ormbg on WebGPU, MediaPipe on WASM]]):
  ormbg (1024², Apache-2.0, 88 MB) where WebGPU has fp16 shaders, else
  MediaPipe Selfie Segmentation (256², Apache-2.0, 0.5 MB). It is
  downloaded on first use with its own progress stage and works offline
  after that. If ormbg cannot run on the GPU, the light model takes over
  and the toast says so.
- **Once per clip** ([[ADR-033 Mattes are made once and stored as grayscale video]]):
  the clip's source window is decoded at the model's size, each frame runs
  in `src/engine/matte.worker.ts`, and the mattes are steadied over time.
  A per-pixel median of three frames removes one-frame pops with no lag;
  then changes under 24/255 are held back by up to 60%, which damps edge
  shimmer without ghosting a moving edge (`src/lib/matte.ts`). The result
  is encoded as a grayscale MP4 stored like imported media. The clip
  references it as `cutout` ([[Project format]]); preview and export read
  it beside the source and multiply it into alpha.
- **Switch behavior**: On makes the matte, or reuses one that covers the
  clip (its own, a split half's, or one made this session). Off keeps it,
  so On again is instant. A clip trimmed past its matte shows those frames
  whole and the inspector offers **Update**.
- **Measured** in Edge on 2026-10-16 (bg-removal drive; the fixture is a
  CC0 portrait panned one pixel a frame, `person-pan.mp4`): 180 frames in
  15 s with ormbg on WebGPU (13 fps), or 3.4 s with MediaPipe forced onto
  WASM (75 fps). The first use added a 3 s download. Both models got every
  scored face, jacket, foliage and column point right, and the viewer,
  an exported still and the rendered MP4 agree point for point. Playback
  with the matte dropped no frames. While ormbg worked, the longest gap
  between animation frames was 75 ms.
- **Limits**: ormbg is trained on people. It handles one clear object (an
  apple, a cat, a teapot) but not a scene without a subject. MediaPipe
  finds people only.
- **Text behind the subject** (agents: `text_behind_subject`) reuses the
  same matte: a silent copy of the video with the matte on goes on a track
  above the titles, grouped with the original (no canvas fill, which would
  cover the titles), as one undo step (`src/lib/ads.ts` putBehindSubject).
  The text-behind drive measured the light model headless: 13 to 15 s with
  the first download, the title's yellow gone over the jacket and kept
  beside the face. A photo has no matte video: the model runs on it once
  and the cut-out is a new PNG with transparency (`cutOutImage` in
  `src/engine/cutout.ts`), drawn above the title like any picture. With the title hidden, the copy over the original
  changes no pixel by more than 3 of 765: the matte's edges add no fringe.

## Voiceover: pauses and finish

The voice model (Kokoro-82M) reads a line whole; what follows is sample
math on its output (`src/lib/voiceScript.ts`, `voiceTake.ts`,
`analysis/speech.ts`; [[ADR-083 Voiceover lines are directed in the script and keep it]],
[[ADR-084 Voiceover is read at full precision and finished like a recording]],
measurements in [[Natural voiceover 2026-10-19]]).

**Finding the voice's pauses.** A 10 ms RMS envelope in dBFS. Speech is
any window louder than 35 dB under the line's loud part (its 90th
percentile window). A pause is a *dip*: windows 28 dB under the loud part
lasting 0.12 s, or 0.06 s when 38 dB down. Kokoro's pause at a short
sentence's end is often an 80 ms dip to -67 dBFS rather than silence;
stop consonants' closures (30-90 ms) are shallower or shorter.

**Matching pauses to the script.** Each comma, colon, semicolon, dash and
sentence end inside the line is placed by its share of the letters before
it; each dip by its share of the voiced time before it (pauses of 0.1 s
or more taken out). An in-order alignment (dynamic programming) pairs
them, each pair scoring the dip's length (up to 0.4 s) less the distance
between the shares, within 0.2; the best total wins, so a long pause a
little off (words before a pause are drawn out) beats a short closure
right on the place.

**Setting a pause's length.** The matched dip keeps its first and last
40 ms (the decay of the word before, the lead-in of the word after), each
faded over half that, and its middle is replaced by silence of the right
length, or cut out. The words are the same samples. A mark that matched
no dip reads the line as two parts at that boundary (the first ending on
a comma) and joins them with exactly the mark's silence between the
speech, cutting quiet ends shorter when they already exceed it.

**The natural finish.** Low cut (RBJ high-pass, 80 Hz, Q 0.707) and
presence (RBJ peaking, 3.5 kHz, +2 dB, Q 0.9); trim to the speech with a
60 ms lead-in and a 200 ms tail; gain to -23 LUFS (BS.1770, mono)
holding the sample peak under -1 dBFS; pink room tone (Paul Kellet's
filter, seeded by the line's text) at -72 dBFS RMS added under the whole
take; raised-cosine fades of 12 ms in and 30 ms out. A line read over 5.5
syllables a second with no speed given is read once more at speed x
5 / its rate, never below four fifths of the speed asked.

## In the app and for agents

- **Panel:** the library's *AI tools* tab (`src/components/AiToolsTab.tsx`).
  A banner names the selected clip; each tool card says what it needs,
  opens its settings in a small popover, shows progress with a cancel
  button while it runs, and keeps its last result ("Removed 4 silences,
  4.9 s shorter"). *Auto captions* opens the Captions tab; *Auto reframe*
  reframes for real now (below). *Tracking* sits in the pinned layer's
  Animation tab, not here, since it starts from the layer.
- **One undo step per run**, labeled with what happened ("Remove 4
  silences", "Split into 5 scenes", "Mark 43 beats"), built from the
  registry commands `cut_ranges`, `split_at_times` and `add_markers`
  ([[ADR-019 Smart edits compile to commands, one undo step]]).
- **Automation:** `window.videoEditor.analyze.silences | scenes |
  beats(clipId?, options?)` return results in source seconds without
  editing ([[ADR-017 Analysis edits take source seconds]]);
  `window.videoEditor.ai.removeSilences | splitScenes | markBeats` analyze
  and apply. Omitting `clipId` uses the selected clip.
  `ai.normalizeLoudness(clipIds?, { target })` takes a list and returns
  each clip's measured LUFS, gain and whether the peak held it back;
  `ai.duckUnderSpeech(clipId?, { depth })` returns the dips and keys made.
  `ai.reduceNoise(clipId?, { strength })` and `ai.stabilizeClip(clipId?,
  { level })` clean the sound and stabilize the picture.
  `ai.syncAudio(clipId?, { videoId, muteCamera })` syncs an audio clip to
  a video by waveform and returns the offset, confidence and new place.
  `ai.removeBackground(clipId?)` makes (or reuses) the matte and turns it
  on, returning the frames, speed, model and device, or `cached: true`;
  the `set_background_removal` command turns an existing matte off and on.
- **MCP:** the same nine as tools for external agents — `remove_silences`,
  `split_scenes`, `mark_beats`, `normalize_loudness`, `duck_under_speech`,
  `reduce_noise`, `stabilize_clip`, `sync_audio`, `remove_background`
  (snake_case options; unset ones keep the panel's defaults) — and
  `analyze_music` (`ai.analyzeMusic(clipId?, { markers })`).
- **Epic edit:** an agent makes a beat-synced montage with
  `analyze_music` (markers bars and drop), `fit_music` (`drop_at`, before
  cutting), `cut_to_beats`, `add_beat_hits`, `set_speed_ramp`,
  `add_cinematic_bars`, `add_sound_effect` with `end_at` (a riser into a
  cut) and `fit_music` again to end on a bar ([[Features]], Epic edits).
  `scripts/drive/epic-edit.js` does all of it through MCP calls alone and
  checks every cut lands within a frame of a true beat.
- **Proof:** `scripts/drive/ai-tools.js` runs every tool on fixtures with
  known answers (`node scripts/make-fixtures.mjs`) and once through the
  panel. Measured in Edge on 2026-10-14: silences exactly 1.7–2.9, 4.7–5.9,
  7.7–8.9 and 10.7–12 s (4.9 s removed, video and its sound cut together);
  scene cuts on the exact frames (2.5, 5, 8, 10 s) with both detectors,
  360 frames analyzed in about 0.7 s; 128 BPM with all 43 beats within
  5 ms.

## Decoding

`src/engine/analyze.ts` opens its own mediabunny Input per job (playback
decoders never move), decodes only the clip's source window, and keeps
only what the algorithm needs ([[ADR-018 Local analysis is our own signal
processing in the webview]]):

- **Audio:** channels averaged to mono, resampled by a box filter (each
  output sample is the mean of the input samples in its slot) to 16 kHz
  for silence and 22.05 kHz for beats.
- **Video:** every frame drawn 128 px wide by mediabunny's `CanvasSink`,
  converted to HSV, scored against the previous frame, then dropped.

**AAC priming (measured).** AAC encoders put 1024 samples of priming
before the audio; an MP4 edit list says to skip them. mediabunny honors
the edit list by giving that first packet a *negative* timestamp
(−21.3 ms at 48 kHz, −23.2 ms at 44.1 kHz on our fixtures, video at 0).
Mapping the first timestamp to source time 0, as `media.ts` and
`thumbs.ts` do, puts the priming at 0 and every sound 21 ms late: the
silence edges and beats came out 21 ms late until the analysis decoder
switched to mapping timestamp 0 (or a later first timestamp, for streams
that start late) to source 0. Beat error on the 128 BPM fixture went from
27 ms to 5 ms. The same offset is likely in playback and waveforms.

## Credits: PySceneDetect

The scene detector reimplements, in TypeScript, the algorithms of
PySceneDetect (<https://github.com/Breakthrough/PySceneDetect>), read from
its main branch in October 2026, which is distributed under this license:

```text
BSD 3-Clause License

Copyright (C) 2014, Brandon Castellano

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

The shipped app must carry this notice in its about box or third-party
notices file once that exists.

Playback prepares upcoming video decoders before their cuts (ADR-074).
This improves live review of long-GOP footage; exported frames still use
the same frame plan and source times.

`analyze_music` now reports `drops` in chronological timeline seconds while
keeping `drop` as the biggest rise. Section bounds follow bars or phrases,
and two-bar breakdowns are retained. Drop markers cover every detected drop.

`measure_loudness {by_track: true}` reports every audio track's integrated
LUFS, maximum short-term LUFS and full three-second windows sampled each
second (the timestamp is the window end). Muted or excluded-by-solo tracks
report silence. Stems are measured before master export normalization.
When Voiceover and music tracks exist, `balance.voice_above_music_lu` reports
the integrated difference between the combined stems. Track names supply
roles: Voiceover is dialog; other audio tracks except Sound effects/SFX are
music. This convention is not automatic speech/music classification.

`duck_under_speech {clip_id, voice_above_music_lu: 10}` measures the voice
and selected music clip, chooses attenuation up to 40 dB and measures the
result before applying editable keys. It answers depth, the measurement
window, achieved difference and whether it met the target within 0.5 LU.
The window spans the first through last detected speech, including pauses;
this is a window-level target, not a promise about every word. Without the
target, fixed-depth ducking behaves as before.
