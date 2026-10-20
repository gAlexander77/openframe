---
type: research
date: 2026-10-19
---

# Natural voiceover 2026-10-19

The owner's bar for the voice lane of the third improvements round: a
voiceover made through MCP must sound very natural, ahead of any extra
feature. No model can listen, so this note sets measurable targets for a
natural read, measures what Kokoro-82M (the app's local voice model)
does against them, and records what each change did. It follows limit
10 of [[Launch film through MCP 2026-10-18]] ("reads cannot be
directed; the model cannot listen"). The decisions are
[[ADR-083 Voiceover lines are directed in the script and keep it]] and
[[ADR-084 Voiceover is read at full precision and finished like a recording]].

## Targets

These are the yardsticks used, from narration practice, not measured
here:

| Trait | Natural read | How it was measured |
|---|---|---|
| Pace over a script, pauses included | 2.3-2.8 words a second (about 140-170 a minute; ads up to 3) | words / (last word's end - first word's start) |
| Pace inside a line | about 4-5.5 syllables a second | syllables (vowel groups) / the line's speech span |
| Pause at a comma | 0.25-0.35 s | silent runs and dips in the 10 ms envelope |
| Pause between sentences | 0.5-0.8 s; a paragraph 1-1.5 s | the same |
| Melody | 4-9 semitones between the 10th and 90th percentile of pitch; under 3 sounds flat | YIN pitch track, octave errors dropped |
| Silence | never digital: a quiet room's floor, under -60 dBFS RMS (ACX's limit for audiobooks) | runs of samples under 2 LSB lasting 50 ms or more |
| Joins and edges | no click | the largest sample-to-sample step inside each pause |
| Level | lines within about 1 LU of each other | BS.1770 per line, as mixed |

`src/lib/analysis/speech.ts` holds the measures (`speechActivity`,
`dips`, `pitchTrack`, `pitchStats`); `review_voiceover` reports them per
line. All runs below were headless Edge on this machine, which offers
WebGPU, through scratch drives against the dev server.

## What Kokoro does

### Precision: q8 against fp32

The app loaded the 8-bit weights (q8, `model_quantized.onnx`, 92.4 MB)
on a computer without WebGPU and fp32 (`model.onnx`, 325.5 MB) with it.
The same four lines (Heart, speed 0.95), read at each:

| | q8 on the CPU | fp32 on WebGPU |
|---|---|---|
| Whisper heard | every word, all four lines | every word, all four lines |
| Median pitch per line | 185, 193, 194, 204 Hz | 192, 198, 196, 208 Hz |
| Pitch range per line | 6.6, 6.1, 8.0, 7.0 st | 6.7, 6.3, 7.2, 7.4 st |
| YIN aperiodicity (median, voiced) | 0.049, 0.055, 0.049, 0.061 | 0.050, 0.049, 0.045, 0.064 |
| Time per line after loading | 8.6-14.6 s | 0.4-0.6 s |

By these proxies the two precisions are close; the listening difference
people report for quantized Kokoro could not be measured here. What the
measures did settle is cost. With the GPU switched off
(`--disable-gpu`), fp32 on the CPU read a 3.5 s line in 8.0 s and q8 in
9.0 s (each about 23 s for the first line, loading included): full
precision costs only the larger download. So `quality: best` (the
default) is fp32 everywhere, WebGPU first, falling back to the CPU and
then to q8 only when fp32 cannot load; `draft` is q8 on the CPU.

### Pace and the speed setting

Heart, the model's raw read, four lines of 9-18 words (means):

| Speed | Words a second | Syllables a second |
|---|---|---|
| 1 | 3.32 | 4.64 |
| 0.95 | 3.19 | 4.48 |
| 0.9 | 3.10 | 4.35 |

Inside a line Kokoro is brisk in words but ordinary in syllables:
lines of short words run the word count up ("Every edit is a tool an
agent can call" is 4 words a second at 5 syllables). Speed moves the
read less than its value (0.9 slows it about 6%). Short lines are the
exception: Heart read "Every video starts with a story." at 6.3
syllables a second, and Michael "so a whole film can be made by asking."
at 4 words a second; the voice pack picks a style per input length, and
the short-input styles are quick.

### Pauses

Kokoro pauses at punctuation, but not always with silence:

- Commas: 0.17-0.24 s when it pauses; "Faster, than you think" got a
  50 ms dip at -51 dBFS under speech at -18, no pause at all.
- Sentence ends inside a line: 0.36-0.44 s in longer lines, but "It's
  free. It's yours." got an 80 ms dip to -67 dBFS.
- Its silences are near-digital: the floor between phrases measured
  -97 to -120 dBFS, and every raw read had 0.3 s of digital silence
  before and 0.5 s after.

A pause can therefore be found as a dip (28 dB under the line's loud
part, 0.12 s long, or 0.06 s and 38 dB down) more often than as silence;
stop consonants' closures are shorter or shallower. Matching dips to the
script's punctuation by position (letters before the break against
voiced time before the dip) failed by a hair on "Meet OpenFrame,": the
words before a pause are drawn out (phrase-final lengthening), so the
dip came at 46% of the voiced time for 33% of the letters. Scoring each
pairing by the dip's length less the distance fixed it: a long pause a
little off beats a short closure right on the place.

### Voices

The thirteen voices offered (Kokoro's English voices graded C or better
by their author), natural finish, default speed, the same four lines:

| Voice | Grade | Median pitch | Range | Words/s | Syllables/s |
|---|---|---|---|---|---|
| af_heart | A | 198 Hz | 6.8 st | 3.11 | 4.38 |
| af_bella | A- | 200 Hz | 5.8 st | 2.94 | 4.13 |
| af_nicole | B- | 153 Hz | 3.4 st | 1.99 | 2.81 |
| bf_emma | B- | 181 Hz | 6.0 st | 3.28 | 4.60 |
| am_michael | C+ | 117 Hz | 8.9 st | 2.83 | 3.98 |
| am_fenrir | C+ | 156 Hz | 11.1 st | 3.10 | 4.34 |
| am_puck | C+ | 120 Hz | 9.3 st | 3.32 | 4.65 |
| af_aoede | C+ | 179 Hz | 8.2 st | 3.20 | 4.48 |
| af_kore | C+ | 162 Hz | 10.8 st | 3.04 | 4.26 |
| af_sarah | C+ | 206 Hz | 9.5 st | 3.17 | 4.45 |
| bm_george | C | 147 Hz | 6.9 st | 2.62 | 3.68 |
| bm_fable | C | 120 Hz | 12.0 st | 3.34 | 4.68 |
| bf_isabella | C | 206 Hz | 6.5 st | 3.22 | 4.51 |

Nicole is the outlier: slow and flat, a whispered "headphones" voice
for intimate reads, not ads. Fenrir's and Fable's ranges may include
pitch-tracker errors (breathy voices); the catalog calls them animated.
Every line of every voice came out at -23 LUFS after the finish except
one of Michael's (-24.8: held by its peak). The descriptions in
`list_catalog` section voices come from this table and the author's
grades and tags.

Blends work: a weighted mix of two voices' style vectors
("af_heart:70,af_bella:30"), the way Kokoro's own pipeline blends, was
heard word for word. Nothing measured says a blend is more natural than
Heart alone, so it is offered, not the default.

## What changed, measured

The same six-line script, voiced the way the app read before (speed 1,
the model's read untouched, 0.4 s between every line) and with the new
defaults (speed 0.95, the natural finish, gaps by each line's ending,
one `[pause 0.4]` mark). Both trimmed and faded the same way, so the
edges compare equal.

| | Before | After |
|---|---|---|
| Script pace | 2.82 words/s | 2.63 words/s |
| Lines review_voiceover passes | 5 of 6 | 6 of 6 |
| Fastest line | 6.29 syllables/s | 4.61 (read again slower) |
| Comma pauses inside lines | 0.19-0.37 s | 0.29-0.39 s |
| Sentence pauses inside lines | 0.13, 0.40 s | 0.54, 0.54 s |
| Gap after a line ending on a colon | 0.4 s | 0.1 s (the thought runs on) |
| Lines with digital silence (50 ms or more) | 4 of 6 | 0 of 6 |
| Pause floors | -64 to -72 dBFS (the model's own) | -64 to -73 dBFS, room tone at the least |
| Largest sample step inside a pause | -54.6 dBFS | -52.7 dBFS (no click) |
| Loudness spread across lines | 0.5 LU | 0.7 LU |
| Whisper match | every word but one "it" heard as "its" | the same |

The pause marks: "Meet OpenFrame, [pause 0.6]" lengthened the voice's
own comma pause (heard back as 0.58 s), "It's free. [pause 1] It's
yours." lengthened its 80 ms dip to 1.0 s, and "Faster [pause 0.5] than
you think." found no pause to lengthen (the voice ran through), so it
was read as two parts, the first ending on a comma, joined with 0.5 s.

## Ducking under a voiceover

Four lines over a loud music bed, a 4.5 s gap before the last (it was
pinned with `at`), voice 1.4-2.2 LU under the music at first.
`duck_under_speech` with `voice_above_music_lu: 12` aims over the whole
span from the first word to the last, gaps included; the unducked music
in the gaps pulled the span's music loudness up, so it ducked to its
40 dB limit and every line came out 38 LU over the music, the bed all but
gone. `review_voiceover` measures each line's margin and the music's
current duck instead, and names a depth: 14.2 dB put the four lines at
12.0-12.8 LU, every verdict ok. A margin over 25 LU is now flagged too.
The window target is the mixer's; this note leaves it as it is and
records the limit. (The target has since been measured only while the
voice speaks; ADR-096 names every answer's window and adds `min_line_lu`,
which holds each line to a minimum.)

## Pace in words, landed by measuring (fourth round)

Codex's documentary (eleven narration lines, Heart, best, natural finish)
showed the pace rule above in the wrong unit. Read at the narrator speed
0.9 the help suggested, its lines came out at 3.7-4.2 words a second over
their speech (11 short words in 2.64 s for the first); retaken by hand,
they landed at 2.33-2.76 words a second at these speeds:

| Words | Speed | Words/s over the speech |
|---|---|---|
| 11 (all one syllable) | 0.61 | 2.64 |
| 10 | 0.74 | 2.40 |
| 11 | 0.75 | 2.44 |
| 11 | 0.82 | 2.66 |
| 10 | 0.75 | 2.44 |
| 10 | 0.90 | 2.76 |
| 15 | 0.68 | 2.52 |
| 9 | 0.72 | 2.33 |
| 13 | 0.84 | 2.71 |
| 12 | 0.65 | 2.36 |
| 11 (with a 0.3 s mark) | 0.75 | 2.53 |

So a narrator's 2.3-2.8 words a second inside a line takes Heart's speed
0.6-0.9, lower the shorter the words: a fixed speed cannot serve every
line. Speed lengthened the first line 1.58 times from 0.9 to 0.61, a
little more than 0.9 / 0.61 (1.48), since its comma and sentence pauses
grow past the finish's least lengths. At 0.9 the first line said 4.17
syllables a second, 4.6 at speed 1, as the table above found: the rate
the first guess now uses.
Since ADR-096 each line is read, measured and read again at the speed
that lands it. Four of the same lines voiced with no speed (the
`voice-pace` drive, headless Edge with WebGPU) chose 0.60, 0.78, 0.74 and
0.75 and landed at 2.59, 2.46, 2.74 and 2.53 words a second, three in one
read and one in two; Codex's hand-picked speeds for them were 0.61, 0.74,
0.68 and 0.75. Across the script, gaps between lines in, they read 2.35
words a second. One of them at a fixed 0.9 read 3.26. An ad line of 17
longer words landed at 2.64 (ad 2.6-3.1) at speed 0.69 in two reads.

## Emphasis, measured

Kokoro's only handle on a word is its stress marks (its author's G2P
raises a word's stress for emphasis, "only on less stressed, usually short
words"). Ten sentences, each read plain, with the target word's stress
raised and with the word in quotes (Heart, speed 0.85); Whisper's word
times widened 80 ms each side; the word's peak pitch (YIN) and level (10
ms envelope) against the line's median:

| Ten short words | Length | Peak pitch | Peak level |
|---|---|---|---|
| Stress raised | +0.012 s (5 longer, 1 shorter) | -0.08 st (5 up, 5 down) | -0.37 dB (3 up, 7 down) |
| In quotes | +0.054 s (7 longer, 1 shorter) | -0.48 st (3 up, 7 down) | +0.04 dB (4 up, 6 down) |

An emphasized word is higher, louder and longer by a few semitones, a few
dB and about a third; neither mark moves a word that way, and an earlier
run on seven words with Heart and Michael agreed (pitch moved up to 5
semitones either way). Every variant was heard word for word. Emphasis is
therefore not offered; the guide says to write the word last in its
phrase (the words before a pause are drawn out, above) or to pause
before it.

## What was not measured

- Naturalness as people hear it (no listening test); q8 against fp32
  beyond the proxies above.
- Whether the presence lift, the touch of room reverb or the room tone
  are to taste: they are small (+2 dB, 6% wet, -72 dBFS) and each can be
  turned off (`finish: "clean"` or `"raw"`, `set_reverb off`).
- Gaps between lines are the timeline's own silence, not room tone: a
  ponytail, inaudible under music, that a continuous room-tone bed would
  close.
