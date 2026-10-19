---
type: research
date: 2026-10-19
---

# Music generation 2026-10-19

The launch film's score had to be synthesized in Python outside the editor
([[Launch film through MCP 2026-10-18]]). This note records what the
`generate_music` tool was built from: how professional tracks of its five
styles are made (with sources), how each lesson became code, what was
measured because nobody here can listen, and what the editor's own
`analyze_music` taught along the way. Decisions:
[[ADR-085 Music is composed and synthesized in the app, seeded and offline]],
[[ADR-086 A score fits an edit by whole bars and a nudged tempo]].

## How the styles are built

Numbers in brackets are the sources at the end. Where no reputable number
was found, the note says so and the choice is ours.

### Product launch (electronic, driving)

- **Tempo and feel.** Future bass runs 130-160 BPM in half time [1][7];
  house and electro-pop 120-128 [7]. Launch films want the steadier
  four-on-the-floor: 120 BPM by default (a bar is 2 s, easy to cut to),
  16ths swung 52%.
- **Harmony.** Extended chords, often i-bVI-bVII colors (NI's example is
  Fm9-Dbmaj9-Ebmaj9-Cm) [1]. Ours: i(add9)-bVImaj7-bIII(add9)-bVII and
  three relatives, voiced in five voices.
- **Sound.** A supersaw: many detuned saws with a moving low-pass [2] (five
  saws a note, ±24 cents, split across the sides); a sub on the root and
  a mid bass on the offbeats, the mid bass high-passed off the sub [2]; a
  16th arp; a bright detuned lead.
- **Build and drop.** Builds of up to eight bars "are usually fail safe";
  the snare roll goes quarters, eighths, sixteenths; take the energy below
  100 Hz out during the build; leave half a bar or a bar before the drop,
  usually filled with a tail, not true silence; the filter fully open at
  the drop; an impact on it [3][4][2]. Ours: the roll accelerates to 32nds
  with velocity rising, the build's kick loses everything under 110 Hz,
  the pad's filter opens through the build, a riser ends exactly on half a
  beat of silence (reverb tails ring through it), a reverse cymbal, then
  impact and crash on the drop.
- **Sidechain.** SOS keys the whole mix but kick and vocal from the kick,
  threshold about -25 dB, ratio 16:1 or more; a longer release pumps more
  [5]. No reputable depth in dB was found: ours ducks the chords and bass
  6 dB and the lead 1.5 dB, in over 2 ms, held 20 ms, released over 60% of
  a beat (the launch film's track, measured, used the same 6 dB).

### Cinematic (big, swelling)

- **Form.** "A compelling intro, a building main section and a massive
  ending", with gaps between sections where editors cut [9]; Act I minimal,
  Act II developing the rhythm, Act III full with big hits [10].
- **Hits.** Time the riser to peak on the impact; an impact is a
  transient, a body and a sub; "dropping everything out for a beat makes
  the next impact feel enormous" [11]. Braams: low brass or synth,
  distorted, long reverb, a sub under it [11][12]. Ours: a beat of silence
  before each drop and the final hit, an impact, a braam (four detuned low
  saws through a swelling filter, saturated), taiko and crash.
- **Harmony.** i-bVI-bIII-bVII and its borrowed major-key version [13];
  SOS notes i-bVI is a cliché [9]. Ours offers four minor progressions.
- **Tempo.** No authoritative source; catalogs cluster at 70-100 and
  120-155 BPM [14]. Ours: 90 (88 after fitting 60 s).
- **Reverb.** The best concert halls measure 1.8-2.0 s [15]; trailers run
  longer. Ours: 3.6 s.
- **Rhythm, a lesson paid for.** A 3-3-2 accent on the 16th ostinato and
  toms made analyze_music read 117-126 BPM for an 88 BPM cue (three 16ths
  at 88 is 117 BPM, near the tracker's 120 prior). Accents on the beat
  fixed it. A held sine sub also masked the taiko's onsets (tempo 121 with
  it, 88 without): trailers boom a sub on the downbeat and let it die, so
  ours does.

### Upbeat corporate

- No tutorial-grade source exists [17][18]. Catalog listings cluster near
  120 BPM in G, A or D minor; the palette is ukulele or plucky guitar,
  glockenspiel, whistle and claps; the energy is in the first 5-10 s
  [17][18]. Pop harmony data: IV and V appear about as often as I, then vi
  [19]; no data confirmed I-V-vi-IV as the most common.
- Ours: 116 BPM (112 after fitting), piano eighths in broken chords, a
  Karplus-Strong guitar strummed down on the beat and up between, a
  glockenspiel doubling the hook an octave up, claps on 2 and 4, a
  16th shaker, an eighth-note bass that jumps an octave every other bar,
  four on the floor in the chorus.

### Lo-fi chill

- **Tempo.** 60-90 BPM, about 80 the sweet spot, losing the character
  above 95 [20][21][22]. Ours: 80.
- **Swing.** In Roger Linn's MPC convention 50% is straight and 66% a
  triplet; 54% loosens without sounding swung [23]; Logic's 16th swing
  settings are 54, 58, 62, 66 and 71% [24]; blogs suggest 55-65% and a
  snare a few milliseconds late [22]. Ours: eighths at 60%, the snare
  12 ms late, 8 ms of random timing.
- **Drums and chords.** Three elements or fewer, snare or rim on 2 and 4,
  kick on 1 plus one or two syncopated hits; drums low-passed (NI from
  about 3 kHz, others at 2 kHz); keys sidechained to the kick [20][21];
  m7, maj7, 9ths, ii-V-I loops of two to four chords [21][22]. Ours: a
  Rhodes by FM comping on one and the and of three, IVmaj7-V7-iii7-vi7
  (the "royal road") and three others, the bass locked to the kick (and an
  approach note into the next bar), drums low-passed at 6.5 kHz.
- **Lo-fi processing.** No reputable source confirmed a 10-12 kHz master
  low-pass or a wow depth; ours is a judgment: 11 kHz, 9 cents of wow at
  0.55 Hz with a little flutter, gentle tape saturation, vinyl crackle.
  No risers: the beat just comes back.

### Ambient

- 60-100 BPM measured, often unmetered [7]; generative pieces layer loops
  of incommensurable lengths (Eno's Music for Airports) [26]; pads keep
  moving through slow drift of tuning and cutoff [27]. Ours: 92 BPM (96
  fitted to 60 s), chords two bars long and four in the quiet parts, a
  tonic drone, a pad whose low-pass drifts at 0.11 Hz, glass FM bells,
  mallets on the beat, a soft pulse only in the fullest parts, a 5 s hall.
  The intro is glass and mallets alone, so the pad's entrance marks the
  next part, and the last chord swells in softly rather than hitting.
- **Tempo, a lesson.** analyze_music's tempo prior leans to 120 BPM, so a
  slow piece with audible eighths reads double: at 72 BPM it read 145, at
  80 it read 160 (and once 112). Above 85 BPM the quarter is nearer 120
  than the eighth is, and with the mallets on quarters it reads within
  1.5% (a touch fast).

## Mix and master

- **Loudness.** Spotify normalizes to -14 LUFS and asks for true peaks
  under -1 dBTP [29]; YouTube's reference is -14 [30]; AES TD1008 -16 for
  music [31]; EBU R128 -23 / -1 dBTP [32]. Default: -14 LUFS, -1 dBTP.
  Loudness range is not recommended under a minute [32].
- **Measured genres** (900 tracks [8]): house -9.2 LUFS (LRA 4.8), dubstep
  -6; no measured orchestral or ambient figures were found. A -14 LUFS
  master is quieter than these, so it needs little limiting.
- **Dynamics.** PLR under about 8 is "heavily squashed", over about 15
  "impracticably dynamic" [34]; services leave about 12-13 of headroom
  [16]. At -14 LUFS and -1 dBTP the PLR is 13 by construction.
- **Spectrum.** Over 12,345 CD masters the long-term spectrum rises to
  about 100 Hz and then falls ever more steeply: -2.35 dB an octave at 200
  Hz, -4.99 at 800 Hz, -7.62 at 3.2 kHz; between 89 Hz and 4.5 kHz it falls
  -4.53 dB an octave whatever the percussion [36]. Pestana et al. found
  hip hop, rock, pop and electronic music louder below 150 Hz and above
  5 kHz than jazz or folk [37]. Pink noise falls 3 dB an octave. iZotope
  publishes no numbers for its genre curves [39]; no published shares of
  power by band were found.
- **Stereo.** Normal stereo reads between +1 and 0 on a correlation meter
  [40]; mono below 100-150 Hz (a side high-pass at 120 Hz) [41][42].
- **Reverb returns.** High-pass at 200-300 Hz; pre-delay 10-15 ms on drums,
  20-30 ms generally, 30-50 ms on sustained parts [43]. Ours: sends
  high-passed at 250 Hz and low-passed at 9 kHz (5.5 kHz in lo-fi).

The master: a 2:1 glue compressor with a 6 dB knee, its threshold 4 dB
under the loudest 5% of the mix (so it works only on the loudest parts),
15 ms attack and 250 ms release; then the gain to the target and a
true-peak limiter (export's, 5 ms attack, 80 ms release) at -1 dBTP; the
gain re-measured until the loudness lands within 0.03 LU.

## What the drive accepts

`scripts/drive/generate-music.js` renders each style at 60 s through MCP
and checks the files. The ranges are ours, set from the references above
and from the launch film's track (made by hand in Python, mastered to
-14 LUFS; measured the same way: 63% of its power below 250 Hz, 34% to
4 kHz, 2.7% above; -1.5 dB an octave from 125 Hz to 4 kHz; correlation
0.91; crest factor 12.9 dB in its drops):

| Check | Range |
|---|---|
| Integrated loudness (measure_loudness on the timeline) | -14 ± 0.5 LUFS |
| True peak | at most -1 dBTP (-0.95 allowing rounding) |
| PLR | 8 to 13.5 |
| Crest factor in the drops | 8 to 16 dB |
| Stereo correlation | 0.3 to 0.98 |
| Clipped samples, DC | none, under 1e-4 |
| Stems against the mix | within 8 steps of 16 bits (dither on each file) |
| analyze_music | the tempo within 2%, every drop and every section start but a ring-out outro's within a bar |
| Slope, 125 Hz to 4 kHz (dB an octave) | launch and corporate -4.5 to -0.5, cinematic -5 to -0.5, lo-fi -6 to -1.5 (dark by design), ambient -4 to +1 (pad-led) |
| Power below 250 Hz | launch 50-90%, cinematic 35-85%, corporate 40-85%, lo-fi 40-85%, ambient 20-70% |
| Power above 4 kHz | launch 1.8-4.5% (the reference track 2.7%), cinematic 0.4-3%, corporate 1-4%, lo-fi under 1% (dark by design), ambient 0.1-2% |
| Launch at 68 s in the third film's form | the same ranges at the default brightness; brightness -1 and 1 tilting it each way at -14 LUFS ±0.1, true peak at most -0.95 dBTP |

The slopes are flatter than the 4.5 dB average [36] on purpose: dance and
pop masters are brighter (the launch film's track measured -1.5), and the
ambient pad's 500 Hz body is the point of the style.

## Measurements

Each style at 60 s, seed 7, with stems and markers, generated through
MCP in the web build (`scripts/drive/generate-music.js`, 2026-10-19).
Loudness and true peak are measure_loudness's on the timeline; the rest
is measured on the WAV files read back.

| | Launch | Cinematic | Corporate | Lo-fi | Ambient |
|---|---|---|---|---|---|
| Key, tempo (fitted to 60 s) | A minor, 120 | D minor, 88 | C major, 112 | F major, 80 | E major, 96 |
| Progression | Am G F G | Dm Bb Gm C | Fadd9 C G Am | Gm9 C9 Fmaj9 Dm7 | Eadd9 Aadd9 C#m7 Amaj7 |
| Integrated loudness | -14.0 LUFS | -14.0 | -14.0 | -14.0 | -14.0 |
| True peak | -1.0 dBTP | -1.0 | -1.0 | -1.0 | -1.0 |
| PLR | 13.0 | 13.0 | 13.0 | 13.0 | 13.0 |
| Crest factor in the drops | 12.2 dB | 13.1 | 12.8 | 13.1 | 12.8 |
| Stereo correlation | 0.84 | 0.68 | 0.93 | 0.89 | 0.43 |
| Power below 250 Hz / to 4 kHz / above | 74 / 24 / 1.4% | 58 / 41 / 0.9% | 60 / 38 / 1.8% | 62 / 38 / 0.2% | 40 / 59 / 0.4% |
| Slope, 125 Hz-4 kHz | -1.7 dB/oct | -2.4 | -1.8 | -3.4 | -0.4 |
| Stems against the mix, worst | 5 steps of 16 bits | 5 | 5 | 5 | 5 |
| analyze_music tempo | 120 | 88 | 112 | 80 | 97.4 |
| Drops planned / found | 12, 36 / 12, 36 | 10.91, 32.73 / 10.93, 32.73 | 21.43, 38.57 / 21.43, 38.57 | 6, 30 / 6, 30 | 15, 45 / 15, 44.43 |
| Section starts found | all but the ring-out outro | all but the outro | all but the outro | all but the outro | all, the outro too |
| Render, import included | 8.2 s | 13.3 s | 12.6 s | 12.1 s | 11.7 s |

Octave bands (dB against the loudest band, 31.5 Hz to 16 kHz): launch
-11, 0, -7, -10, -6, -11, -13, -16, -19, -27; cinematic -21, 0, -6, -7,
-3, -7, -13, -18, -19, -27; corporate -24, 0, -2, -7, -3, -5, -8, -13,
-15, -23; lo-fi -21, 0, -4, -5, -3, -7, -17, -20, -28, -53 (dark by
design: the drums low-passed at 6.5 kHz, the master at 11 kHz); ambient
-3, -3, -17, -9, 0, -3, -12, -18, -23, -33 (a drone and a pad's body).

**Every style, three seeds, 30, 60 and 90 s** (45 renders in Node,
analyzed as analyze_music decodes a clip, at 22,050 Hz mono): all at
-14.0 LUFS ±0.02 and -1.0 dBTP or under, no clipped sample. analyze_music
read the tempo within 1% in 40 of 45 and within 2% in 44 (four ambient
pieces 1.1-1.5% fast; one 30 s cinematic cue at 138), found every planned
drop and no other in 44 of 45 (that cinematic cue missed its drop), and
every section start but a ring-out outro's in 43 of 45 (a two-bar build
after a two-bar intro in a 30 s corporate cue, under the analyzer's
two-bar window; an ambient verse once). Its extra cuts fall inside
sections: a four-bar ring outro's echo, and phrase lines in twelve-bar
drops. The fitting example of the brief, an
intro of four bars, a drop at 8.4 s and an outro ending at 56 s, plays at
114.29 BPM with the drop on 8.400 s and the file ending on 56.000 s.

## Brightness (2026-10-19, after the third launch film)

The third launch film's score (launch, 68 s, F minor, drops at 8 and 40 s,
the final hit at 60) measured dark: about three quarters of its power
below 250 Hz and well under the reference track's 2.7% above 4 kHz.
Nobody has listened to it; these are measurements. Rendered in Node at
48 kHz, seed 7, as `balance()` measures (below 250 Hz / to 4 kHz /
above, the 125 Hz-4 kHz slope):

| Launch | Untilted | brightness 0.3 | 0.4 | 0.5 | 1 | -1 |
|---|---|---|---|---|---|---|
| 60 s, default form | 74.3 / 24.4 / 1.38%, -1.71 | 69.8 / 27.9 / 2.28%, -1.32 | | 66.5 / 30.3 / 3.16%, -1.09 | 56.7 / 36.5 / 6.76%, -0.44 | 84.8 / 15.0 / 0.24%, -2.96 |
| 68 s, default form | 72.7 / 25.8 / 1.49%, -1.71 | 68.1 / 29.4 / 2.46%, -1.33 | | 64.7 / 31.9 / 3.40%, -1.07 | 54.8 / 38.0 / 7.19%, -0.42 | 83.6 / 16.1 / 0.27%, -2.97 |
| 68 s, the film's form | 71.1 / 27.5 / 1.34%, -1.93 | | 65.0 / 32.4 / 2.60%, -1.41 | | | |
| 68 s, the film's form, seed 21 | 71.4 / 27.4 / 1.26%, -1.96 | | 65.4 / 32.2 / 2.45%, -1.45 | | | |

Every render held -14.0 LUFS and -1.0 dBTP. `brightness` is a tilt about
1 kHz (a high shelf at 3 kHz, `6 x b` dB, and a low shelf at 300 Hz, `-3 x b`
dB, slope 0.707) on every stem alike before the master, so the stems still
add up to the mix. The launch style defaults to 0.4: the film's form then
measures 65 / 32 / 2.6%, -1.4 dB an octave, beside the hand-made track's
63 / 34 / 2.7%, -1.5. The other styles stay untilted: cinematic (0.8-0.9%
above 4 kHz, strings and a long hall), corporate (1.6-1.8%), lo-fi (0.24%,
dark by design) and ambient (0.35%, pad-led) sit where their references
put them. Through MCP in the web build the drive measured launch at 60 s
68 / 29 / 2.7%, and the film's form at 68 s 65 / 32 / 2.6% (brightness -1:
0.24%, 1: 6.4% above 4 kHz), all at -14.0 LUFS and -1.0 dBTP.

## What analyze_music taught

analyze_music cuts a section where the two bars on either side of a bar
line differ by 3 dB over twelve mel bands and the level (and one bar on
either side does too), at least two bars apart, the stronger first; then
on its four-bar phrase lines it takes changes as small as 1 dB (two bars)
and 2 dB (one bar). Making generated music read back as written took:

- **Phrases.** Sections of 4 and 8 bars on one grid (a two-bar intro moves
  the grid; a two-bar breakdown pairs with a two-bar build). A 7-bar drop
  made its phrase line fall inside it and split it.
- **Sparse parts change chords loudly.** Without drums a chord change
  moves the mel bands by more than 3 dB, so a lo-fi breakdown vamps on one
  chord and ambient's quiet parts hold a chord for four bars.
- **The hook is the variation inside a drop.** Removing the lead stem took
  the corporate drop's bar-to-bar change from 2 dB to under 1 dB; the hook
  and its glockenspiel double are kept a little lower there.
- **A level is not a section.** The first mixes had the chords 13 LU under
  the drums: each stem's loudness in the drops is now measured and set
  (launch: drums 0, lead -3, chords and bass -5 LU).
- **Builds must start, not only rise.** A build that crept in from a soft
  kick was read as the end of the breakdown; its kick now starts firm.
- **Ring-outs are invisible to the beat tracker.** A final chord ringing
  out has no onsets, so its beats are trimmed and the outro reads as the
  last drop's tail. Carrying the grid through quiet endings found the
  outros, but moved the launch film track's outro a bar later (the
  decay's steepest fall is a bar after the hit) and broke the
  music-structure drive, so it was reverted: the cue sheet is the
  authority on the ending.

## Lessons from the code

- **JavaScript DSP costs about 10 ns a biquad sample.** A minute of stereo
  at 48 kHz is 2.9 M samples a channel: every full-length pass counts.
  `(p + dt) % 1` and `2 ** x` per sample cost more than the oscillator;
  recurrences for envelopes, the vibrato and filter set every 16 samples,
  a one-pass ping-pong delay and the reverb at half rate (its send stops at
  9 kHz) took the launch render from 9 s to under 5 s.
- **Stems that add up** need the master's nonlinear parts as gains:
  compute the compressor and limiter on the sum, apply the same gain curve
  to every stem; saturation (lo-fi tape) runs per stem before the sum.
- **Voice leading needs a free doubling.** Doubling only the root forced a
  five-semitone jump from C to G; letting any chord tone double (root
  free, fifth or third at a small cost) gives C 60-64-67-72, G 59-62-67-71.
- **A hook needs a judge.** Random contours from a good rhythm still gave
  "C C C" openings; scoring eight candidates (a range near a fifth, one to
  four turns, no note three times running) picks one that sings.

## Not done

- No one has listened. The strings and choir are synthesized pads, not
  sampled sections; the piano is additive, the guitar Karplus-Strong.
- A ring-out outro reads as the end of the last drop in analyze_music
  (ambient's soft one reads as an outro).
- Energy is per section; there is no energy curve over time.
- Scores are capped at five minutes (memory in the worker).

## Sources

1. https://blog.native-instruments.com/how-to-make-future-bass/
2. https://www.loopmasters.com/articles/4372-How-To-Make-A-Future-Bass-Drop-A-Future-Bass-Production-Tutorial
3. https://www.edmprod.com/ultimate-guide-build-ups/
4. https://www.attackmagazine.com/technique/tutorials/10-snare-rolls-for-the-drop/
5. https://www.soundonsound.com/techniques/side-chain-compression-reason
7. https://www.mixgraph.io/bpm-for
8. https://www.mixgraph.io/tools/lufs-meter
9. https://www.soundonsound.com/music-business/all-about-library-music-part-7
10. https://www.rareformaudio.com/blog/how-production-music-reveals-trailer-structure
11. https://violetrecording.com/sound-design-for-trailers/
12. https://www.soundonsound.com/node/4928253
13. https://www.guitarcomposerstoolbox.com/chord-progressions/cinematic-minor-in-e
14. https://shockwave-sound.com/browse/production-type/epic-trailers
15. https://aes2.org/wp-content/uploads/2023/08/AES123heyser-Beranek.pdf
16. https://www.meterplugs.com/blog/2016/11/18/why-loudness-doesnt-matter.html
17. https://www.udemy.com/course/how-to-compose-uplifting-corporate-music/
18. https://monsterone.com/stock-music/upbeat-and-inspiring-corporate-production-pack-stock-music-o250697/
19. https://www.hooktheory.com/blog/i-analyzed-the-chords-of-1300-popular-songs-for-patterns-this-is-what-i-found/
20. https://blog.native-instruments.com/lo-fi-hip-hop/
21. https://modeaudio.com/magazine/lofi-hip-hop-5-production-essentials
22. https://violetrecording.com/how-to-make-lofi-beats/
23. https://brettworks.com/2013/07/23/roger-linn-on-drum-machine-groove-and-j-dillas-off-beat-sound/
24. https://attackmagazine.com/technique/passing-notes/daw-drum-machine-swing/2
26. https://reverbmachine.com/blog/deconstructing-brian-eno-music-for-airports/
27. https://www.musicradar.com/tuition/tech/27-essential-ambient-production-tips-166772
29. https://support.spotify.com/us/artists/article/loudness-normalization/
30. https://www.meterplugs.com/blog/2019/09/18/youtube-changes-loudness-reference-to-14-lufs.html
31. https://productionadvice.co.uk/td1008/
32. https://tech.ebu.ch/docs/r/r128.pdf
34. https://www.soundonsound.com/node/4910907
36. http://kth.diva-portal.org/smash/get/diva2:1108529/FULLTEXT02.pdf (Elowsson and Friberg, AES 2017)
37. https://aes2.org/publications/elibrary-page/?id=17010 (Pestana et al., AES 2013)
39. https://www.izotope.com/en/learn/leveling-up-your-mastering-workflow-with-tonal-balance-control
40. https://www.soundonsound.com/node/4914566
41. https://www.armadamusic.com/university/music-production-articles/how-to-mix-your-kick-and-bass-5-must-know-methods
42. https://futureproofmusicschool.com/blog/how-do-i-preserve-mono-low-end-while-adding-stereo-width-to-highs
43. https://www.soundbridge.io/reverb-and-delay-tips-for-cleaner-deeper-mixes
