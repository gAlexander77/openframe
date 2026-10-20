# ADR-098: Sound is mixed by role, beds are synthesized, an agent can listen

**Date:** 2026-10-19. **Status:** accepted.

## Context

An agent made a 72-second documentary through the MCP tools alone and
reported every limit it met (the film test of 2026-10-19). Five concerned
sound and review:

- **F.** `add_sound_effect` put each sound on the first audio track with
  room: the riser into the first drop landed in a gap on the Voiceover
  track, the rest on a generic "Audio" track. Stems were told apart by
  track names (`/^voiceover/`, `/sfx/`), so a renamed track changed what
  `measure_loudness` called dialog and music.
- **Natural sound.** The sound catalog held synthetic stingers and
  transitions. The film's footage was silent; it needed wind, water, a
  rocket's rumble and a city, and there was nothing to lay under it.
- **I.** The agent could not hear the result. `review_voiceover` answers
  transcripts and numbers, `measure_loudness` answers a few figures for
  the whole mix; neither lets a model that accepts audio listen.
- **L.** At the same 640-pixel review width, a title in `preview_frames`
  looked heavier than the same title in the exported file.
- **J.** In one `preview_motion` sheet across a speed-ramped launch, the
  first tile seemed to show a later rocket position than the second.

## Decision

### 1. Every audio track is a stem: dialog, music, effects or ambience

`Track.role` (`dialog | music | effects | ambience`, audio tracks only)
says what a track is. The tool that makes a track sets it: `add_voiceover`
dialog, `generate_music` music, `add_sound_effect` effects, `add_ambience`
ambience; `add_track` and `update_track` take `role` (`auto` clears it).
A file says what it is too: `Asset.role` on a made sound, effect, bed or
score, and a spoken file is dialog by its `speech`. `lib/audioRoles.ts`
judges a track by its role, else by what most of its clips' files are
(by length), else (projects saved before roles) by the names those tools
gave their tracks, else music: an imported song is the bed under
everything. Video tracks are not stems; their sound is the picture's own.

A new sound lands by role (`roleTrack`): on the first unlocked track of
its stem with room, else a new one named for the stem (Voiceover, Music,
SFX, Ambience) below the last of its kind. A file without a role (an
imported song) lands only on a music track, never in a gap on the voice,
the effects or the beds; a library drop and `add_media_clip` without a
track go by the same rule. A track asked for (`track_id`) is used; where
its spot is taken, a new track of its role goes just below it.
`describe_project` names each audio track's `role`, `measure_loudness`
`by_track` names each track's, and its balance is the dialog stem against
the music stem. `review_voiceover`'s music and `duck_under_speech`'s
voices read roles too.

### 2. Ambience beds are synthesized in layers that move, and loop

`lib/ambience.ts` makes eight beds on this computer, seeded, with no
recording and no one's license: wind, stream, waterfall, surf, rain,
rocket rumble, city traffic and room tone. A bed is layers of shaped
noise (pink, brown, white through filters) and of physically modelled
events: Minnaert bubbles with Van den Doel's rising chirp for water
(radius r rings at about 3.26/r Hz, damped by 0.043 f + 0.0014 f^1.5 a
second, sizes by a power law), decaying ticks for raindrops, cars passing
as 1/distance swells with a Doppler fall and a pan across, waves that
swell, break (a brightness opening in a third of a second) and wash back
with foam's crackle every 6.5 to 13 seconds (the first within 1.5 s, so
a bed under one shot of the sea never opens on a lull), and a rocket's crackle as
skewed shock spikes over its roar. Everything slow moves at random
(gusts, a brook's busyness, rain's intensity, each layer's level), so no
pattern comes round again. Each layer's level is set against the first
from its own first 20 seconds (long enough for a few cars or waves); the
whole is made at a loudness that sits under a voice at volume 1 (about
-27 LUFS; waterfall -24, rocket -21, room tone -46) with its peaks under
-1 dBFS. Everything under 18 Hz is filtered out over the whole render,
then the last three seconds are crossfaded (equal power) into the first,
so the file's last sample runs on into its first.

`add_ambience` (`name`, `start`, `end` or `length`, `fade_in`,
`fade_out`, `volume`, `seed`, `track_id`) synthesizes the file in a
worker (a minute of bed took 0.4 to 2.1 s in Node on this
development machine), saves it with the
project's media and lays it on the Ambience track, faded, as one undo
step; the same bed and seed reuse a long enough file. A file is at most
300 s (a 57 MB WAV); a longer bed repeats it end to end, on whole frames
so each repeat starts on the loop point. The Audio tab lists the beds:
Listen plays eight seconds, + lays one from the playhead to the end.

Measured, not listened to (`ambience.test.ts`, against what recordings of
each kind show): wind loudest under 250 Hz and falling 2 dB an octave or
more; a stream's energy 500 Hz to 2 kHz, almost none under 250 Hz; a
waterfall flat within 7 dB from 63 Hz to 4 kHz; surf low with its breaks
reaching 8 kHz; rain loudest 2 to 8 kHz; a rocket loudest under 125 Hz; a
street with its tires near 1 kHz; room tone sloping gently down. Wind,
surf and traffic move 3 to 10 dB over seconds (their 400 ms loudness),
water, rain, a rocket and a room under 3 dB, none dead still, and none
correlates with itself at any lag from 2 to 15 s. Surf has a wave in its
first 4 seconds and no second more than 10 dB under its average: the
desktop check found half its seeds opening on 3 to 9 s of trough and the
roar between sets 20 dB down, which every other test had passed. The loop's join steps
no more than an ordinary sample does (a mutation without the crossfade
fails it), and no 10 ms window has a slope 12 times its neighborhood's
(30 for rain's drops and the rocket's shocks, transients by nature).

### 3. preview_audio renders through the export's mixer and answers MP3 and numbers

`preview_audio` (`start`, `end`, `solo: mix | voice | music | effects |
ambience`, `loudness`, `audio`) renders a stretch (at most 30 s a call)
through `engine/mixdown.ts`, the OfflineAudioContext windows export
renders through, with each window's pre-roll for effect tails. `solo`
isolates a stem by role; `loudness` measures the whole mix as export does
and applies the same gain and limiter to the stretch where it sits. It
answers an MCP audio content block (MP3, 96 kbps stereo, LAME in
WebAssembly as the MP3 export uses: about 12 KB a second) and, as text,
`lib/analysis/audition.ts`'s summary: integrated loudness, the loudest
3 s and 400 ms, every second's loudness, the true peak, silent stretches,
the power below 250 Hz, to 4 kHz and above with the octave slope, the
stereo correlation, clipped samples and, for the mix, each stem's
loudness. `audio: false` answers the numbers alone, for a client that
cannot take an audio block.

### 4. Previews are drawn at the canvas's size and brought down

Titles are rasterized by Canvas2D at the render size. `preview_frames`,
`preview_motion` and `preview_frame` rendered at the asked width, so a
60-pixel title on a 1080p canvas was drawn 20 pixels tall at 640 wide,
where hinting and antialiasing thicken small type: measured on white
titles over black (weights 400 and 500, sizes 36, 60 and 96), the
preview held 3 to 21% more ink than the exported H.264 file at the same
width. They now draw each frame at the canvas's size (its short side at
most 1080) and bring it down to the asked width (`exportStills`'
`drawAt`); the preview then holds the file's ink within 0.4%, and 500
still draws heavier than 400. The downscale is bilinear
(`createImageBitmap`'s `resizeQuality: "low"`): Chromium's `medium` and
`high` measured the same, both smoothed a dark sky's grain away and the
JPEG sheet of it then banded (ADR-073's check fails); bilinear keeps the
grain the compositor's own scaling kept before and is what a player's
scaling of the file looks like.

### 5. The first tile after a seek: investigated, not reproduced

`preview_motion` resolves its frames in order through one `CursorPool`
(`exportStills`), the first after a fresh decoder seek (mediabunny's
`samples(t)` starts at the last frame at or before t). With the frame
counter fixture (each frame's number in ten blocks) under two speed
curves (1.6 to 0.25 to 1.8, and 0.5 to 2.5), 13 sheets starting all over
both ramps, 217 tiles, every tile read back from the JPEG matched the
viewer's frame at its time and none stepped back; `preview_frames` agreed
too. The film's launch footage under three ramps, sheets at 6.7 to 8.3 s
as the agent called them, matched the viewer tile for tile. No defect was
found in the seek, decode or frame cache; `scripts/drive/motion-first-frame.js`
now holds it.

## Consequences

- Stems no longer depend on names: renaming a track changes nothing, and
  a user's imported song never falls into the voiceover's gap. Projects
  saved before roles keep their stems by the old names until a track is
  given a role.
- A bed is synthesis, not a recording: convincing as texture under
  narration and music, not as a featured close-up sound. More kinds are
  more layers in `AMBIENCE`; the tests hold each new one to its kind.
- ponytail: past 300 s a bed's repeats join under the mixer's 4 ms
  click guard at each clip edge; a looping clip would join them
  sample-exact.
- An MP3 a call is roughly 12 KB a second; clients that cannot take audio
  content can ask for numbers only.
- Previews cost a full-size composite a frame instead of a small one.
- `scripts/drive/sound-stems.js`, `motion-first-frame.js` and
  `preview-text-weight.js` hold sections 1 to 5 in the running web build.
