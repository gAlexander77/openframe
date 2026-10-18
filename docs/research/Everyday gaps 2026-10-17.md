---
type: research
date: 2026-10-17
---

# Everyday gaps 2026-10-17

The owner asked what is still missing and for Playwright checks that the
styling and the workflows are right. [[Feature gaps 2026-10-16]] had
surveyed the big features the day before; this note records a second
pass aimed at what an everyday CapCut-style user hits, a code audit of
the UI, and what the `improvements` branch did about each. Statuses here
are as of the branch's last commit; the survey's rows were updated too.

**Method.**
- **Desk research:** official help pages and release notes for CapCut
  desktop, Premiere 26.0–26.3, Resolve 20–21, Final Cut 12.x and VEGAS
  23, looking for small, frequent features the survey missed or ranked
  low.
- **Code audit:** a read of `src/`:
  - commands with no button;
  - keys no menu shows;
  - "Coming soon" cards and `ponytail:` ceilings a user would hit;
  - empty states that give no help;
  - colors outside the tokens;
  - glyph buttons and chords typed into UI text.
- **Styling sweep:** a new drive (`scripts/drive/style-sweep.js`, see
  [[Driving the app]]) checks 129 states at three window sizes.

CapCut's 2026 desktop releases are mostly AI and cloud features, and
its timeline is largely unchanged. Final Cut 12.x is mostly AI tools,
and no VEGAS 23 update dated 2026 was found. So the everyday gaps below
come mainly from CapCut's existing UI and from Premiere 26.0–26.3.

## What was found, and what happened

| Gap | Who has it | Done on the branch |
|---|---|---|
| Remove media from the project; remove unused | Premiere (Remove Unused) | Yes: media card menu, Manage media > Remove unused, `remove_media` |
| Edit several selected clips' properties | Premiere 25 Properties panel | Yes: Scale, Rotate, Opacity, Volume, "Mixed" |
| Sync a separate recording to camera audio | CapCut (Sync video and audio), Resolve (Auto Sync Audio) | Yes: by waveform, `sync_audio` |
| Eyedropper on color fields | CapCut chroma key picker, Premiere | Yes: EyeDropper API pipette on every color field |
| Fade and volume handles on a video's own sound | Premiere 26 audio handles | Yes: on the video's waveform strip |
| Caption templates / looks | CapCut, Resolve 20 subtitle styles | Yes: six looks; per-word motion not yet |
| Rename and duplicate projects on Home | CapCut | Yes; a project trash is still open |
| Backup versions of a project | Premiere Auto Save keeps 20 | No: desktop only (Rust), needs a desktop check |
| Export audio and captions with the video; MP3 | CapCut export dialog | No: a second file needs a second save dialog on the web |
| CapCut's default keys we lack | CapCut | No: the sources disagreed on several keys |
| Import a folder | Premiere | No: desktop only (Rust) |
| Type a timecode to jump, +/- offsets | Premiere Playhead Position | Yes |
| Screen and camera recording | CapCut | Yes: Media > Record (web-checked; the desktop permissions are not) |
| A local sound-effects pack | Resolve's local library; CapCut's is cloud | Yes: eight synthesized effects |
| Style part of a text | Premiere | No: style runs need an ADR |
| Saved text styles | Premiere Text Styles, CapCut presets | Yes |
| Save a frame from the player | Premiere Export Frame, CapCut | Yes: camera button, Mod+Shift+E |
| Safe zones for TikTok, Reels, Shorts | Kapwing, Flixier (none of the five editors) | Yes: a viewer guide with snapping |
| Magnify (zoom lens) effect | Premiere 26.3 | Yes |

The survey's own P1 list, from [[Feature gaps 2026-10-16]], also
moved:
- **Done:**
  - Tracking ([[ADR-054 Tracking writes position keyframes]]).
  - Auto reframe, from the same tracker.
  - Linked picture and sound with out-of-sync counts (J/L cuts).
  - A motion path, drawn on the viewer.
- **Still open:**
  - Translated captions, which need a non-English speech fixture.
  - Proxies on demand.

## From the code audit

- **Agent-only commands now in the UI:**
  - a solid color layer;
  - the canvas size in pixels;
  - Delete shown markers;
  - title-safe align.
- **Kept agent-only on purpose:** `add_track`. Empty tracks are tidied
  away, as in CapCut.
- **The reverse:** `set_project` said it set the frame rate and could
  not; it can now.
- **Names and keys:**
  - The text style buttons were letters with no names.
  - The trim tools printed stale keys.
  - Several buttons hid their chords.
  - Linkage, Preview axis and the keyframe panel were missing from the
    menus.
- **Also fixed:**
  - Captions' Enter now splits the caption at the caret, where the next
    word is spoken.
  - The transcript card says when reversed or speed-curved clips are
    left out, instead of dropping them silently.
- **Still open from the audit:** a dozen hard-coded colors that equal a
  token (listed in the audit's output; mostly CSS that predates the
  tokens).

## From the styling sweep

The sweep's first clean run caught three regressions of the branch
itself: a gray button face under the new clickable timecode (2.4:1
contrast), the new media menu ignoring Escape, and the save-frame button
pushing the total timecode out of the transport at the minimum window.
Every state is clean now. The automated checks cannot judge taste, so its
screenshots are looked at by eye; at 1100 x 680 the inspector is narrow
enough that Size and Style rows wrap, which reads fine.

## Sources

The research ran on 2026-10-17. URLs as given by the searches; some help
pages move.

- Premiere Remove Unused: https://community.adobe.com/questions-729/how-to-find-and-remove-unused-files-in-premiere-pro-cc-1354044
- Premiere 25.0 Properties panel: https://community.adobe.com/t5/premiere-pro-discussions/new-properties-panel-in-premiere-pro-25-0/m-p/15255020/highlight/true
- CapCut audio sync: https://www.capcut.com/resource/how-to-sync-audio-and-video ; Resolve: https://blog.frame.io/2017/05/15/sync-clips-in-davinci-resolve/
- CapCut chroma key picker: https://www.capcut.com/help/chroma-key-feature
- Premiere transition and audio handles: https://larryjordan.com/articles/subtle-but-sweet-video-transition-handles-in-premiere/
- Resolve 20 animated subtitles: https://larryjordan.com/articles/animate-subtitles-in-davinci-resolve-20/
- CapCut home project actions: https://www.elephorm.com/formation/maitriser-capcut-2026-les-fondamentaux/presentation-de-la-page-daccueil-et-gestion-des-projets-dans-capcut
- Premiere Auto Save: https://helpx.adobe.com/sk/premiere/desktop/get-started/preferences-and-settings/auto-save-preferences.html
- CapCut caption export: https://www.capcut.com/help/captions-fail-to-export
- CapCut shortcuts (third-party list): https://fastshortcuts.com/shortcuts/capcut/
- Premiere folder import: https://helpx.adobe.com/lv/premiere-pro/how-to/import-file-directly.html
- Premiere playhead position: https://helpx.adobe.com/tw/premiere/desktop/edit-projects/change-clip-sequence/navigate-sequences-in-the-timeline.html
- CapCut screen recorder: https://www.capcut.com/resource/screen-recorder-with-facecam
- Resolve's Fairlight sound library: https://nofilmschool.com/davinici-resolve-fairlight-update
- Premiere Text Styles: https://helpx.adobe.com/premiere-pro/using/text-styles.html
- Premiere Export Frame: https://helpx.adobe.com/au/premiere/desktop/render-and-export/export-files/export-a-still-frame.html
- Safe zones (third-party): https://www.kapwing.com/video-editor/tiktok/safe-zone ; https://reap.video/blog/short-form-video-safe-zones ; https://visu.network/tools/safe-zone-checker/ ; https://adkit.so/tools/safe-zones/youtube
- Premiere 26.3 (Magnify): https://community.adobe.com/announcements-727/what-s-new-in-adobe-premiere-26-3-june-2026-1628369/index1.html
