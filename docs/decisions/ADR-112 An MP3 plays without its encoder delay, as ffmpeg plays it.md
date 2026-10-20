# ADR-112: An MP3 plays without its encoder delay, as ffmpeg plays it

**Date:** 2026-10-20. **Status:** accepted. Closes the MP3 item [[ADR-107 A split plays on, a cut keeps its downbeat, and a duck follows its music]] left open.

## Context

The sound hunt of ADR-107 measured the app playing every MP3 23.02 ms
later than ffmpeg and other gapless players. Reproduced here by
cross-correlating the app's decode with ffmpeg's (`ffmpeg -f f32le`):

| File | Before | After |
| --- | --- | --- |
| `music-30s.mp3` (48 kHz, Lavc tag 576/576) | 1105 samples (23.02 ms) late in the analysis decode and the export mix; 30.024 s long | lag 0, r 1.000; sample for sample within 1.2e-6 of ffmpeg at its head, at 12.34 s and at its end; 30.000 s |
| `onset-120.mp3` (44.1 kHz, Lavc tag 576/1296) | 1105 samples (25.06 ms) late; 12.042 s; waveform rising at 1.02 s; analyze_music's beats at 1.033 s (a frame late) | the first hit at 1.000 s in the decode, the mix and the waveform; beats at 1.000 s; 12.000 s |
| `music-stereo.m4a`, `beat-128.m4a`, `onset-120.m4a`, the launch film's `liftoff.m4a` (AAC) | lag 0 | lag 0 |

An MP3 encoder starts its stream late (LAME's encoder delay, 576
samples) and pads the last frame; every MP3 decoder adds 529 samples of
its own. LAME, and ffmpeg's libmp3lame muxer (encoder `Lavc`), write the
delay and the padding into the first frame, the Xing/"Info" tag's LAME
extension. ffmpeg skips the delay plus 529 at the start and the padding
less 529 at the end (`libavformat/mp3dec.c`, `mp3_parse_info_tag`;
ffprobe's `start_time` 0.023021). WebCodecs' `AudioDecoder` has no such
input, and mediabunny 1.61.4 (and 1.61.6, the latest) reads the tag's
frame count and byte count but not its LAME extension, and offers no
gapless option: it presents all 1105 samples as sound.

The app's analyses read the same timeline, so its own grids agreed with
what it played. Everything else was off: a grid from a cue sheet
(`set_music_grid`) sat 23 ms early against the sound, an MP3 against
other material (a WAV of the same take, a video's sound) played 23-25 ms
late, and the padding counted in the file's length.

AAC needs nothing: its priming is the MP4 edit list, which mediabunny
honors by giving the priming packet a negative timestamp
(`mediaOrigin`, measured in ADR-104).

## Decision

### 1. The tag is read as ffmpeg reads it

`lib/gapless.ts` finds the first frame as mediabunny does (past every
ID3v2 tag, the first word that is a frame header) and reads its
Xing/Info tag: the optional fields its flags name, then the encoder name
and, 21 bytes later, the delay and padding (12 bits each). As ffmpeg, it
trims only for `LAME`, `Lavf` and `Lavc` encoders, `start` = delay + 529
and `end` = padding - 529 (none when the tag does not count its frames).
A Xing tag with no LAME extension (mediabunny's own MP3 muxer writes
one), a VBRI header or no tag at all trims nothing, as in ffmpeg.

### 2. One origin for every consumer of the sound

The engine already converts between source and container time through
one origin per file (`mediaOrigin`, which moves past AAC's priming).
`soundOrigin` adds an MP3's delay to it, read once per file
(`gaplessTrim`, cached by src, gated on mediabunny's MP3 format) through
`platform.head`, which now takes an offset so a large ID3 tag (cover art)
is skipped, not read. Playback and export (`MediaFile.audioStart`, the
one scheduler both use), the analysis decoders (`decodeMono`,
`decodePcm`, `measureLoudness`: analyze_music, mark_beats, preview_audio,
measure_loudness, transcripts, audio sync, noise reduction) and the
waveform (`makePeaks`) all convert through it. Nothing else changes:
samples before source 0 were already dropped by every path (the decode
pre-roll of ADR-104 needs that), so the delay is never heard.

### 3. The duration leaves the delay and padding out

`probe` subtracts both from mediabunny's length, as ffmpeg decodes
(30.000 s for 1251 frames of 1152 less 1105 and 47), and records them on
the asset (`Asset.gapless`, seconds). Relinking compares like with like:
a replacement may fall short of the original by its own trim, since an
MP3 imported before this counted the trim in its duration and the same
file reads that much shorter now.

### 4. What is saved stays as it was measured

What analysis read is not saved: readings live in memory for a session,
so analyze_music, mark_beats, preview_audio, measure_loudness and the
waveforms read the corrected timeline on their next call. A grid given
with `set_music_grid` (a cue sheet's seconds) was right all along and
now lines up with what plays. What an old reading left in a project is
left alone:

- song markers placed by analyze_music or mark_beats on an MP3 with no
  given grid (`follows.at`) sit the delay after their beat: 23 ms at
  48 kHz, 25 ms at 44.1 kHz, under a frame at 30 fps, so a marker's
  frame moves by at most one. Asking for the markers again replaces the
  clip's own markers of those kinds (`markClip`), so re-marking is one
  call;
- cuts made on that grid (cut_music, cut_to_beats, fit_music: clips'
  in-points) start the delay later in the song than they were measured:
  cut_music's 21 ms before a bar line becomes 2-4 ms after the beat;
- an old MP3's `duration` still counts the delay and padding, so a
  clip to its end plays tens of milliseconds of padding (silence).

Shifting them on load was rejected: it would read every MP3's tag before
the project opens, needs a flag so it happens once, and cannot tell a
measured marker from a given one (a marker does not record where its
time came from), and it could not move the cuts made on the same grid
(an in-point 23 ms later is a different edit). Shifting the markers and
not the cuts would part them; left alone, they stay together.

## Consequences

- Every MP3 with a LAME, Lavf or Lavc tag plays, exports, draws and
  measures its delay earlier than before (23 ms at 48 kHz, 25 ms at
  44.1 kHz for LAME's 1105 samples), on ffmpeg's timeline, in old
  projects too; new imports are their true length.
- An MP3's first `audioStart` waits on one 10-byte read per ID3 tag and
  one 4 KB read, once per file.
- `onset-120.wav`, `.mp3` and `.m4a` (one known onset, three files) join
  the fixtures; `mp3-timing.js` checks the length, the analysis decode,
  the export mix, the waveform and analyze_music's beats of each against
  the WAV, and fails on every MP3 check without this change. The tag
  reader's tests build headers for every MPEG version, layout and flag,
  and read the head ffmpeg wrote for `music-30s.mp3`.

## Not done

- The app's own MP3 export still starts late everywhere, as
  [[ADR-080 MP3 by LAME in WebAssembly, captions leave an export four ways]]
  says: the onset WAV exported as MP3 plays its first hit 1105 samples
  (23.02 ms) late in ffmpeg and in the app alike, since mediabunny's
  muxer writes a bare Xing frame (168 bytes here, too small for a LAME
  extension) and nothing trims it. Writing the delay into that frame, or
  dropping the encoder's first 1105 samples, is the fix if it matters.
- An MP3 in MP4 or Matroska keeps its container's own delay handling
  (the MP4 edit list mediabunny honors); only a raw MP3 file's LAME tag
  is read, as in ffmpeg. Not measured for Matroska.
- `clipForAsset` rounds a file's length to the nearer frame, so a clip of
  a whole file can end up to half a frame past it; relinking that file to
  itself is refused ("must be at least ... to cover the clips"). It was
  so before this change, for any file whose length is not whole frames.
  Done in [[ADR-117 A whole file relinks to itself, effects keep their size at every render size, and a split's halves share one compressor]]:
  a file covers a clip when the clip's last frame starts inside it, the
  rule clips are made by.
