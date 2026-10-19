---
type: research
date: 2026-10-18
---

# Launch film through MCP 2026-10-18

The owner asked for a new, fully professional and modern promo for
OpenFrame, edited through OpenFrame's own MCP tools, and for every limit
met along the way, as feedback for the product. This note records how
the film was made, what worked, and the limits ranked by what they cost.
The film replaces the first promo (2026-10-17, see [[History]]): a
screen recording with burned-in sentences and dissolves.

## What was made

A 56 s, 1080p30 launch film, exported at -14.0 LUFS and -1.1 dBTP.
ffmpeg measured the file independently at -14.0 LUFS integrated. It has
no voice: kinetic type, product footage and an original track carry it.

| Time (s) | Part |
|---|---|
| 0-8 | The hook: "Pro editing. Zero friction." / "Open source. AI built in.", per-letter and per-word blur-ins on a dark, drifting light |
| 7.75-8 | A cut to black on the music's breath |
| 8-12 | Drop 1: the logo springs in under a light bloom; the wordmark blurs in letter by letter |
| 12-32 | Montage, one feature a bar: Cut, Color, Motion, Captions, Effects, Sound, then the whole app |
| 32-36 | Breakdown: "Then there's AI." typed |
| 36-44 | Drop 2: an agent filling a timeline live, "Live, over MCP.", then "This film was edited by an AI agent." |
| 44-48 | Export ring to complete; the 9:16 canvas |
| 48-56 | End card: icon, wordmark, "Free and open source.", a pill that draws on around the repository URL |

The montage alternates two moves:
- **Floating windows:** UI footage in a rounded mask, with a hairline
  border and a soft shadow, sliding in with an expo-out ease and motion
  blur.
- **Full-bleed macros:** `frame_region` push-ins on the feature in use.

Zoom punches and whips cover the cuts, and a whoosh or pop marks each
one. A film grain and vignette adjustment clip finishes the frame.
`check_project` passes with no errors.

## How

- **Footage:** a subagent recorded 13 clips of the web build at
  2560x1440 in headless Edge (DevTools screencast, an injected cursor),
  so zooms stay sharp. The demo project inside them is built from CC0
  (Wikimedia Commons) and public-domain (NASA) clips, credited below.
- **Music:** a subagent synthesized an original 120 BPM track in
  Python, 56.0 s, with stems and a cue sheet. At 120 BPM a bar is
  exactly 2.0 s, so every section is cut on bar lines.
- **The edit:** every clip, title, keyframe, mask, transition, sound
  and the export went in through the MCP tools, about 90 calls,
  most of them batches.
- **Outside OpenFrame:** soft radial glow sprites, a window-shadow
  sprite and the PNG logo, all made in Python or a headless browser
  because the editor cannot draw them (limits 1 and 3 below).

## What worked

- `batch` with `$N` and `$N.track` references: a whole floating window
  (shadow, footage, mask, border, compound clip, keyframes, motion blur,
  title, subline, alignment) is one call.
- **The type:** kinetic presets per letter, word and line (blurIn by
  letter, letterRise, wordRise, typewriter), gradient fills, and
  `align_clips` with `margin` for one left edge.
- `frame_region` with `to_region` for macro push-ins, and `slip_clip` to
  find the moment.
- `preview_motion` and `preview_frames`: every section was checked by
  eye before moving on.
- `create_compound_clip` as a precomp: a three-layer window animates as
  one unit.
- `measure_loudness` with `loudness` showed what export would deliver,
  and export matched it.
- `check_project` caught sublines on screen 1.6 s that need 2-3 s to
  read. Tighter copy fixed them and made the film better.

## Limits, ranked

### What the film could not look like

1. **No soft light.**
   - The blur effect's maximum is about 15-20 px at 1080p. Five stacked
     passes still show an ellipse's edge.
   - Shapes have no radial gradient and no feather.
   - Soft background glows are the staple of modern launch films; here
     they were imported sprites.
   - *Fix:* a radial gradient or `feather` on shapes; blur up to about
     300 px (downsampled passes are cheap).
2. **One font weight.** Titles are `bold` or not, so a heavy display face
   cannot be paired with a light one. *Fix:* `style.weight` 100-900.
3. **No shadow on pictures, no perspective.**
   - A floating window's shadow was a sprite.
   - Windows cannot tilt in 3D, as product films often do.
   - *Fix:* a drop shadow on visual clips (blur, offset, color), and
     rotateX/rotateY with perspective in the transform.
4. **One color per title.** An accent word inside a line ("built *in*")
   needs its own clip, placed by eye. *Fix:* inline runs (color,
   gradient, weight per run).
5. **`export_versions` cannot adapt a designed film.**
   - On the 9:16 sheet, windows that slide in with keyframed x/scale sit
     almost entirely off-frame: keyframed positions are not re-laid out.
   - The 170-size wordmark is pushed left and cut off on 9:16 and 1:1.
   - Only the end card adapts.
   - It works for ads built from `add_ad_element`, not for hand-animated
     layouts.
   - *Fix:* rescale keyframed paths per version, relative to the safe
     area; shrink text wider than the new frame to the safe width.

### What misled the model

6. **Keyframes on paths that do not animate are accepted silently.**
   `add_keyframe` on `style.letterSpacing` answers that the path is
   keyframed, but nothing moves. It is the same class as the
   effect-path bug fixed earlier the same day. *Fix:* reject paths the
   renderer does not interpolate; make size, letter spacing and color
   animatable.
7. **Keyframe values are invisible.** `describe_project` lists keyed
   paths but not their keys, so changing a keyed value answers as if
   nothing changed. *Fix:* describe keys as `[{at, value, ease}]`.
8. **`analyze_music` finds one drop and misses short sections.**
   - **Test:** a track whose structure is known exactly.
   - **Right:** the tempo, every downbeat, the 36 s drop and the 48 s
     outro.
   - **Wrong:** it missed the 8 s drop (the section boundary came a bar
     early, at 6 s) and the 2-bar breakdown, though its own beat energy
     falls from 0.90 to 0.65 there.
   - *Fix:* report every drop after a dip; allow 2-bar sections; snap
     bounds to phrases.
9. **`check_project` guesses on a designed film.**
   - 22 contrast tips call white type on a near-black background "over
     footage", because the glow sprites are image clips.
   - "Music ends abruptly" fires on a track that fades out in its own
     audio.
   - The summary reports 1 shot of 56 s, because the cuts live on an
     overlay track.
   - *Fix:* sample the rendered frame behind each text box, measure the
     audio's last second, and count cuts on every visual track.

10. **Voice balance is computed by hand.**
    - Two optional voiced versions were made on project copies, with
      `add_voiceover` (George, Heart) and `duck_under_speech`.
    - Was the voice clear of the music? Muting the music and measuring
      one line gave the voice at -16.2 LUFS; the full mix measured -15.2.
      Subtracting energies left the ducked music at -22.1 LUFS, only
      about 6 LU under the voice at depth 9. Depth 13 gave about 10 LU,
      right for a promo.
    - `set_param volume` on the ducked music added a key and answered
      "unchanged" (limit 7).
    - Reads cannot be directed: one voice and speed per call, no
      emphasis or pauses. The model cannot listen.
    - *Fix:* `measure_loudness` per track or stem (dialog, music,
      effects); a `duck_under_speech` target such as "voice 10 LU above
      the music" that it measures and meets.

### What cost time

11. **Templates.**
    - Each floating window is a compound clip of its own, because a
      compound is one timeline and its footage cannot be swapped.
    - There is no group transform, so moving several layers together
      needs a compound.
    - *Fix:* replace media inside a compound copy, or `group_clips` with
      a group transform.
12. **Answers grow with the project.** Every edit that touches a compound
    echoes every compound's whole nested timeline, about 3 KB per call
    with six windows, and `open_project` answers the whole timeline
    (about 20 KB here). *Fix:* report only changed compounds, summarized.
13. **Sound design is a call per sound.**
    - `add_sound_effect` cannot be batched.
    - Workaround: after the first call the sound is an asset, so place
      the rest with `add_media_clip` inside a batch.
    - *Fix:* a list form, or a whoosh option on `set_transition`.
14. **Two ease vocabularies.**
    - `add_keyframe` takes 8 eases; `set_keyframe_ease` takes 12 and a
      bezier. The modern expo-out needs two calls per key.
    - `lineHeight` exists on text styles but is missing from the style
      schema.
    - `preview_motion` caps tiles at 480 px where `preview_frames`
      allows 640.

## Found while recording the footage

The footage agent built a demo project and drove the web build for an
hour; these are the product's own rough edges it hit.

1. **Long-GOP sources stall at cuts.**
   - With ffmpeg's default 8 s keyframe interval, playback froze for
     0.4-0.5 s at cuts into clips that start late in their source, and a
     zoom-punch transition was skipped.
   - Re-encoding with a 1 s interval played smoothly.
   - *Fix:* start decoding the next clip earlier (seek-ahead at the
     playhead's distance to the cut).
2. **One slider drag, eight undo steps.** The Animation Duration slider
   recorded each step of one drag as its own undo step. The color wheels
   and the effect and reverb sliders make one.
3. **Animation presets do not preview.** Picking one does not play it in
   the viewer, and every preset tile shows the same blue square.
4. **The AI assistant panel covers the editor.** It overlays the
   inspector, the timeline zoom and the viewer's loudness readout instead
   of taking its own column.
5. **`preview_frames` is posterized.** Skies band heavily in the contact
   sheets, which misleads a model judging a grade.
6. **Templates scatter their layers.** A two-layer location template put
   its title on the B-roll track; a second one made an extra track.
7. **Clipped and overlapping chrome:**
   - the trim preview's header and footnote are cut off in a short
     player panel;
   - "Action 93%" and "Title 90%" overlap on a small 9:16 canvas;
   - after toggling Low-pass, the Reverb row drops below the inspector's
     fold with no way to scroll to it;
   - inspector sections forget their open or closed state on reload.
8. **A successful loudness normalization is shown as a warning** (amber,
   with a warning icon) on the export-complete card.
9. **The export dialog keeps the last preset across projects.** After
   one export, "TikTok, Reels and Shorts" was preselected on a 16:9
   project, and that preset still exports 1920x1080.
10. **Web imports by URL are not copied into the browser's storage**, so
    a project goes offline with the URL (picked files are copied).
    Pressing Create and leaving at once leaves an empty project on Home.
11. **Headless capture limits:** native dropdown lists are not drawn in
    screencasts, so a promo shows the value change but not the list.

## Media credits

The demo media seen inside the editor:
- **Wikimedia Commons, CC0:** speedboat, harbor, lake, falls, fog,
  golden sunset, Paris sunset, skyline, sea sparkle.
- **NASA Image and Video Library, public domain:** the Artemis II launch
  and three Earth-from-orbit shots.

Each file's source URL is in the footage folder's credits file. No NASA
insignia is shown prominently.
