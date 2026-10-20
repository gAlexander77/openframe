# ADR-115: A voiceover captions itself a few words at a time, and answers give what they share once

**Date:** 2026-10-20. **Status:** accepted. Builds on
[[ADR-092 A voice's known script decides its words, a second hearing decides who misheard]]
and [[ADR-105 Answers hold what was asked, tracked titles center on their letters, pictures take a color]].

## Context

A second fresh Claude Code session made a 46.5-second vertical short
and its 16:9 cut through the MCP tools and reported 24 limits. Six were
about captions and the size of answers:

- **4: no word-by-word captions from a voiceover.** add_voiceover made
  one caption a line. The tester called get_transcript twelve times,
  built 46 captions of 1-3 words with their word times by hand and moved
  first words by hand: Whisper heard "Station," at 0.46 s into a take
  whose voice starts at 0.05 s, and first words up to about 0.4 s late.
- **5: check_project kind social_short flagged every chunk.** 25 of its
  last 27 warnings were `caption_too_fast` on chunks up 0.3-0.6 s, under
  the 0.83 s floor, from lines that read at 9-14 characters a second. The
  social_short playbook asks for exactly those captions.
- **6: a one-word caption always showed the highlight color.** Mission
  control's captions were cyan with a white highlight, and every one-word
  caption ("THREE.", "STATION,") drew white from start to end.
- **7: answers too large.** add_captions and every batch that touched the
  captions echoed each clip's whole style (about 10k tokens a call, four
  times); review_voiceover about 6k, each line told to duck the music clip
  under it on its own when one duck of the music track was the answer;
  check_project about 6k of near-identical findings; cut_music listed
  every marker it moved.
- **9: no cheap way to learn track ids.** new_project did not answer the
  main track's id, and describe_project narrowed to a stretch left out
  tracks with nothing in it. The tester added a clip to read its track.
- **18: export_versions check sheets too small.** Eight moments of a 16:9
  version came back as one 3182 x 254 strip, shown 2000 px wide: frames
  250 px wide, too small to judge framing.

## Decision

### add_voiceover and retake_voiceover caption_words

`caption_words` (1-3) captions each line that many words at a time,
each word timed to the voice, the times kept for the spoken-word
highlight. The count is kept with the take (`SpeechInfo.captionWords`),
so retake_voiceover captions its new words the same way;
`caption_words: 0` on a retake goes back to one caption for the line.
The answer gives each line's `caption_clips`; a note says how the words
were timed.

**Where the word times come from.** The speech model gives none:
kokoro-js runs Kokoro's ONNX export, whose only output is the waveform.
Onnx-community's timestamped export also gives each phoneme's duration,
but it is another 90-325 MB download, and a take is reshaped after it is
read (pauses lengthened, parts joined, the natural finish), so durations
would have to be carried through all of that. Instead each take is heard
by Whisper base (`state/voiceWords.ts`, as review_voiceover hears it),
its words lined up with the caption by `scriptTimes` (ADR-092), and
fitted to the take's own sound (`lib/captionWords.ts voiceWordTimes`):

- the first word starts at the voice's first sound (`speechActivity`);
- every pause the caption asks for (punctuation, or a pause mark in the
  script) is matched to a dip in the take as the reader placed it
  (`matchPauses`, the alignment the read itself uses): the word before it
  ends where the dip starts, the word after it starts where the voice
  comes back;
- inside a phrase (between two such edges) a word starts halfway between
  where Whisper heard it and where its letters put it (each word's share
  of the phrase's time by its letters). With nothing heard (Whisper could
  not load, offline on first use) the letters alone.

Measured on 13 Kokoro lines (102 words, Heart and Michael at speeds
0.74-1), against the timestamped export's own phoneme durations: those
run about 0.1 s behind the sound (the decoder's latency; Kokoro's own
pipeline subtracts a fixed three frames), so each line's truth was
shifted by its median offset at the words that start after silence,
where the energy onset is the truth.

| Words | Whisper as heard | Fitted (shipped) | Letters alone |
|---|---:|---:|---:|
| After a pause or first (25): mean error | 0.268 s | 0.022 s | 0.022 s |
| ... within 0.1 s | 28% | 96% | 96% |
| Inside a phrase (77): mean error | 0.116 s | 0.060 s | 0.112 s |
| ... within 0.1 s | 44% | 86% | 47% |

Whisper's onsets were wrong by tenths of a second both ways: early here
(transformers.js on the CPU, raw reads: bias -0.25 s after a pause), late
in the tester's session (the browser, finished takes: "Station," 0.41 s
late). Stretching Whisper's phrase onto the sound was worse inside
phrases (0.151 s); the half-and-half cancels Whisper's early bias against
the letters' late one. Shifting each phrase by its first word's
correction was worse still (0.219 s): Whisper's error is largest at a
pause, not a constant offset.

**Chunks** (`chunkCaptions`): a phrase splits into even chunks (four
words make two and two, not three and one); a little word ("a", "the",
"to") never ends a chunk when the next can take it; a chunk stays up
until the next shows across a pause of up to 0.7 s (a comma, a sentence),
else 0.3 s past its last word; the last stays to the take's end; one that
would be up under 0.3 s joins its neighbor.

In the product (`scripts/drive/voice-caption-words.js`, caption_words 2)
each line's first chunk starts within 0.02 s of its voice's first sound,
and the film test's lines chunk as "Station," / "how's" / "the view?".

### check_project reads chunked captions as their line

`captionRuns` (lib/designCheck.ts): two or more captions of at most three
words, each within 0.3 s of the one before on its track, are one line
shown a few words at a time. Such a run is judged by the line: its
characters a second over the run's seconds (under 20), one finding for
the run naming every clip; each chunk only has to stay up 0.25 s (the
one-word auto captions' floor). A caption on its own is judged as
before. The tester's chunks pass; the two runs that remain flagged in
the reconstruction read at 24-25 characters a second.

### A caption's only word is not lit

`spokenWord` lights nothing in a caption of one word: the highlight says
which word of a caption is being spoken, and a lone word is the caption,
drawn in its color. To make a one-word caption pop, give it the color.
Verified in the drive: a one-word chunk draws no highlight pixels, a
two-word chunk lights the word being spoken.

### Answers give what they share once (lib/answerSize.ts)

- **A list of four or more clips** in an edit's answer (added_clips,
  changed_clips) gives what every clip in it shares once, in
  `added_clips_common` or `changed_clips_common`, deeply (a style that
  differs in its highlight shares its font). Each entry keeps its id,
  type, start and end, so a list is still read by them; an entry is the
  common part with its own fields over it (`withShared`). Lossless.
  `withMoves` merges the moved clips an app tool did not list into the
  same shape.
- **Markers that moved together** with their clip (by the same distance,
  maybe onto the piece that now plays them) are counted in
  `moved_markers`: clip, by, count, labels, from, to. Other changed
  markers are listed.
- **check_project** gives the same finding on three clips or more (the
  same rule, level and fix) once, with count, every clip_id and every
  time; `detail: "full"` lists each.
- **review_voiceover** gives each line, by default, its verdict (ok, or to
  fix: the problems are in its fixes), fixes, advice, words a second
  against its band, loudness and margin over the music, and what was
  heard only where it differs from the script; `detail: "full"` keeps
  every measure. Lines short of their margin over a music track get one
  fix in `summary.fixes`: duck_under_speech with that track's id (every
  piece of the song as one bed) and the lines it holds, each line
  pointing at it. Five drives that read the full measures ask for detail
  full.

### Track ids are cheap

new_project and open_project answer each track's id, name, kind, role,
whether it is main and how many clips it holds. describe_project takes
`clips: false` for the tracks alone (media, markers and nested timelines
only when asked true), and a stretch lists every track, those with
nothing in it empty.

### Check sheets wrap

export_versions' check sheet wraps each version's moments into rows that
stay inside 1600 px (`lib/sheetGrid.ts`), and `tile_width` sets each
frame's width (its height follows the version's shape).

### Measured

On the web build's MCP, reconstructing the tester's flows (characters of
each answer's text):

| Answer | Before | After |
|---|---:|---:|
| new_project | 247 | 331, with the main track's id |
| cut_music, 4 bars of a song with 34 markers | 2,393 | 664 |
| add_captions, 41 chunked captions | 12,436 | 3,779 |
| batch: set_text on 9, a pop on all 41 | 13,395 | 6,150 |
| check_project social_short (31 findings, 20 caption_too_fast) | 10,364 | 3,217 (5 findings, 2 lines too fast) |
| review_voiceover, 6 lines over music | 6,411 | 3,859 |
| export_versions check, 8 moments of 16:9 | 3182 x 254 (250 px frames as shown) | 1594 x 480 (391 px frames) |

## Consequences

- A short's word captions are one argument; a model no longer reads 12
  transcripts or times words by hand. The first use downloads Whisper
  base (77 MB, shared with review_voiceover and the transcript), and each
  line takes a second or two more.
- Inside a phrase a word is within 0.1 s of where the voice says it about
  86% of the time on Kokoro reads; a long phrase without punctuation is
  timed only by Whisper and the letters, and a pause the voice ran
  through gives no edge.
- `added_clips` and `changed_clips` entries of a long list no longer
  carry the fields every clip shares: a reader merges `*_clips_common`
  back, or reads them there. review_voiceover's and check_project's
  default answers are smaller; callers that read every measure pass
  detail full, as analyze_music's do since ADR-105.
- One-word captions in a highlight look (the Captions tab's one word at a
  time with Word pop) now show the look's text color, not its highlight.
- Left open: the 16:9 cut of a vertical short keeps its captions' phone
  size (the report's self-review, not one of these limits); an edit's
  answer on fewer than four clips, however many keyframes they carry, is
  as before.
