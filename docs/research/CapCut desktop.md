---
title: CapCut desktop
aliases: [CapCut PC, CapCut Pro desktop, JianYing Pro]
tags: [research, competitor, capcut, ux, video-editor]
created: 2026-10-13
updated: 2026-10-13
status: reference
scope: CapCut desktop (Windows/macOS) 2025-2026 builds, v6.8 to v9.4
---

# CapCut desktop

UX reference for rebuilding a CapCut-class editing experience in Video Editor (Tauri v2 + Rust + React/TS). Built from the CapCut help center, capcut.com resource pages and their embedded app screenshots, third-party tutorials and guides, reviews, pricing pages, and reverse-engineered draft-format tooling.

> [!info] Confidence legend
> - **[SS]**: seen directly in an official CapCut desktop screenshot (2024-2025 builds). Strongest evidence.
> - **(file)**: value taken from the project file (`draft_content.json`) as written by the open-source pyJianYingDraft / capcut-cli tooling. It shows defaults and step counts, but not always the on-screen units.
> - **(unverified)**: from one weak source or inferred. Check it against a running copy before you treat it as spec.
> - CapCut moves features between builds without notice. Its own help page (Jan 2026) says tools "may be moved, redesigned, or reorganized". Treat labels as version-dependent.

> [!summary] TL;DR for engineers
> - **Layout:** four floating panels on a near-black backdrop. Media/asset library is top-left, Player top-center, Inspector ("Details") top-right, and the Timeline spans the bottom. Asset categories are a horizontal row of icon-over-label tabs, each with a collapsible left sub-nav.
> - **Timeline:** CapCut's timeline is a single **main track** plus auto-created layer tracks. Four toggles define its feel: **Main track magnet** (ripple on the main track only), **Auto snapping**, **Linkage** (overlays follow their main clip), and **Preview axis** (hover-scrub).
> - **Inspector:** three-level navigation (tabs, then a segmented control, then pills). Every animatable row has `↺ ‹ ◇ ›`: reset, previous keyframe, add/remove keyframe, next keyframe.
> - **Visual style:** neutral grey ramp `#141414 / #1C1C1C / #262626 / #303030 / #3B3B3B` with one accent, cyan `#00C1CD`. Pro items carry a violet gem.
> - **Monetization:** CapCut's biggest weakness is now its paywall: captions, 4K, and AI tools moved behind Pro, the annual price rose to $179.99 in Feb 2026, and Pro items are only flagged at export. Its other weaknesses are cloud/ToS distrust, long-timeline instability, and no scopes, audio mixer, or interchange formats.

---

## 0. Versions and lineage

- **Current (Oct 2026):**
  - Windows 9.4.0 (2026-09-05).
  - macOS 9.3.0 (2026-08-19).
- **Recent builds:**
  - 6.8.1 (Aug 2025)
  - 7.5.0 (Nov 2025)
  - 7.9.0 / 8.0.1 (Jan 2026)
  - 9.0.0 (Jul 2026)
  - "CapCut desktop v5-v7" in older tutorials maps to the 2024-2025 UI.
- **Lineage:** same app and codebase as ByteDance's **JianYing Pro (剪映专业版)**. Chinese JianYing docs are a valid secondary source for behavior.
- **Platform:** Windows and macOS only; macOS 14+ for current builds (Wikipedia). No Linux.

**2026 platform timeline:**

| Date | Change |
|---|---|
| Jan 2026 | UI reorganized, locations of features changed. |
| Jan 2026 | 2K/4K export rules clarified as plan- and device-dependent. |
| Feb 2026 | Pro annual price raised from ~$77.99 to $179.99. |
| Mar 2026 | Credit system formalized. Three credit types: subscription, activity, purchased. |
| Apr 2026 | Standard tier added. Pro credits raised from 550 to 1,200 per month; Pro storage raised to 1 TB. Seedance 2.0 rolled out. |
| Jun 2026 | Ultra tier added. "Director Mode" (AI short dramas) added. |
| Jul 2026 | Seedance 2.5 announced. |
| Aug 2026 | Kling 3.0, Veo 3, and PixVerse added to the model picker. |
| Sep 2026 | **EditPilot** (prompt-driven first-pass edit on PC). |

- **Paywall badges** (official help):
  - Blue diamond: included in Standard.
  - **Violet/purple diamond (gem)**: Pro.
  - "Free" pill: temporarily free Pro feature.
  - Older builds used a "PRO" corner label.

---

## 1. Window layout

### 1.1 Editor regions

```
+--------------------------------------------------------------------------------------+
| [logo] Menu v  (check) Auto saved: 09:57:32      <project name>   [layout v] [Shortcuts] [gem Pro] [Share] [Export] _ [] X |
+----------------------------+-----------------------------+---------------------------+
| MEDIA / ASSET PANEL        | PLAYER                    = | INSPECTOR ("Details")     |
| [Media][Audio][Text][Stick-| (canvas, black letterbox)   | Tabs: Video Speed Anim... |
|  ers][Effects][Trans.]...  |                             | [Basic|Remove BG|Mask|..] |
| +--------+---------------+ |                             | Transform  ↺ ‹◇›          |
| |sub-nav | search, grid  | |                             |  Scale ----o---- 100% ‹◇› |
| |pills   | of asset cards| | 00:00:01:03  00:01:54:03    |  ...                      |
| |        |               | |      (play)  [Full][◎][Ratio][⛶]| [Save as preset][Apply to all] |
+----------------------------+-----------------------------+---------------------------+
| TOOLBAR: [▶v] ↶ ↷ | split  del-L del-R  delete  marker  crop  [freeze/reverse/mirror/rotate v] | AI quick tools ... || mic  magnet  snap  link  preview-axis | fit  ⊖ ===o=== ⊕ |
| ruler |00:00      |00:01      |00:02 ...      (white playhead with pin cap)          |
| [hdr] text/sticker/effect/filter/adjustment tracks (newest on top)                   |
| [hdr] overlay video tracks                                                           |
| [hdr][Cover] MAIN TRACK  filmstrip + label + audio waveform band                     |
| [hdr] audio tracks                                                                   |
+--------------------------------------------------------------------------------------+
```

- The window chrome is near-black. The four panels are rounded rectangles (radius ~6-8 px) separated by ~6 px gutters.
- Panels are resized by dragging the gutters. No docking or floating windows; detaching panels is mentioned once (unverified).
- Each panel has a ~32-34 px header strip, slightly lighter than its body.

### 1.2 Default proportions

Measured from full-window screenshots. Users may have resized them, so treat as approximate.

| Build | Media | Player | Inspector | Top row : Timeline |
|---|---|---|---|---|
| 2025 official screenshots [SS] | ~39% | ~39% | ~21% | ~66 : 34 |
| Nov 2024 macOS | ~40% | ~42% | ~18% | ~54 : 46 |
| 2023-24 Windows (empty project) [SS] | ~40% | ~29% | ~29% | ~53 : 47 |

- **Recommended default for Video Editor:** media 36%, player 40%, inspector 24% (min 300 px); top 58% / timeline 42%.
- **Layout presets** (top-bar layout button):
  - Default
  - Transcript-based editing
  - Media first
  - Player first
  - Adjustment first
  - Timeline first
  - Plus **Reset layout**.
  - One 2025 tutorial also mentions a vertical layout for 9:16 work (unverified).

### 1.3 Top bar (title bar, ~32-36 px)

- **Left:** CapCut logo, then a **Menu ▾** dropdown.
  - The menu holds File/Edit/Help items, **Settings**, **Back to home page**, and **Layout**.
  - On macOS the native menu bar is used instead: CapCut / File / Edit / Help.
- **Left, next to the menu:** autosave indicator `(check) Auto saved: HH:MM:SS`. The check icon is cyan.
- **Center:** project name. Click to rename. The default name is the creation date as `MMDD`, e.g., "0717"; duplicates get " (2)".
- **Right, in order:**
  - Layout switcher (grid icon ▾).
  - **Shortcuts** (keyboard icon; "Shortcut" in older builds).
  - Pro / "Join Pro" gradient pill.
  - **Share**.
  - **Export**: cyan primary button with an upload icon.
  - Window controls.

### 1.4 Media / asset panel

**Top category tabs** form a horizontal row of icon-over-label buttons (~11 px labels). The active tab's icon and label turn cyan. The row scrolls horizontally when the panel is narrow.

| Build | Tabs, left to right |
|---|---|
| 2023 | Media, Audio, Text, Stickers, Effects, Transitions, Filters, Adjustment |
| 2024-2025+ [SS] | **Media, Audio, Text, Stickers, Effects, Transitions, Captions, Filters, Adjustment, Templates, AI avatar(s)** |

**Panel body:**
- A **left sub-nav column** (~80 px) of collapsible pill groups. The selected item is shown as cyan text.
- Next to it, the content area: a search field, sort/filter/view controls, a category header (e.g., "Trending"), and a grid of asset cards.

**Per-tab sub-navigation and content:**

| Tab | Left sub-nav (2025 [SS] unless noted) | Content and notes |
|---|---|---|
| **Media** | **Import ▾** (Media, Subprojects), **Yours** ▾ (your presets), **AI media** ▾, **Spaces** ▾ (cloud), **Library** ▾ (stock: Trending, Green screen, Backgrounds, Intro/End, Transitions...). Older names: "Local", "Device", "Stock materials", "Brand assets". | Toolbar: `(+) Import` button, `Record` button, search field "Search for file names, scenes, or dialogs" (semantic/AI search over your clips), grid/list toggle, sort, filter. "All" breadcrumb plus folders. A **"Generate with AI"** card sits in the grid. Empty state: big dashed `(+) Import` box, "Supports: videos, audios, photos". Compound clips land under **Subprojects**. |
| **Audio** | **Import**, **Yours** ▾, **AI music**, **Music** ▾ (Hot Bgm, Vlog, Halloween, Marketing, Dreamy, Hits, Travel, Beauty, Fitness, Beats, Rock, Techno, Peace, Future Bass...), **Sound effects** ▾, plus "Extracted audio", "TikTok" (synced sounds), and brand/copyright-cleared sections in some builds. | Search "Search songs or artists" plus filter. Rows: cover art, title, `Artist · mm:ss`, star (favorite), and `↓` (download) or `+` (add). Click a row to preview-play. |
| **Text** | **Add text** (Default text), **Text template** (categories), **Effects** (word-art presets: Trending, Basic, Luminance, Multicolor, Yellow, Red, Blue, Green, Pink...), **AI generated / AI writer**. Older: Auto captions, Local captions. | Cards show styled "Default text" / "ART" previews with `↓` badges. |
| **Stickers** | **Yours** ▾, **Stickers** ▾ (AI generated, Trending, NEW, Hits, Halloween, Icons, Emoji, Emphasis, Cover-ups, Love, Mood, Sale, Text sticker, Vlog, Collage...). | Search, then a grid of animated sticker cards (~60-76 px). Gem at top-left marks Pro; `↓` at bottom-right. |
| **Effects** | **Favorites**, **Video effects** ▾ (Trending, NEW, Hits, Intro & Outro, Halloween, Party, Motion, Light, Retro, Glitch, Distortion, Decor, Screen, Edits, Sparkle...), **Body effects** ▾ (Trending, Selfie, Superpowers, Frame, Glowing lines, Mask, Funny faces, Background, Mood, Image), AI effects in newer builds (unverified). | Cards show a model preview, name below, Pro gem and `↓`. |
| **Transitions** | Favorites, Trending, Basic, Camera, Effects, Light, Slide, Wipe, Split, Distortion, MG... (category names unverified) | Default duration 0.5 s (file). One tutorial reports 0.9 s (unverified). |
| **Captions** | **Auto captions** (under "Auto generate"), **Manual captions / Add captions**, **Import captions** (.srt, or timecoded .txt, UTF-8), **Auto lyrics**, **AI packaging**, **AI emojis**, caption templates. | Auto-caption form: see §4.5. |
| **Filters** | Favorites, Featured, Life, Food, Movies, Scenery, Retro, Style, Night, B&W... (category names unverified) | Cards preview the filter on a sample image. |
| **Adjustment** | **Custom adjustment** (creates an adjustment clip), **LUT** (import .cube/.3dl), My presets. | Adds an adjustment-layer clip on its own track. |
| **Templates** | Categories of full-video templates. | Replaceable media slots. Mostly Pro. |
| **AI avatar(s)** | Avatar library plus custom avatar. | 100+ digital presenters; voice per avatar. |

**Asset card anatomy [SS]:**
- Thumbnail ~76 px square with radius ~4 px.
- **Pro gem** at the top-left.
- **Download arrow `↓`** at the bottom-right. On click it becomes a spinner, then a cyan **`+`** once cached.
- Label below in ~11 px secondary grey, truncated in the middle ("Golden...licker").
- Media cards show **duration at the top-right** (`00:06`) and an **"Added"** badge at the top-left once the clip is used on the timeline.

**Asset card interactions:**
- Hovering a media card scrubs through it.
- Media cards accept in/out trim handles before you drag the clip out.
- Hovering effect, transition, or animation cards plays their demo loop (unverified for 2026 builds).
- Add an asset by dragging it to the timeline or clicking `+`, which inserts at the playhead on the appropriate track.

### 1.5 Player panel

- **Header:** "Player", with a `≡` menu at the right. The menu holds preview settings and **Export still frame** (PNG/JPEG).
- **Canvas:**
  - Black letterbox inside the panel body.
  - The selected layer gets a white bounding box with corner handles and a **rotate handle** (circular icon) below the box [SS].
  - Blue/cyan alignment guides appear while dragging. Hold Ctrl to ignore them.
  - Safe-zone overlays: unverified.
- **Bottom bar:**
  - **Left:** current timecode `00:00:01:03` in cyan, total `00:01:54:03` in grey (format HH:MM:SS:FF), then a small toggle icon (timecode format / ruler).
  - **Center:** play/pause.
  - **Right:**
    - **Full**: preview quality, e.g., Full / 1/2 / 1/4. Affects preview only, not export.
    - **Zoom/crop** icon (canvas zoom/fit).
    - **Ratio**: aspect ratio picker, showing "Original" or e.g. "16:9".
    - Fullscreen.
    - An audio level meter at the far right in newer builds.

### 1.6 Inspector panel ("Details")

**Nothing selected:** the panel shows **draft parameters** (see §6.2) with a **Modify** button.

**Clip selected:** three navigation levels.
1. **Top text tabs** (~13 px). The active tab is cyan with no underline. Example: Video / Speed / Animation / Adjust / AI stylize.
2. **Segmented control** on an inset `#1C1C1C` track; the selected segment is `#3B3B3B`. Example: Basic / Remove BG / Mask / Retouch.
3. **Pills** for the third level. Example: Face / Body / Face presets / Body presets.

**Section and row pattern:**
- Each section starts with a **checkbox and title with collapse caret** (`☑ Blend ▴`). The checkbox enables or disables the whole section.
- Section headers carry `↺` (reset section) and `‹ ◇ ›` (keyframe the whole section).
- Each row has:
  - a label;
  - a slider: thin `#444` track, white round thumb;
  - a numeric field on an inset background, with a unit (`100%`, `0.0dB`, `0.0s`, `0.00°`) and a vertical stepper `⌃⌄`;
  - `‹ ◇ ›`.
- **Footer** sticky buttons, depending on the tab:
  - **Save as preset**: cyan filled.
  - **Apply to all**: grey.

### 1.7 Home screen (project list)

**Window:** dark, nearly black (`#0C0C0C` to `#0E1415`, slight teal tint), no panels.

**Left sidebar (~170 px):**
- Account card: avatar, "Sign in", and a **Join Pro** gradient button (cyan to violet).
- Section **"Video editing"**:
  - **Home** (selected pill).
  - **Spaces ▾**: cloud team spaces.
- Then:
  - **Image editing**
  - **Create with AI**
  - **Marketing tools**
- Older builds: Templates, "Invite friends", a "Recommended: Auto captions" card, questionnaire banner.

**Main area:**
- **Hero row:**
  - Wide **"(+) Create project"** banner, cyan gradient `#4BCFE1 → #1AB2CF`.
  - Next to it, an **AI design** carousel card with a prompt box.
  - Below: two medium tiles, **AI video maker** (AI badge) and **Record screen**.
- **"More tools"** row of square icon tiles with **AI** badges (`#13BFEB`):
  - Long video to shorts
  - Video translator
  - Text to speech
  - AI dialogue scene
  - AI fashion model
  - Enhance quality
  - Auto cutout
  - AI video
  - AI image
- **"Projects"** header:
  - Right side: search icon, grid/list toggle ▾, **Trash** (recycle bin), **Project sync** (cloud).
  - Grid of project cards: thumbnail, name, size, duration, cloud badge.
  - Card right-click: rename, duplicate, delete, open folder (unverified).
  - Empty state: "Project edited will be saved automatically. Start creating your own videos!"

**Top-right:** upload/sync, feedback, **settings gear**, window controls.

**First run:** a role questionnaire ("Which of the following roles best describes you?").

### 1.8 Global settings (gear on home, or Menu > Settings)

| Section | Settings |
|---|---|
| **Draft** | Draft location, cache size with **Clear cache**, cache auto-delete (e.g., 30 days), download/preset save path. Default draft paths: Windows `%LocalAppData%\CapCut\User Data\Projects\com.lveditor.draft\<name>`, macOS `~/Movies/CapCut/User Data/Projects/com.lveditor.draft/<name>`. |
| **Edit** | **Free layer** (default for new projects); **Step forward = 10 frames** (Shift+arrow jump); **Adjust value = 10 units**; **Default image duration = 5.0 s**; **Target loudness −23 LUFS** (normalize); default frame rate; time code format `HH:MM:SS+frame`. |
| **Performance** | **Proxy** (off by default), **Speed up hardware decoding**, **Speed up hardware encoding**. |
| Other | Language, version and update check (arrow icon at top-right when an update exists), account. A light/dark theme switch is claimed by one weak source (unverified). Every editor screenshot is dark. |

---

## 2. Timeline

### 2.1 Anatomy

- **Toolbar row** (~28-32 px) above the ruler. Left: edit tools. Right: toggles and zoom.
- **Ruler:**
  - Labels like `|00:00`, `|00:01` in MM:SS, each with a tick bar.
  - Frame ticks appear at high zoom.
  - Clicking the ruler moves the playhead.
- **Playhead:**
  - 1 px white line through all tracks.
  - White outlined pentagon "pin" cap on the ruler [SS].
  - Dragging it scrubs the player.
- **Track header column** (~90-120 px) at the left, same background as the timeline body.
- The main track has an extra **Cover** button (pencil plus "Cover") between header and clips.
- Empty lanes are slightly lighter (`#2F2F2F`) than the body (`#262626`). Empty space to the right of the last main clip also shows a lighter lane.
- **Empty project:** a full-width dashed drop zone with a film icon: "Drag material here and start to create" [SS].
- **Range:** when set, an in/out range shows as a highlighted region on the ruler.

### 2.2 Toolbar: left side, left to right (2025 build [SS])

The set adapts to the selection. Irrelevant items are greyed or hidden.

| # | Control | Icon | Key | Behavior |
|---|---|---|---|---|
| 1 | Tool mode dropdown | arrow ▾ | A / B / [ / ] | **Select (A)**, **Split/blade (B)**, **Select leftward ([)**, **Select rightward (])**: selects all clips left or right of the cursor, across tracks. |
| — | separator | | | |
| 2 | Undo | ↶ | Ctrl+Z | |
| 3 | Redo | ↷ | Ctrl+Shift+Z | |
| 4 | **Split** | `][` | Ctrl+B | Splits the selected clip at the playhead. Ctrl+Shift+B splits **all tracks** at the playhead. |
| 5 | **Delete left** ("Split left") | `[` with bar | Q | Removes from the playhead back to the clip start. Ripples on the main track. |
| 6 | **Delete right** ("Split right") | `]` with bar | W | Removes from the playhead to the clip end. |
| 7 | **Delete** | trash | Backspace / Delete | Ripples on the main track when the magnet is on. |
| 8 | **Add marker** | tag/shield | M | Adds a marker on the selected clip or the ruler. |
| 9 | **Crop** ("Crop & resize") | crop | — | Opens the crop dialog: free / ratio presets, rotate. Video and image only. |
| 10 | **Freeze / Reverse / Mirror / Rotate** | one icon ▾ (2025), four icons (2024) | — | **Freeze** inserts a 3 s still at the playhead. **Reverse** renders a reversed copy (progress toast). **Mirror** flips horizontally. **Rotate** turns 90° clockwise. |
| — | separator | | | |
| 11+ | **AI quick tools** (context) | various; a `›` chevron scrolls them | — | Video clip: Transcript, Split scene, Remove background, Auto adjust (wand), Enhance quality (HD icon), Extract audio, Enhance audio, Voiceover, Retouch (person + sparkle). Audio clip: beats/markers, enhance voice, etc. (names unverified). |

When a text or sticker clip is selected, only Split, Delete left, Delete right, Delete, and Mirror remain [SS].

### 2.3 Toolbar: right side, left to right [SS]

1. **Record audio** (microphone): opens a voiceover dialog with input device, level, echo cancellation, and "mute project while recording". Records onto a new audio track at the playhead.
2. **Main track magnet**: cyan icon when on. Key **P**.
3. **Auto snapping**: key **N**.
4. **Linkage** ▾: key **`** (backtick/tilde). The dropdown options are unverified.
5. **Preview axis** ▾: key **S**.
6. Separator, then **Zoom to fit** (Shift+Z).
7. **Zoom out ⊖**, horizontal **zoom slider**, **Zoom in ⊕**. Also Ctrl+= / Ctrl+− and Ctrl+mouse wheel.

On/off state is shown by color only: cyan when on, grey or white when off. All four toggles are on by default except preview axis, which varies.

### 2.4 The four toggles (exact behavior)

**Main track magnet (主轨磁吸)**
- **ON (default):**
  - Clips on the main track are always packed end-to-end starting at 00:00. No gaps are possible.
  - Delete, trim, Q/W, and speed changes ripple later main clips left or right.
  - Dragging a main clip reorders it. Other clips slide to make room, with a live insertion animation.
  - Dropping new media between main clips inserts it and ripples.
  - **Only the main track ripples.** Overlay, audio, and text tracks stay put unless Linkage attaches them to a main clip.
- **OFF:**
  - The main track behaves like any track. Gaps are allowed (rendered black).
  - Moving a clip leaves a gap.
  - Dropping onto an occupied spot pushes the dropped clip onto a new overlay track instead of reordering.
- Stored in the project as `config.maintrack_adsorb` (file).

**Auto snapping (自动吸附)**
- While dragging or trimming, clip edges snap to the playhead, other clip edges, markers, and the ruler origin.
- A **cyan vertical guide line** shows the snap target.
- With snapping off, clips move freely, frame-accurate.

**Linkage (联动)**
- Text, stickers, effects, filters, and adjustment clips (and probably overlay video) placed over a main-track clip are bound to it.
- When the main clip moves or ripples, the attached clips move with it, keeping their relative offset.
- Deleting the main clip does not necessarily delete the attached clips (unverified).

**Preview axis (预览轴)**
- When on, a **yellow vertical line** follows the mouse over the timeline and the player shows that frame (hover-scrub).
- The real playhead does not move until you click.
- I/O marks at the preview-axis position.

### 2.5 Track types, order, and creation

- **Stack order, top to bottom:**
  1. Text, sticker, effect, filter, and adjustment tracks. The most recently created track is on top.
  2. **Overlay video tracks** ("PIP").
  3. **Main track**: the lowest video track, the "spine" of the edit.
  4. **Audio tracks**: music, SFX, voiceover, extracted audio.
- **Compositing:** higher tracks render over lower ones. Effect, filter, and adjustment clips on a track affect **everything below them** for their time range.
- **Free layer** ("Arrange layers" since late 2024):
  - Per-project setting, off by default.
  - When enabled, text and stickers can be placed below video tracks, i.e., arbitrary z-order.
  - Once enabled on a project it cannot be turned off.
  - Stored as `free_render_index_mode_on` (file).
- **Track creation is implicit:**
  - Dropping a clip on empty space above the top track or below the bottom track creates a new track of the right kind.
  - Dropping onto an existing compatible track places it there if the space is free.
  - Empty tracks are removed automatically (unverified).
  - Right-click "Add track" / Ctrl+Alt+T is mentioned by one blog (unverified).
- **Transitions:** only between two adjacent clips on the **main track**. Overlays get in/out animations instead.
- **Limits:** none are documented. Reviews report slowdowns around 20-30 tracks.

### 2.6 Track header controls [SS]

| Track | Type icon | Controls |
|---|---|---|
| Main video | play-in-square | Lock, Eye (hide), Speaker (mute), `⋯` (more), and the **Cover** button |
| Overlay video | play-in-square | Lock, Eye, Speaker, `⋯` |
| Audio | music-note circle | Lock, Speaker, `⋯` (no eye) |
| Text | `TI` | Lock, Eye |
| Sticker | pie/clock circle | Lock, Eye |
| Effect | sparkle star | Lock, Eye |
| Filter | three circles | Lock, Eye |
| Adjustment | sliders icon | Lock, Eye (unverified) |

- **Lock:** clips can't be selected or edited; they render dimmed or hatched.
- **Hide:** the track is not rendered or exported.
- **Mute:** the track is silent.
- **Cover** opens the cover/thumbnail designer, the same one as "Edit cover" in Export.
- No per-track height control is visible. Track heights are fixed by type (see §8.4).

### 2.7 Clip appearance

| Clip | Body color | Content |
|---|---|---|
| Video / image (main or overlay) | dark teal `#004D52` | Top label band: filename plus duration chip `00:00:05:02`. Filmstrip thumbnails tile the body. Bottom ~14 px band holds the clip's own audio waveform. |
| Compound clip | teal | Compound icon plus "Compound clip1 00:00:40:06". |
| AI media clip | teal | "✦ AI media" label. |
| Music / extracted audio | navy `#0E3058` | Bright blue waveform `#0E6290`-`#104972`, name at top-left. Effect tag pills, e.g., "Voice filters Aircraft broadcast". |
| Recorded voiceover | petrol `#003A4C` | Muted teal waveform. |
| Text / caption | terracotta `#9C4937` (variant `#A75E4D`) | `A≡` icon plus the text content. |
| Sticker | amber `#D5942B` | Sticker thumbnail. |
| Effect | muted purple `#826190` | ✦ icon plus effect name ("Diamond Z"). |
| Filter | indigo / blue-violet | ⊚ icon plus filter name (color estimated). |
| Adjustment | gold/olive (2023 build) | Sliders icon plus "Adjustment" (unverified for 2025). |

**Clip states:**
- **Selection:** ~2 px **white** border with rounded corners (~3-4 px). The label band brightens.
- **Trimming:** hover a clip edge and the cursor becomes a trim cursor. Dragging the edge trims, with snapping. Handles are not drawn until hover.
- **Keyframes:** white `◇` diamonds drawn over the selected clip's filmstrip at their times. They show cyan-filled when the playhead is on them.
- **Transitions:** a translucent rounded box straddling the cut, with a bow-tie `⧓` icon. Drag its edges to change duration.
- **Audio clip extras:**
  - A **volume line** you can drag up or down.
  - **Fade handles** drawn as darkened triangles at the clip ends.
  - **Orange peak ticks** where the audio clips.
- **Badges:** speed (e.g., `2.0x`), reverse, effects attached, missing media (red box), deactivated (V key; dimmed, not rendered).
- **Beat markers:** yellow dots along the bottom of audio clips.

### 2.8 Adding media and drag/drop rules

- **Ways to add:**
  - Drag from the media panel or from the OS file manager.
  - Click `+` on a card to insert at the playhead on the main track. Text, stickers, effects, and filters are inserted on a new track at the playhead.
- **The first clip sets the project's** "Original/Adapted" ratio, resolution, and frame rate.
- **Drop targets with the magnet ON:**
  - Between main clips: insert and ripple.
  - Onto the middle of a main clip: inserts at the nearest cut. CapCut does not overwrite on the main track.
  - Above the main track: overlay at that time.
  - Below the main track: audio (audio files only).
- **Replace clip:** right-click > Replace clip. Keeps duration, position, and effects (behavior partly unverified). Drag-to-replace is unverified.
- **Effects and filters:**
  - Drop on a track lane: standalone layer clip that affects everything below.
  - Drop onto a clip: attaches to that clip only (shown as a tag on the clip, editable in the inspector).
  - Some effects have an **"Apply to"** scope (Main track / Overlay / Global) on mobile. The desktop equivalent is unverified.
- **Duplicate:** Alt-drag (⌥-drag), or Ctrl+C / Ctrl+V at the playhead.

### 2.9 Editing operations

- **Split:** Ctrl+B splits the selected clip; with nothing selected it splits the topmost clip under the playhead (unverified). Ctrl+Shift+B splits all tracks.
- **Delete left / right (Q / W):** trim to the playhead and ripple. This is a fast "top-and-tail" workflow.
- **Ripple:** automatic on the main track with the magnet on. Other tracks never ripple except through Linkage.
- **Selection:**
  - Click to select; Shift/Ctrl-click for multi-select; marquee-drag on empty space.
  - `[` / `]` select everything left or right of the cursor.
  - Ctrl+A selects all (unverified).
- **Move between tracks:** drag vertically. A ghost preview shows the target lane, and a new lane appears if dropped in a gap.
- **Group** (Ctrl+G / Ctrl+Shift+G): grouped clips move together. They cannot be keyframed as a group.
- **Deactivate clip (V):** keeps the clip on the timeline but skips rendering.
- **Extract audio** (Ctrl+Shift+S): moves the clip's audio to an audio track and mutes the original. Pressing it again restores.

### 2.10 Keyframe UI

**Inspector controls [SS]:**
- Every animatable property row and every section header shows `‹ ◇ ›`.
- **◇** (outline) adds a keyframe at the playhead. When the playhead sits on a keyframe it shows **◆ cyan-filled**, and clicking it removes the keyframe.
- **‹ / ›** jump the playhead to the previous or next keyframe. They are greyed when there is no keyframe in that direction.
- The **section header ◇** (e.g., Transform) keyframes every property in the section at once.
- **Auto-keyframing:** once a property has at least one keyframe, changing its value at a new playhead time creates a keyframe automatically.

**On the timeline:**
- Diamonds appear over the selected clip only.
- Drag a diamond to retime it. Select it and press Delete to remove it.

**Keyframe panel / graphs:**
- Open with **Alt+K** (⌥K) or right-click > **Show keyframe animation**.
- Shows per-property lanes and curve editing. **Shift+Click** adds a keyframe in the panel.
- **Easing presets:** families Ease in / Ease out / Ease in-out (Quad, Cubic, ...), recoil/overshoot, plus a custom bezier. The project file stores `curveType` ∈ {`Line`, `EaseIn`, `EaseOut`, `FreeCurveInOut` (bezier)} with left/right control handles (file).

**Keyframable properties:**
- Transform: Position X/Y, Scale (uniform or X/Y), Rotate.
- Blend: Opacity.
- Adjust color sliders.
- Effect parameters (speed, strength, ...).
- Audio Volume.
- Mask (position, size, feather...). Pro in some builds.
- Text and stickers: position, scale, rotation.
- Grouped clips and some template items cannot be keyframed.

### 2.11 Right-click clip menu

Union of 2024 and 2025 builds.

- **Edit:**
  - Copy (Ctrl+C), Cut (Ctrl+X), Paste (Ctrl+V), Delete.
  - **Copy attributes** and **Paste attributes**. Paste opens a checklist of which attributes to paste: transform, adjust, effects, speed, animation, audio...
- **Clip operations:**
  - Trim clip.
  - **Split scene** (shot detection; marked "Free").
  - **Edit ›** submenu.
  - **Transcript-based editing**.
  - **Create compound clip (subproject)** (Alt+G) / **Undo compound clip** (Alt+Shift+G).
  - **Pre-process / Undo pre-process**: render-cache a compound clip.
  - Group / Ungroup.
  - **Link to media**: relink missing files.
- **Audio and AI:**
  - Vocal isolation › Keep vocal / Remove vocal.
  - **Generate captions** (Pro).
  - Edit effects.
  - **Extract audio**.
  - **Sync video and audio**.
- **Other:**
  - **Deactivate clip** (V).
  - **Replace clip**.
  - **Create multi-camera clip** (2025+).
  - **Save preset**.
  - **Show keyframe animation**.
  - **Range ›**: set range to clip, clear.
  - **Render ›**: render preview cache.

### 2.12 Compound clips, groups, multicam

- **Compound clip:**
  - Collapses the selected clips, across tracks, into one teal clip that behaves like a single video clip.
  - It is stored as a **Subproject** listed under Media > Import > Subprojects.
  - It can be pre-processed (render-cached) and undone back to its parts.
  - Editing inside it as a nested timeline is unverified. Reviewers describe it as limited compared with NLE nesting.
- **Group:** a lightweight move-together binding. No shared effects.
- **Multicam** (2025+):
  - Select angles, then **Create multi-camera clip**. Sync by **Auto / Audio / First marker**.
  - The player shows a 4- or 9-angle grid. Clicking an angle during playback cuts to it.
  - Mostly unverified detail. Reviewers in 2026 still list "no real multicam" as a gap.

### 2.13 Markers, ranges, beats

- **Markers:**
  - **M** adds a marker; **Alt+M** adds one with the next color.
  - **Shift+M** goes to the next marker; **Alt+Shift+M** to the previous.
  - Double-click a marker to edit its name, color, and note (unverified).
- **Range:**
  - **I / O** set the in/out points; **Shift+X** sets the range to the selected clip; **Alt+X** clears it.
  - The range drives **export of a section only**.
- **Beats:**
  - Auto beat detection on music clips draws yellow beat dots. Clips can be snapped to beats.
  - The manual beat key is Ctrl+J in JianYing; a 2026 cheat sheet maps Ctrl+J to "Match cut" instead (conflict, unverified).

### 2.14 Engineering notes: CapCut's data model

The draft format is useful as a reference for our own schema. **Do not** copy proprietary resource IDs.

- **Files:**
  - `draft_content.json`: the timeline.
  - `draft_meta_info.json`: display name and imported media list.
  - Newer builds increasingly store the draft **encrypted or obfuscated**: JianYing 6+, and "often not plain JSON" in newer CapCut.
- **Units:**
  - Time in **microseconds**.
  - Coordinates normalized and center-origin, range [-1, 1], **Y up**.
  - IDs are UUIDv4.
- **Structure:**
  - Top level: `canvas_config {ratio, width, height}`, `fps`, `color_space`, `config.maintrack_adsorb`, `free_render_index_mode_on`, `tracks[]`, `materials{}`, `keyframe_graph_list[]`.
  - **Tracks:** `{id, type: video|audio|text|effect|sticker|filter, flag (0 main / 3 secondary), attribute (lock/hide/mute bits), segments[]}`. Array order is z-order.
  - **Segments** (~49 fields):
    - Linking and timing: `material_id`, `target_timerange{start,duration}`, `source_timerange`, `speed`, `reverse`, `volume` (1.0 = 0 dB).
    - Transform: `clip{alpha, flip{h,v}, rotation, scale{x,y}, transform{x,y}}`, `uniform_scale{on,value}`.
    - Rendering: `visible`, `render_index`, `track_render_index`, `hdr_settings`.
    - Animation and references: `common_keyframes[]`, `extra_material_refs[]` (positional refs to speed, canvas, mask, transition, animation, sound-channel, vocal-separation materials).
    - About 15 `enable_*` flags gating adjust, LUT, HSL, curves, wheels, color match, and mask.
  - **Materials buckets:** videos, audios, texts (rich styling plus keyword highlight), stickers, transitions, masks, video_effects, effects (filters), speeds (incl. curve points), canvases, material_animations (in/out/loop), loudnesses, vocal_separations, and others.
- **Takeaway for Video Editor:**
  - Keep the same separation: tracks hold segments, segments reference materials, and per-segment keyframe groups use bezier graphs.
  - Make the format **open, documented, plain JSON**. This is a direct counter to CapCut's lock-in.

---

## 3. Inspector property tabs by clip type

### 3.0 Tab matrix

| Selection | Top tabs (2025 build) |
|---|---|
| Nothing | Draft details (§6.2) |
| Video clip | **Video** (Basic / Remove BG / Mask / Retouch), **Audio** (if it has sound), **Speed**, **Animation**, **Adjust** (Basic / HSL / Curves / Color wheel / Mask), **AI stylize**. Some builds also show **Tracking** and **AI media** (for AI-generated clips). |
| Image clip | Video (Basic / Remove BG / Mask / Retouch), Animation, Adjust, AI stylize. **No Speed or Audio.** Default duration 5.0 s (Settings > Edit). |
| Audio clip | **Basic**, **Voice changer**, **Speed** [SS] |
| Text clip | **Text** (Basic / Bubble / Effects), **Animation** (In / Out / Loop), **Tracking**, **Text to speech**. Caption clips add a **Captions** tab with the caption list. |
| Sticker | Sticker (transform, blend), Animation (In / Out / Loop), Tracking |
| Effect clip | Effect parameters (0-100 sliders, specific per effect) |
| Filter clip | Filter: Intensity 0-100, default 100 |
| Adjustment clip | Adjust (same as a video clip's Adjust tab) |
| Transition | Duration slider, **Apply to all** |

### 3.1 Video > Basic [SS]

| Section / control | Range, default, notes |
|---|---|
| **Transform** header | `↺ ‹◇›` |
| Scale | Slider plus % field. Default **100%**. Range ~1-500% on the slider (unverified); typed values may go higher. File: 1.0 = 100%. |
| Uniform scale | Toggle, **on** by default. Off reveals Scale X / Scale Y. |
| Position X / Y | Pixel offsets from canvas center. Default **0, 0**. X+ right, Y+ up. Each has a stepper and `‹◇›`. |
| Rotate | Degrees with 2 decimals (`0.00°`) plus a **rotation dial** knob. Default 0. Negative allowed. |
| Alignment row | Align left, center-horizontal, right, top, center-vertical, bottom, plus two greyed distribute buttons. Aligns the layer to the canvas. |
| **Blend** (checkbox section) | **Mode** dropdown: "Default"/Normal plus 10 modes (§3.2). **Opacity** 0-100%, default **100%**, keyframable. |
| **Stabilize** (Pro gem) | Level: Recommended / Minimum cut / Most stable. Crops edges. Analysis runs in the background. |
| **Enhance quality** (Pro gem) | HD / UHD AI upscale (unverified labels). |
| **Reduce image noise** (Pro gem) | Weak / Strong. |
| **Optical flow** (Pro gem) | 30 / 50 / 60 fps interpolation, **Apply to all**. |
| **AI expand** ("Free" pill) | Generative outpainting to fill the canvas. |
| **Remove flickers** | Mode: Flashlight / Fluorescent light / Time-lapse; Level: Recommended plus 2 more. |
| **Canvas / Background** | Main track only. None / **Blur** (4 strengths; file 0.0625 default, 0.375, 0.75, 1.0) / **Color** / **Style** (patterns) / custom image upload. **Apply to all**. Fills letterbox areas when clip and canvas aspect differ. |
| **Relight** | AI relighting: light color, intensity (controls unverified). |
| **Lens correction**, **Auto reframe** | Present in some builds (location unverified). |
| Flip / Rotate 90° / Crop | Timeline toolbar, not the inspector. |

### 3.2 Blend modes

Normal ("Default"), **Darken, Screen, Overlay, Multiply, Lighten, Hard light, Soft light, Linear burn, Color burn, Color dodge**. That is 11 total (file). The on-screen order is unverified. No Add, Difference, Exclusion, or Hue/Color/Luminosity, which is an easy upgrade for us.

### 3.3 Remove BG (older name: "Cutout")

**Auto removal:**
- Checkbox; one click, person/subject segmentation.
- Progress bar while processing; the result is cached.
- No gem in the 2025 screenshot. Some sources say Pro.

**Custom removal (smart cutout):**
- Brush to mark keep/erase areas, with brush size, eraser, and **smart stroke**.
- Pro (unverified).

**Chroma key:**
- Color picker (eyedropper on the canvas) plus a swatch, then these sliders:

| Slider | Range | Default |
|---|---|---|
| Strength / Intensity | 0-100 | 20 (file) |
| Shadow | 0-100 | 0 |
| Edge feather | 0-100 | 0 |
| Spill removal | 0-100 | 0 |

**Stroke / outline** around the cutout:
- Presets: Paper, Luminescence, Hand-drawn, Straight, Solid, Offset, Dotted.
- Sliders: Size, Spacing, Color [SS].

### 3.4 Mask

- **Shapes:**
  - None
  - **Linear** (a.k.a. Split/Line)
  - **Mirror** (band between two lines)
  - **Circle** (ellipse)
  - **Rectangle**
  - **Heart**
  - **Star**
  - Newer builds reportedly add Triangle, Ellipse, and a pen/custom path (unverified).
- **Parameters** (all keyframable):

| Parameter | Range / default |
|---|---|
| Position X / Y | Default center |
| Rotate | Degrees, default 0 |
| Size / Width / Height | Default 0.5 of clip height |
| **Feather** | 0-100, default 0 |
| **Round corners** | Rectangle only, 0-100, default 0 |
| **Invert** | Toggle |

- One mask per clip.
- **On-canvas handles:** drag the center to move; edge handles resize; a rotate handle; a feather arrow handle; a corner-radius handle.
- **Adjust > Mask** is a separate mask that limits color adjustments to a region.

### 3.5 Retouch (mostly Pro)

- **Navigation:** pills **Face / Body / Face presets / Body presets**, plus a face selector when several faces are detected.
- **Face sliders** (0-100, default 0): Smooth, Whiten, Sharpen, plus shape controls (slim face, V-line, eyes, nose, mouth...).
- **Body sliders:** slim, long legs, small head, ...
- **Makeup "Auto styles":** Native, Americano, Highlighter, Soft Glam, Soda blue, Sleek Shine, ...
- **Save as preset.**

### 3.6 Speed

**Standard tab ("Normal" in older builds):**
- Speed multiplier slider, **0.1x to 100x**, default **1.0x**. Log-scaled feel.
- **Duration** field showing the resulting length. Editing the duration sets the speed.
- **Change pitch** toggle, **off** by default, meaning pitch is preserved.
- **Smooth slow-mo** for speeds below 1x: Frame blending / Optical flow (Pro).

**Curve tab:**
- Preset tiles: **None, Custom, Montage, Hero (time), Bullet (time), Jump cut, Flash in, Flash out**.
- Selecting a preset applies it. Clicking it again opens the **graph editor**:
  - Horizontal axis is clip time.
  - Vertical axis is speed, **0.1x (bottom) to 10x (top)**.
  - Draggable points, plus **Add point** / **Delete point** and **Reset**.
  - The playhead line on the graph follows the clip.
  - A **Smooth slow-mo** checkbox.
- The resulting duration shows next to the graph.

### 3.7 Animation (video, image, sticker)

- **Tabs:** **In / Out / Combo**. Text and stickers have In / Out / **Loop** instead.
- **Grid:** preset tiles, each previewing its motion on hover. A "None" tile clears the animation.
- **Duration slider:**
  - Default **0.5 s** for most presets (range ~0.1 s to the clip length; file defaults run 0.17-6.9 s).
  - In + Out must not exceed the clip duration.
  - Combo spans the whole clip and replaces In/Out.
- **Example In presets:** Fade in, Zoom in, Zoom out, Slide up/down/left/right, Rotate, Shake, Swirl, Wiper, Pendulum, Mirror flip.
- **Example Combo presets:** Three-split, Cube, Swing, Roller coaster, Blinds.
- **Loop:** has a **speed** slider instead of duration.

### 3.8 Adjust

**Sub-tabs [SS]:** **Basic / HSL / Curves / Color wheel / Mask**.

**Basic, top of panel:**
- **Auto adjust** (AI color correction) with an **Intensity** slider (0-100, default 100?).
- **Protect skin tone** toggle.
- **Color match** to a reference clip or frame.
- **LUT** section: import .cube/.3dl, a LUT dropdown, and Intensity 0-100 (default 100). LUTs can also be applied from the Adjustment tab.

**Basic > Adjust section (`☑ Adjust ▴`, with `↺ ‹◇›`):**

| Group | Slider | Range / default | Track styling [SS] |
|---|---|---|---|
| Color | **Temp** (temperature) | −50..+50 / 0 | blue → yellow gradient |
| | **Tint** | −50..+50 / 0 | green → magenta gradient |
| | **Saturation** | −50..+50 / 0 | grey → red gradient |
| Lightness | **Exposure** | −50..+50 / 0 | grey |
| | **Contrast** | −50..+50 / 0 | |
| | **Highlight** | −50..+50 / 0 | |
| | **Shadow** | −50..+50 / 0 | |
| | **Whites** | −50..+50 / 0 | |
| | **Blacks** | −50..+50 / 0 | |
| | **Brilliance** ("Light sensation") | −50..+50 / 0 | |
| Effects | **Sharpen** | 0..100 / 0 | |
| | **Clarity** | 0..100 / 0 | |
| | **Particles / Grain** | 0..100 / 0 | |
| | **Fade** | 0..100 / 0 | |
| | **Vignette** | −50..+50 / 0 (unverified sign) | |

- Ranges follow CapCut's convention: two-sided −50..+50, one-sided 0..100. The file stores −1..+1. Exact per-slider ranges are unverified.
- Each slider has a numeric field and `◇`.
- **Footer:** **Save as preset** (to "My presets") and **Apply to all**.

**HSL:**
- 8 color swatches: Red, Orange, Yellow, Green, Cyan, Blue, Purple, Magenta.
- Per swatch: **Hue / Saturation / Lightness**, about −100..+100 (or ±50), default 0.
- Reset per color and reset all.

**Curves:**
- Channel buttons: Luma (white), Red, Green, Blue.
- Square graph: click to add points, drag to move, drag off to delete. Reset.

**Color wheel:**
- Four wheels: **Lift (shadows), Gamma (midtones), Gain (highlights), Offset**.
- Each has a draggable puck, a luminance slider, and reset.

**Adjustment layer:**
- Adjustment tab > Custom adjustment creates an adjustment clip on its own track.
- It applies the same Adjust controls to everything below it for its duration.

### 3.9 Audio > Basic [SS]

| Control | Range / default | Gating [SS] |
|---|---|---|
| `☑ Basic ▴` header | `↺ ‹◇›` | |
| **Volume** | Slider plus `0.0dB` field. Default **0.0 dB**; −∞ to **+20 dB** (max unverified; file 1.0 = 0 dB). Keyframable. Also Ctrl+. / Ctrl+, for ±0.1 dB steps. | Free |
| **Fade in** | Slider plus `0.0s`. Default 0; max ≈ half the clip. | Free |
| **Fade out** | Same as Fade in. | Free |
| **Normalize loudness** | Checkbox: "Normalize the loudness of the selected clip or clips to a target level." Target **−23 LUFS** (Settings > Edit). | **Pro gem** in the 2025 screenshot |
| **Enhance voice** ▾ | Checkbox plus level 0-100%. Removes echo, clicks, and pops. | Pro |
| **Audio translator** ▾ | Translates speech to another language. | Pro |
| **Reduce noise** | Checkbox. Some guides list Light / Medium / Strong. | Pro |
| **Isolate voice** ▾ (vocal isolation) | Keep vocal / Remove vocal. Newer: "Separate audio" with a choice of elements. | "Free" pill |
| **Fill channel** ▾ | Left→both / right→both channel fill. `↺ ‹◇›`. | Free |
| Speed | Same controls as §3.6. Pitch toggle. | Free |
| Beats | Auto beat detection on music (timeline). | Free (unverified) |

### 3.10 Audio > Voice changer

Three groups. One effect per group, many Pro.

**Voice filters** (sliders 0-100, defaults from file):

| Filter | Parameters / defaults |
|---|---|
| Lo-Fi, Synth, Megaphone, Low battery, Electronic | Intensity 100 |
| Echo | Quantity 80, Strength 76 |
| Underwater | Depth 50 |
| Surround | Center 50, Frequency 50 |
| Vibrato | Frequency 71, Amplitude 90 |
| Mic hog | Room 5, Intensity 45 |
| Vinyl | Intensity 100, Noise 74 |
| 8-bit | Pitch 50, Timbre 100, Strength 100 |
| Aircraft broadcast | (parameters not recorded) |

**Voice characters:** Robot, Chipmunk, Jessie, Bestie, Distorted, Psychic, ..., each with Pitch / Timbre sliders.

**Speech to song:** converts speech to a sung melody.

Applied effects show as tag pills on the audio clip in the timeline [SS].

### 3.11 Sticker, effect, filter, transition clips

- **Sticker:** transform (scale, position, rotate), opacity/blend, In/Out/Loop animation, Tracking.
- **Effect:**
  - Per-effect parameter sliders (0-100): e.g., Speed, Intensity/Strength, Range, Texture, Color. Each slider is keyframable.
  - **Apply scope:** an effect on its own track affects everything below it. An effect dropped onto a clip affects that clip only.
- **Filter:** Intensity **0-100, default 100**. One filter per clip when attached to a clip; filter tracks stack.
- **Transition:**
  - Duration slider, default **0.5 s** (range ~0.1 s up to the shorter of the adjacent clip halves; file presets 0.2-5.0 s).
  - **Apply to all** applies it to every cut on the main track.
  - One transition per cut, stored on the outgoing clip.

### 3.12 AI stylize / AI media tabs

- **AI stylize:**
  - Grid of art styles (anime, oil, 3D cartoon, ...) with an intensity setting.
  - Generates a restyled copy (credits).
- **AI media** (on AI-generated clips):
  - Prompt, Model (e.g., "Video 3.0 Frames" with first/last frame), Motion speed, Camera control, Duration (5 s), Aspect ratio.
  - **Modify / Regenerate**.
  - Shows "Estimated credits needed ✦ N" and "Credits left".

---

## 4. Text features

### 4.1 Adding text

- **Text tab > Add text:**
  - The "Default text" card adds a text clip at the playhead on a new text track.
  - Default length ~3 s (unverified; image default is 5 s).
  - The text is shown centered on the canvas.
- **Text template:** pre-animated multi-layer title designs by category (Trending, Social, Title, Subscribe, Vlog, ...). Pro-heavy.
- **Effects (word art):** one-click style presets (fill, stroke, shadow, glow combos) by color family.
- **AI generated / AI writer:** generate text from a prompt.
- **On-canvas editing:**
  - Double-click the text on the canvas to edit inline. Inspector edits sync live.
  - Alt-drag a corner to scale from the center.
  - **Enter** inside a caption splits it; **Ctrl+Enter** inserts a line break.
  - Letter shortcuts are disabled while editing.

### 4.2 Text > Basic

Panel order approximate.

| Control | Details / defaults |
|---|---|
| Text box | Multi-line text area with a cyan focus border [SS marketing]. |
| **Font** | Dropdown with previews. CapCut cloud fonts (downloaded on demand; some Pro) plus **imported local fonts** (.ttf/.otf) plus system fonts. |
| **Font size** | Slider plus field (file default size 8.0 in internal units; on-screen default ~15). |
| **Pattern / Format** | **B / U / I** toggles. Case: Aa / AA / aa. |
| **Color** | Swatch plus dropdown: palette, eyedropper, hex, recent colors. Gradient fill in newer builds (unverified). |
| **Opacity** | 0-100%. |
| **Spacing** | Character spacing (Word) and Line spacing, default 0, `↺`. |
| **Alignment** | Left / Center / Right, plus vertical text variants (top / center / bottom). |
| **Styles** (preset row) | A row of quick style swatches: none, outline, shadow, yellow-on-black, box, ... |
| **Stroke** (checkbox) | Color (default black), Width 0-100 (file default 40). |
| **Background** (checkbox) | Style (2 variants), Color, Opacity, **Rounded corners** (0-100), Height, Width (file 0.14), Offset X / Y. |
| **Shadow** (checkbox) | Color (black), Opacity 100%, **Blur** 0-100 (default 15), **Distance** 0-100 (default 5), **Angle** −180..180 (default −45°). |
| **Glow**, **Curve** (arc text) | Present on mobile; desktop presence unverified. |
| **Transform** | Scale, Position X / Y, Rotate, all with `‹◇›`. |
| Auto wrap | Wraps at ~0.82 of canvas width (file). |
| Footer | **Save as preset**; for captions, an **Apply to all** checkbox applies styling to every caption on the track. |

**Bubble:** speech-bubble and callout frames behind the text.

**Effects:** word-art presets, i.e., the same set as the left Text > Effects list.

### 4.3 Text animation

- **Tabs:** In / Out / **Loop**.
- **Durations:** In and Out default to 0.5 s each. **Loop** has a speed slider ("Fast ↔ Slow").
- **Scale:** ~40 free plus ~50 Pro loop animations.
- **Examples:** Typewriter, Fade in, Pop up, Slide, Blur, Wave, VHS, Rainbow, Light sweep, Swing, Glitch flicker, Heartbeat.
- **Karaoke / word-by-word:** comes from caption templates ("trendy" styles, mostly Pro) and keyword highlighting, not from the generic animation list.

### 4.4 Text to speech (text clip > Text to speech tab)

- **Mode:** segmented control **Custom voices [Try free] / Text-to-speech** [SS]. Custom voices = voice clone from a sample recording.
- **Voice grid:**
  - Filters: Trending, English, Narration, Characters, Accents, Languages, ...; 200+ voices.
  - Each card has a hover preview. Free: English and Spanish; other languages Pro.
- **Settings:**
  - Speed and pitch sliders.
  - **"Update speech according to script"** checkbox: regenerates the audio when the text changes.
- **Generate speech:**
  - Creates an audio clip on a new audio track aligned to the text clip start.
  - Optionally deletes or keeps the text, or runs auto captions on the generated speech.

### 4.5 Auto captions workflow

**Generating:**
1. **Captions** tab > **Auto captions** (older builds: Text > Auto captions; some help pages describe Text > Auto Captions > choose language and audio track > **Recognize**).
2. Form fields [SS]:
   - **Spoken language** (auto-detect, or pick one of ~20-25 languages)
   - **Bilingual captions** (pick a second language)
   - **Auto highlight keywords** (Pro gem)
   - **AI emojis**
   - **Identify filler words**
   - **Delete current captions** / **Clear current captions**
   - Source: all audio / selected clip / voiceover only (mobile has Audio / Video / All)
3. **Generate / Create** (cyan full-width button).
   - Progress shows "Recognizing..." with a percentage.
   - Runs in the cloud; needs internet.
   - Results land on a caption text track as one clip per phrase.

**Editing:**
- **Captions tab in the inspector:** a numbered **caption list**. Each row shows timecode and editable text; click a row to seek.
  - Search, and find & replace (unverified).
  - Highlight keywords per row.
  - Enter splits; merge with the next caption (unverified).
- **Timeline:** double-click a caption clip, or right-click > **Edit captions**.
  - Split with Ctrl+B. Trim the edges.
  - Restyle via Text > Basic with **Apply to all**.
  - Caption templates (style packs with animation) apply to all.
- **Transcript-based editing** (Layout > Transcript-based editing, or right-click):
  - Shows the transcript as text.
  - Deleting words cuts the video.
  - Pauses appear as `[...1.14s]` tokens.
  - **Remove filler words** and **remove pauses** (threshold ~1.8 s suggested); keyword search.
  - A selection popover offers Delete / Text template.

**Import and export:**
- Import: Captions > Import captions (.srt, or .txt with timecodes; UTF-8).
- Export: in the export dialog, **Captions: SRT / TXT** with an encoding option. Only auto-recognized captions export; reported paid and desktop-only.

**Limits:**
- Free accounts get ~5 auto-caption runs per month, shared across platforms.
- The 2025 restructure moved captions toward paid plans, and sources conflict on current free availability.
- Re-recognizing only part of a clip is not supported.

### 4.6 Lyrics recognition

- **Auto lyrics:** recognizes sung lyrics on music clips into timed caption clips.
  - Confirmed on mobile and listed in the desktop Captions sub-nav.
  - Desktop UX: same form as auto captions, with a language picker (unverified).
- Lyrics clips carry `lyric_keyframes` in the file. They typically get karaoke-style templates.

### 4.7 Tracking (text and stickers)

- Select a text or sticker clip, then the **Tracking** tab.
- Drag the tracking box over the subject in the player, then **Start tracking**. Progress is shown.
- The text follows the subject's position, optionally its scale (unverified).
- Results are stored as keyframes or tracking data on the clip.

---

## 5. AI and automation features

How each feature is surfaced in the UI is listed per row. Gating: gem = Pro; "credits" = draws on the AI credit balance; the UI shows "Estimated credits needed ✦ N" before running.

| Feature | What the user gets | Where in the UI | Gating |
|---|---|---|---|
| **Auto captions** | Speech → timed, styled caption clips; bilingual; filler-word detection; keyword highlight; AI emojis. | Media panel **Captions** tab; right-click > Generate captions; home "More tools". | Partly Pro since 2025; free quota ~5/month. |
| **Transcript-based editing** | Edit video by editing text; remove fillers and pauses. | Layout menu > Transcript-based editing; right-click; toolbar "Transcript". | Mixed. |
| **Auto lyrics**, **AI packaging**, **AI emojis** | Lyrics → captions; AI-designed caption styling. | Captions tab sub-nav. | Partly Pro. |
| **Text to speech** | 200+ voices; generates a voiceover clip. | Text clip > Text to speech tab; home tile. | English/Spanish free; others Pro. |
| **Custom voices** (voice clone) | Clone your voice from a sample for TTS. | TTS tab segmented "Custom voices". | Trial, then Pro. |
| **Voice changer** | Filters and characters; speech to song. | Audio > Voice changer. | Mixed. |
| **Enhance voice** | Studio-like voice cleanup. | Audio > Basic. | Pro. |
| **Reduce noise** | Background noise removal. | Audio > Basic. | Pro. |
| **Isolate voice / Separate audio** | Stem split: vocals vs. rest. | Audio > Basic; right-click. | "Free" pill (promo). |
| **Normalize loudness** | One-click loudness to −23 LUFS. | Audio > Basic. | Pro gem (2025 SS). |
| **Audio translator / Video translator** | Translate speech; video translator adds **lip sync**. | Audio > Basic; home "Video translator" opens its own window with "Detect source language", "Translate to", "Lip sync" toggle. | Credits (114 credits per 20 s with lip sync [SS]). |
| **AI music** | Generated background music. | Audio tab > AI music. | Credits. |
| **Beats** (auto beat marking) | Beat markers on music for cutting to the beat. | Audio clip context / toolbar. | Free (unverified). |
| **Remove BG (auto)** | Person/subject cutout without green screen. | Video > Remove BG > Auto removal; toolbar AI tool. | Free in 2025 SS (varies). |
| **Custom removal / Smart cutout** | Brush-guided segmentation of any object. | Video > Remove BG > Custom removal. | Pro (unverified). |
| **Chroma key** | Classic keying. | Video > Remove BG > Chroma key. | Free (edge feather / spill may be Pro). |
| **Auto cutout** (home tool) | Batch cutout tool. | Home "More tools". | Credits. |
| **Retouch** | Face smoothing, reshaping, makeup styles, body reshape. | Video > Retouch; toolbar AI tool. | Mostly Pro. |
| **Auto reframe** | Change aspect ratio while keeping the subject centered; batch. | Ratio button / clip settings / home (location varies). | Pro (unverified). |
| **Enhance quality** | AI upscale HD/UHD. | Video > Basic; toolbar "HD"; home tile. | Pro. |
| **Reduce image noise** | Video denoise. | Video > Basic. | Pro. |
| **Remove flickers** | De-flicker for lights and time-lapse. | Video > Basic. | Pro (web). |
| **Stabilize** | Software stabilization. | Video > Basic. | Pro gem. |
| **Optical flow** | Frame interpolation for slow-mo and frame-rate conversion. | Video > Basic; Speed; Export toggle. | Pro. |
| **Relight** | AI relighting of faces/scenes. | Video > Basic. | Pro (unverified). |
| **Auto adjust / Color match** | One-click color correction; match a reference. | Adjust > Basic; toolbar wand. | Paid (per Pixflow). |
| **Motion tracking** | Pin text/stickers to a subject. | Text/Sticker > Tracking tab. | Free (unverified). |
| **Camera tracking** | Lock to camera motion. | Video settings (unverified). | Pro. |
| **Split scene** (scene detection) | Auto-cut at shot changes. | Right-click > Split scene; toolbar. | "Free". |
| **Auto Cut** | AI rough cut: Beat sync, Speech-pause detection, AI script mode (typed instruction). | Toolbar AI button / AI tools; "Auto-clipping" templates. | Unclear. |
| **EditPilot** (Sep 2026) | Prompt-driven first-pass edit: trims, filler removal, reordering, transitions, alternate versions. | PC editor (UI not documented). | Unknown. |
| **Long video to shorts** | Finds highlights in a long video and outputs vertical shorts with captions. | Home "More tools". | Credits. |
| **AI video maker / Script to video** | Script (typed or AI-written) → scenes with stock or AI media, avatar, voiceover, captions, music. "Edit more" sends the result to the timeline. | Home hero tile. Opens a separate **light-themed** workspace with a Script / Scenes / Captions / Music rail. | Credits / Pro. |
| **AI avatars** | 100+ digital presenters lip-synced to a script. | Media panel **AI avatar** tab; AI video maker. | Mixed. |
| **AI media (text/image → video, image gen)** | Generative clips and images. Models: Seedance 2.0/2.5 (up to 30 s, 4K), Seedream 5.0 Pro, Kling 3.0, Veo 3/3.1, PixVerse, Sora 2. | Media > AI media; "Generate with AI" card; home AI video / AI image tiles. | Credits (40 credits for a 5 s clip [SS]; ~416 for 8 s Veo 3). |
| **AI stylize** | Restyle footage into art styles. | Inspector **AI stylize** tab. | Credits. |
| **AI expand** | Outpaint frame edges to fill the canvas. | Video > Basic. | "Free" promo. |
| **AI dialogue scene**, **AI fashion model** | Generative marketing scenes. | Home "More tools". | Credits. |
| **Semantic media search** | Search clips by "file names, scenes, or dialogs". | Media tab search box [SS]. | Free (unverified). |
| **Director Mode** (Jun 2026) | AI short-drama production with character, scene, and prop continuity. | Video Studio (desktop + web). | Credits. |

> [!note] UI pattern for AI features
> - **Inline toggles in the inspector:** a checkbox section with a progress state for "analyzing...".
> - **Contextual toolbar buttons** that change with the selection.
> - **Home-screen tool tiles** that open separate mini-workspaces: translator, AI video maker.
> - **Credit estimates** shown before running.
> - Results are always written back as ordinary clips or attributes that can be edited.

---

## 6. Export dialog and project settings

### 6.1 Export dialog

**Opening:**
- The top-bar **Export** button (Ctrl+E; reported "varies by build").
- The dialog is modal over a darkened scrim (~60% black). Title "Export", ~640×560 px.

**Left column:**
- Cover preview with an **Edit cover** button. It opens the cover designer: frame picker from the video or upload, plus templates, text, stickers, shapes, frames.
- Older builds had a "Cover: With cover" option.

**Right column fields:**

| Field | Options / behavior |
|---|---|
| **Name** | Text field; default is the project name. |
| **Export to** | Path field (truncated) plus a folder button. Remembers the last location. |
| **☑ Video** (collapsible) | Checkbox; uncheck for audio-only export. |
| Resolution | **480p, 720p, 1080p, 2K (1440p), 4K**. 8K reported in 2025+ builds (one screenshot; unverified). Default 1080p. 2K/4K depend on plan, device, and OS. |
| Bit rate | **Lower / Recommended / Higher / Custom** (Custom: enter kbps; a CBR/VBR choice is reported but unverified). Default Recommended. |
| Codec | **H.264**, **HEVC (H.265)**. AV1 not found in any source. Default H.264. |
| Format | **mp4**, **mov**. Default mp4. |
| Frame rate | **24, 25, 30, 50, 60 fps**. 23.976/29.97/59.94 at export unverified. Default = project fps (e.g., 30fps). |
| Optical flow | Toggle: "Turn it on to apply optical flow to all clips". Pro. |
| Color space | Read-only line reflecting the project, e.g., "Color space: Rec. 709 SDR". HDR (Rec.2100 HLG/PQ) needs an HDR project; Pro. |
| Sync to Space | Toggle: upload the export to cloud Space. |
| **☐ Audio** | Format: **MP3, WAV, AAC, FLAC**. Exports alongside the video or alone. |
| **☐ GIF** | Resolution options 240p / 320p / 480p / 640p (desktop list unverified; max 640p reported). Exports the range or selection. |
| **☐ Captions** | Format **SRT / TXT** plus encoding. Only for recognized/imported captions. Reported paid. |
| Copyright check | Toggle "Check copyright?" before sharing. |
| Pro items notice | "Pro benefits: N items": lists Pro assets used. Exporting requires upgrade or removing them; older builds watermarked. |

**Footer:**
- Left: `[film icon] Duration: 7s | Size: about 10 MB` (live estimate).
- Right: **Export** (cyan) and **Cancel** (grey).

**Progress:**
- The dialog switches to a progress view: thumbnail, percentage, and a cancel option. Export runs in-app, not in the background queue.

**After export:**
- A share panel: "Video is saved to your desktop or laptop. You can share it now."
- **TikTok / YouTube** tabs with account sign-in, title, visibility, comment/duet/stitch toggles, and Share.
- An auto-generated **9:16 version** offer (Pro).
- **Open folder** and **Cancel** buttons.

**Partial exports:**
- **Range export:** set I/O (or Shift+X on a clip) and only that range exports.
- **Export still frame:** Player `≡` menu, PNG/JPEG with resolution choice.
- **Export selected clip:** via range.

### 6.2 Project settings ("Details" when nothing is selected) [SS]

**Draft details** fields, in order:

| Field | Example | Notes |
|---|---|---|
| Name | 0504 | |
| Path / Saved | `C:/Users/<u>/AppData/Local/CapCut/User Data/Projects/com.lveditor.draft/0504` | |
| Aspect ratio | Original | Follows the first clip. |
| Resolution | Adapted | Follows the first clip. |
| Color space | Rec. 709 SDR | |
| Frame rate | 30.00fps | |
| Imported media | Keep in original place / Stay in original location | Alternative: copy into the project folder. |

Then a divider, followed by:
- Proxy: Turned off.
- Arrange layers (older: Free layer): Turned on/off.
- **Modify** button at the bottom-right.

**Modify** opens the "Project settings" dialog (Save / Cancel):

| Setting | Options |
|---|---|
| Name | text |
| Aspect ratio | **Original, 16:9, 9:16, 1:1, 4:3, 3:4, 2.35:1, 2:1, 1.85:1, 21:9 (unverified), 5.8-inch (unverified), Custom** |
| Resolution | **Adapted**, plus presets per ratio, e.g., 16:9 → 480p / 720p / 1080p / 2K / 4K; custom width × height for Custom ratio. |
| Frame rate | **23.976, 24, 25, 29.97, 30, 50, 59.94, 60** (30/60 confirmed; others unverified). |
| Color space | **Rec. 709 SDR** (default), **Rec. 2100 HLG**, **Rec. 2100 PQ** (HDR; Pro). |
| Imported media | Keep in original location / Copy to project folder. |
| Proxy | On / Off. Proxy generation for heavy media. |
| Arrange layers / Free layer | Toggle; irreversible once on. |

The player's **Ratio** button is a shortcut to change the aspect ratio. The canvas re-letterboxes immediately; clips keep their relative position and scale.

---

## 7. Keyboard shortcuts (CapCut desktop, Windows defaults)

Mac: Ctrl → **⌘**, Alt → **⌥**. Single-letter keys, Space, arrows, and Q/W are identical. The source is the in-app shortcut list, cross-checked across three reproductions; rows marked (u) are unverified.

**Opening the shortcut panel:**
- The **Shortcuts** button (keyboard icon) in the top bar. Tooltips on toolbar buttons also show their keys.
- 2025-2026 builds allow **custom key bindings**: click a key, press the new combo, get a conflict warning; **Reset to default**.
- Presets mimic **Premiere Pro / Final Cut Pro** (Resolve mentioned once).
- The panel's category tabs (Timeline / Player / Others) are unverified.

### General and project

| Action | Windows | Mac |
|---|---|---|
| New project | Ctrl+N | ⌘N |
| Import media | Ctrl+I | ⌘I |
| Export | Ctrl+E | ⌘E |
| Quit | Ctrl+Q | ⌘Q |
| Undo / Redo | Ctrl+Z / Ctrl+Shift+Z | ⌘Z / ⇧⌘Z |
| Copy / Cut / Paste | Ctrl+C / Ctrl+X / Ctrl+V | ⌘C / ⌘X / ⌘V |
| Delete | Backspace / Delete | ⌫ |
| Select all (u) | Ctrl+A | ⌘A |
| Return to edit page (u) | Ctrl+Alt+Q | ⌘⌥Q |

### Playback and navigation

| Action | Windows | Mac |
|---|---|---|
| Play / Pause | Space | Space |
| Shuttle reverse / stop / forward | J / K / L | J / K / L |
| Previous / next frame | ← / → | ← / → |
| Jump back / forward N frames (default 10) | Shift+← / Shift+→ | ⇧← / ⇧→ |
| Previous / next edit point | ↑ / ↓ | ↑ / ↓ |
| Go to start / end | Home / End | Home / End (laptop: Fn+← / Fn+→) |
| Full-screen preview | Ctrl+Shift+F (old builds: Ctrl+F) | ⌃⌘F |
| Exit full screen | Esc | Esc |
| Fit preview to window | Alt+Shift+Z | ⌥⇧Z |
| Ignore player alignment guides while dragging | hold Ctrl | hold ⌘ |
| Play from in point (u) | Shift+Enter | ⇧↩ |

### Timeline editing

| Action | Windows | Mac |
|---|---|---|
| Selection tool | A | A |
| Split (blade) tool | B | B |
| Select all clips to the left / right of the cursor | [ / ] | [ / ] |
| Split at playhead | Ctrl+B | ⌘B |
| Split all tracks at playhead | Ctrl+Shift+B | ⇧⌘B |
| Delete left / delete right (ripple trim to playhead) | Q / W | Q / W |
| Activate / deactivate clip | V | V |
| Extract / restore audio | Ctrl+Shift+S | ⇧⌘S |
| Group / Ungroup | Ctrl+G / Ctrl+Shift+G | ⌘G / ⇧⌘G |
| Create / undo compound clip | Alt+G / Alt+Shift+G | ⌥G / ⌥⇧G |
| Show speed panel | Ctrl+R | ⌘R |
| Curve speed | Shift+B | ⇧B |
| Volume +0.1 dB / −0.1 dB | Ctrl+. / Ctrl+, | ⌘. / ⌘, |
| Show / hide keyframe panel | Alt+K | ⌥K |
| Add keyframe in keyframe panel | Shift+Click | ⇧Click |
| Duplicate by dragging | Alt+drag | ⌥drag |
| Add video track (u) | Ctrl+Alt+T | ⌘⌥T |
| Manual beat / match cut (u, conflicting) | Ctrl+J | ⌘J |

### Toggles, markers, ranges, zoom

| Action | Windows | Mac |
|---|---|---|
| Main track magnet | P | P |
| Auto snapping | N | N |
| Linkage | ` (backtick / tilde key) | ` |
| Preview axis | S | S |
| Add marker / add marker in new color | M / Alt+M | M / ⌥M |
| Next / previous marker | Shift+M / Alt+Shift+M | ⇧M / ⌥⇧M |
| Mark in / mark out | I / O | I / O |
| Set range to selected clip / clear range | Shift+X / Alt+X | ⇧X / ⌥X |
| Zoom in / out | Ctrl+= / Ctrl+− | ⌘= / ⌘− |
| Zoom with mouse | Ctrl+wheel | ⌘+wheel / pinch |
| Zoom to fit timeline | Shift+Z | ⇧Z |
| Scroll timeline vertically / horizontally | wheel / Alt+wheel | wheel / ⌥+wheel (trackpad two-finger) |
| Cycle material panel focus | Tab | Tab |

### Text and captions

| Action | Windows | Mac |
|---|---|---|
| Split caption at cursor | Enter | ↩ |
| New line within caption | Ctrl+Enter | ⌘↩ |
| Resize text box from center | Alt+drag | ⌥drag |

Avoid skillademia.com and meowtool.com shortcut lists. They contradict the in-app list (e.g., Ctrl+T for text, M as mute).

---

## 8. Visual style

### 8.1 Dark UI palette (2025 build, pixel-sampled from official screenshots)

| Token (suggested) | Hex | Used for |
|---|---|---|
| `--bg-app` | `#141414` | Window chrome, title bar, ~6 px gutters between panels |
| `--bg-inset` | `#1C1C1C` | Search fields, numeric steppers, text areas, segmented-control track |
| `--bg-panel` | `#262626` | Panel bodies (media, player surround, inspector, timeline body, modal body) |
| `--bg-track-header` | `#2A2A2A` | Track header column (some builds same as panel) |
| `--bg-lane` | `#2F2F2F` | Empty track lanes, area after last main clip |
| `--bg-header` | `#303030` | Panel header strips and tab rows (~32-34 px) |
| `--bg-control` | `#3B3B3B` | Buttons, dropdowns, cards, list rows, sub-nav pills, selected segment |
| `--bg-control-hover` | `#4F4F4F` | Hover/pressed chips, secondary button (Cancel / Apply to all ≈ `#4C4C4C`), toggle-off track |
| `--slider-track` | `#363636`-`#444444` | Slider rail; thumb `#FFFFFF` |
| `--accent` | `#00C1CD` | Export / Generate / Save-as-preset buttons, toggle-on, checkboxes, active tab icon+label, active timeline toggles, current timecode, autosave check |
| `--accent-text` | `#00D1DE` | Accent used as text (active tab label) |
| `--accent-muted` | `#169890` | Toggle icons in the timeline toolbar when on (rendered smaller/dimmer) |
| `--pro` | `#8F77FE` → `#9174E5` | Pro gem (violet, not gold); "Try free"/"Free" pill ≈ `#836AD7` |
| `--ai-badge` | `#13BFEB` | "AI" corner badge on home tiles |
| `--text-primary` | ≈ `#FFFFFF` / `#E8E8E8` | Labels, values |
| `--text-secondary` | ≈ `#B5B5B5` | Tab captions, card labels, secondary info |
| `--text-disabled` | ≈ `#6E6E6E` | Disabled controls, greyed toolbar icons |
| `--playhead` | `#FFFFFF` | 1 px line plus outlined pin cap |
| `--preview-axis` | yellow (≈ `#F5C543`, estimated) | Hover-scrub line |
| `--snap-guide` | cyan (≈ accent) | Snap indicator line |
| `--scrim` | `rgba(0,0,0,0.6)` | Modal overlay (panel `#262626` becomes ≈ `#0F0F0F`) |
| Home background | `#0C0C0C`-`#0E1415` | Home window, slight teal tint; sidebar `#0D0D0D` |
| Home hero gradient | `#4BCFE1 → #1AB2CF` | "Create project" banner; feature tiles `#1E546B → #2888B1` |
| Join Pro gradient | `#A0E0FC → #C084FC` | Cyan → violet pill |

**Earlier palette (2023-24 build), for reference:**

| Role | Hex |
|---|---|
| Chrome | `#060608`-`#070709` |
| Gutters | `#000000` |
| Panel header | `#2A282E` (slight violet tint) |
| Panel body | `#1A1A1A` / `#242426` |
| Buttons | `#323234` |
| Accent | `#00BEC6` / `#01A1AC` |
| Drop zone | `#1E1E1E` |

The 2025 refresh moved to the neutral 5-step grey ramp above and a brighter cyan.

### 8.2 Timeline clip colors (sampled)

| Clip | Body | Detail |
|---|---|---|
| Video / image | `#004D52` (label band ≈ `#004E4F`, waveform band ≈ `#005D63`) | Selected: white 2 px border; label band ≈ `#85AFB1` |
| Duration chip | `#1A5F64` | |
| Audio (music / extracted) | `#0D3058` - `#0E3058` | Waveform `#104972` - `#0E6998`; tag pills `#274569` |
| Voiceover | `#003A4C` | Waveform `#275867` / `#577D89` |
| Text / captions | `#9C4937` | Variant `#A75E4D` |
| Sticker | `#D5942B` | |
| Effect | `#826190` | |
| Filter | indigo (≈ `#4B4FA8`, estimated) | |
| Adjustment | gold/olive (≈ `#8A7A2E`, estimated from 2023 build) | |

### 8.3 Typography and iconography

- **Font:** neutral grotesque. It looks like the platform UI font (Segoe UI on Windows, SF/PingFang on macOS); the exact face is unverified.
  - Suggestion for us: Inter or the system stack, `font-feature-settings: "tnum"` for timecodes.
- **Sizes (estimated from 1280 px captures, probably downscaled from 1920):**
  - Tab captions under icons: ~11 px.
  - Labels and values: ~12 px.
  - Inspector tabs: ~13 px.
  - Panel titles ("Player", "Details"): ~13-14 px medium.
  - Home section titles: ~14-16 px semibold.
  - Hero text: ~16-18 px semibold.
- **Timecodes:** monospaced digits; current time in cyan, total in grey.
- **Icons:** thin (~1.5 px) monochrome line icons, ~16-18 px, grey `#B5B5B5`; active state cyan. Filled glyphs only for play/pause and the diamond when keyed.
- **Corner radii:** panels ~8 px, buttons/inputs ~4-6 px, cards ~4 px, clips ~3-4 px, pills fully rounded.
- **Density:** compact. Inspector rows ~30-32 px; section gaps ~16 px; 1 px dividers `#333`.

### 8.4 Metrics (estimated)

| Element | Size |
|---|---|
| Title bar | ~32-36 px |
| Panel header / tab row | ~32-34 px (media tab row with icon+label ~44 px) |
| Timeline toolbar | ~28-32 px |
| Video clip lane | ~64 px total: label ~14, filmstrip ~34, waveform ~14 |
| Audio lane | ~40 px |
| Text / sticker / effect lane | ~18-24 px |
| Media sub-nav column | ~80 px wide |
| Asset thumbnails | ~60-76 px |
| Inspector minimum width | ~270-300 px |

### 8.5 Interaction feel: what makes it polished

**Instant feedback everywhere:**
- Applying an asset shows it in the player immediately.
- Slider drags update the player in real time.
- Inspector edits are live, with no "Apply" button except for heavy AI.

**Always-saved:**
- Autosave on every change, with a timestamp in the title bar. No save dialog exists.
- Projects reopen exactly where you left them.

**Hover affordances:**
- Media cards hover-scrub. Effect, transition, and animation cards play loops.
- Toolbar tooltips show "Name (Shortcut)".
- Timeline edges show a trim cursor.
- Preview axis gives hover-scrub on the timeline.

**Motion (estimated; no spec found):**
- Very little decorative animation.
- Toggles slide their knob in ~150 ms. Sections collapse and expand with a short height ease (~150-200 ms).
- Main-track reorder animates neighbors sliding (~120-200 ms ease-out).
- Zoom is smooth and anchored at the cursor or playhead.
- Modals fade and scale in quickly (~150 ms).
- Panels and tab switches are instant (no slide).

**Fast thumbnails and waveforms:**
- Filmstrips and waveforms appear progressively within a second of import.
- Downloads of cloud assets show inline spinners on the card, not modal dialogs.

**Contextual UI:**
- The inspector and toolbar AI tools change with the selection.
- Irrelevant tools are hidden or greyed rather than throwing errors.

**Consistency:**
- Every animatable row has the same `↺ ‹◇›` cluster.
- Every section uses the same checkbox-header pattern.
- Every panel uses the same header strip.
- One accent color means "on/primary".

**Low-friction defaults:**
- The first clip defines project settings.
- The magnet prevents black gaps.
- Q/W top-and-tail trims.
- Sensible export preset (1080p / Recommended / H.264 / mp4 / project fps).
- Live size estimate.

**Toasts:** small dark pills, top-center of the player or window, for "Downloading...", "Reversing 45%", "Added to timeline" (pattern observed; text unverified).

---

## 9. Pain points (opportunities for Video Editor)

### 9.1 Monetization and trust (top complaint, 2025-2026)

- **Free tier eroded:** auto captions, 4K/HDR export, many effects/fonts/templates, stabilize, normalize, noise reduction, and voice tools moved behind Pro or credits during 2025.
  - Limits change **server-side without app updates**, and differ by region and version.
  - One reviewer (Mar 2026) still exported 4K free. Others report 1080p caps and watermarks.
- **Price shock:** Pro annual went from ~$77.99 to **$179.99** in Feb 2026 without notice or grandfathering (Newsweek, Feb 17 2026). Users threatened to move to Final Cut, Edits, or Resolve.
- **Pro items surface only at export:**
  - You build an edit using gem-marked assets, then the export dialog says "Pro benefits: N items" and blocks export or forces a watermark.
  - Reviewers: "You are told to upgrade rather than told what you have."
- **Credits:**
  - Separate AI credit balance, desktop and web only.
  - Subscription credits expire monthly.
  - Failed or poor generations still consume credits (Trustpilot Oct 2026).
- **Billing and support:** Trustpilot **1.2/5 (1,340 reviews, 88% one-star)**.
  - Charges after cancellation or trial; trial requires a card.
  - Refunds refused; human support unreachable.
- **Tier confusion:** Free / Standard / Pro / Ultra / Teams. Badges disagree between panels; AI tools are scattered across home, panels, inspector, and toolbar.
- **Cloud storage:** free cloud storage removed (Aug 2024); cloud suspended when a subscription lapses.

### 9.2 Pricing snapshot (Oct 2026; regional variance is large)

| Tier | Price (US, official page unless noted) | AI credits / mo | Cloud | Notes |
|---|---|---|---|---|
| Free | $0 | small; occasional free daily gen credits | none | Pro assets watermark/block; 4K/HDR gated |
| Standard | ~$9.99/mo (third-party); $4.99 (PCMag, likely regional) | ~600 (third-party) | ~100 GB | 1080p, no watermark. Blue-diamond items |
| **Pro** | **$19.99/mo, $179.99/yr** | **1,200** (was 550 before Apr 2026) | 1 TB | 4K/HDR, full AI tools, 5 devices |
| Ultra (Jun 2026) | $79/mo (official); $53 (PCMag) | 8,645 | 1 TB | Cheaper per-second generation |
| Teams | $12.49/seat/mo (official) vs ~$24.99 (third-party) | 1,200 / seat | 1 TB | Brand kit, shared Spaces |

- **Legacy:** Pro was ~$7.99/mo or $74.99-89.99/yr until 2025; that plan became "Standard".
- **Regional examples:** UK £21.99/mo; India and Turkey ~$5-8.

### 9.3 Terms, privacy, availability

- **ToS (June 12 2025 update):**
  - Widely read as a perpetual, worldwide, irrevocable, sublicensable, royalty-free license to uploaded content, including face and voice.
  - CapCut says the clause is old and only for service operation, but did not address AI training.
  - The license covers content **uploaded to CapCut servers**, and most AI features require upload. Corporate users avoid it for confidential footage.
- **Availability:** offline in the US from **Jan 18 to Jan 20-21, 2025** alongside TikTok; restored to app stores Feb 13 2025. This exposes account- and region-gated risk.
- **Account and cloud dependence:** many features need sign-in and internet, including auto captions, AI tools, and asset downloads.
- **Legal:** biometric privacy class action (2023; partly continuing).

### 9.4 Performance and stability

- Preview lag on long projects (>15 min) and stacked AI effects, especially on integrated GPUs.
- Crashes and freezes on 20-30 min timelines.
- Heavy HEVC decode; cache bloat (many GB).
- **Proxy is off by default.**
- Recent Trustpilot reports (Sep-Oct 2026):
  - "Exporting freezes almost every time."
  - Fonts disappearing.
  - Projects "blocked by critical errors".
  - Exports truncated.
  - Audio stuck muted.
  - A removed Pro effect still detected at export.
- Cloud sync of projects with 50+ media items takes minutes.

### 9.5 Missing pro features (reviewer consensus 2026)

- **Scopes:** no waveform, vectorscope, parade, or histogram, even though wheels, curves, HSL, and LUTs exist.
- **Audio:** per-clip audio only. No mixer or buses, no track-level effects, no EQ or compressor, no plugins (VST/AU/CLAP), no keyframe lanes per track.
- **Interchange:** no XML / FCPXML / EDL / AAF / OTIO export. Only SRT/TXT captions in and out.
- **Codecs:**
  - Export: H.264/HEVC in mp4/mov only. No ProRes, DNxHR, or AV1 export.
  - Limited 10-bit / HDR workflow (Pro only).
- **Nesting:** compound clips exist but are not true editable nested sequences. No multiple timelines per project.
- **Multicam:** basic and recent; reviewers still call it missing or weak.
- **Keyframe graph editing:** basic easing presets only. No full per-property curve editor with tangents across clips.
- **Media management:** no tagging, metadata columns, smart bins, or relink-at-scale (only per-clip "Link to media").
- **Platform and extensibility:** no plugin ecosystem or scripting API. No Linux.
- **Usability at scale:** cramped UI for many tracks; no track height control; no track targeting or patching like NLEs.

### 9.6 Lock-in

- Drafts sit in an app-private folder.
- `draft_content.json` is increasingly encrypted or obfuscated, so third-party tools break on new versions.
- Templates and assets are cloud-bound and licensed per plan.
- Cloud "Spaces" sync is paid.

### 9.7 Openings for Video Editor

1. **No paywall surprises.** Mark every non-free item at the moment it is applied, or simply make the core editor fully free. Never block an export after the fact.
2. **Local-first AI.** Run captions (Whisper), TTS, noise reduction, background removal, and stems on-device. No uploads, no ToS exposure, works offline.
3. **Open project format** (plain documented JSON) plus **OTIO / FCPXML / EDL export** and SRT/VTT/ASS import/export.
4. **Long-timeline stability:** proxies by default for heavy codecs, GPU decode, bounded cache with a visible size.
5. **Pro gaps:** scopes, audio mixer with buses, EQ and compressor, extended blend modes, a real curve editor, true nested sequences.
6. **Cross-platform including Linux** (Tauri), plus a web build.
7. **Transparent metering** if any cloud AI is used (BYO API keys; no charge for failed generations).

---

## 10. Build checklist for Video Editor

Prioritized. P0 = required for a credible CapCut-class v1. P1 = expected soon after, or a key differentiator. P2 = later or optional.

### P0: must-have

**Shell and project**
- [ ] Home screen: Create project hero, projects grid/list (thumbnail, name, duration, size), search, Trash, open/rename/duplicate/delete.
- [ ] Autosave on every change with "Auto saved HH:MM:SS"; crash-safe journal; unlimited transactional undo/redo.
- [ ] Open, documented JSON project format: microsecond timebase, tracks → segments → materials, per-segment keyframes.
- [ ] Project settings: aspect presets (Original, 16:9, 9:16, 1:1, 4:3, 3:4, 21:9, 2.35:1, Custom), resolution, fps (23.976-60), SDR Rec.709; first clip auto-defines settings.
- [ ] Global settings: draft and cache locations, clear cache, hardware decode/encode toggles, default image duration, step-frames value, language.

**Editor layout**
- [ ] Four resizable panels (media / player / inspector / timeline) with the dark token palette (§8.1) and a single cyan accent.
- [ ] Top bar: menu, autosave indicator, editable project name, Shortcuts, Export.

**Media and assets**
- [ ] Import via button, drag from OS, or Ctrl+I.
- [ ] Media bin: grid/list, sort, search, duration badge, "Added" badge, hover-scrub, `+` add at playhead, folders.
- [ ] Background thumbnail, filmstrip, and waveform generation; hardware decoding; automatic proxies for heavy codecs (HEVC 4K+, high bitrate).
- [ ] Built-in starter libraries:
  - [ ] ~20 transitions
  - [ ] ~30 LUT-based filters
  - [ ] ~20 clip in/out animations
  - [ ] ~20 text in/out/loop animations
  - [ ] a small sticker set
  - [ ] SFX/music import (no licensed catalog needed for v1)

**Timeline**
- [ ] Main track plus auto-created overlay, audio, text, sticker, effect, filter, and adjustment tracks; z-order by stacking.
- [ ] **Main track magnet** (ripple on main only), **Auto snapping** (with cyan guide), **Linkage**, **Preview axis** (hover-scrub), each with toolbar toggles and the P / N / ` / S keys.
- [ ] Tools and operations:
  - [ ] Select / Blade tools
  - [ ] Split (Ctrl+B) and split all (Ctrl+Shift+B)
  - [ ] Delete left/right (Q/W)
  - [ ] Ripple delete
  - [ ] Trim edges
  - [ ] Drag to reorder or move across tracks
  - [ ] Alt-drag duplicate
  - [ ] Copy/paste
  - [ ] Multi-select and marquee
  - [ ] Select left/right ([ / ])
- [ ] Track headers: lock, hide, mute; Cover button on the main track.
- [ ] Clip rendering: filmstrip thumbnails, waveforms, name and duration label, white selection border, per-type colors (§8.2), keyframe diamonds, speed badge.
- [ ] Ruler and playhead, zoom (Ctrl+wheel, slider, Shift+Z fit), horizontal and vertical scroll, markers (M), in/out range (I/O, Shift+X, Alt+X).
- [ ] Freeze frame, reverse, mirror, rotate 90°, crop (free and ratio presets).
- [ ] Extract audio (Ctrl+Shift+S), deactivate clip (V), group/ungroup.

**Player**
- [ ] Real-time GPU compositor preview with frame-accurate seek.
- [ ] Timecode HH:MM:SS:FF; play/pause; J/K/L; frame step; edit-point jumps.
- [ ] Preview quality (Full / 1/2 / 1/4), Ratio button, fullscreen.
- [ ] On-canvas transform: move, scale, rotate handles, alignment guides (hold Ctrl to bypass).

**Inspector**
- [ ] Three-level navigation (tabs, segmented control, pills); checkbox section headers; slider + numeric field + stepper; `↺ ‹◇›` on every animatable row.
- [ ] Video Basic:
  - [ ] Scale (uniform toggle), Position X/Y, Rotate (+ dial), align buttons
  - [ ] Blend: 11 modes + opacity
  - [ ] Canvas background (blur 4 levels / color / image)
- [ ] Keyframes: add/remove/navigate, auto-key after first key, linear + ease in/out/in-out, drag on clip to retime.
- [ ] Speed (Standard): 0.1-100x, duration field, preserve-pitch toggle.
- [ ] Animation: In / Out / Combo with duration, enforcing the In+Out ≤ clip constraint.
- [ ] Adjust Basic: temperature, tint, saturation, exposure, contrast, highlights, shadows, whites, blacks, sharpen, vignette, fade, grain; LUT import (.cube) with intensity; Save as preset / Apply to all; adjustment-layer clips.
- [ ] Filters (intensity 0-100), effects (parameter sliders), transitions (duration, Apply to all).
- [ ] Audio: volume dB (−∞..+20) keyframable, fade in/out, mute, normalize loudness (−23 or −14 LUFS selectable), voiceover recording.

**Text and captions**
- [ ] Add text; inline canvas editing.
- [ ] Font (system + imported), size, B/I/U, case, color, opacity, letter and line spacing, alignment.
- [ ] Stroke, background box (radius, padding, opacity), shadow; style presets; Save as preset.
- [ ] **Auto captions, local (Whisper):** language, generate onto a caption track.
- [ ] Caption list editor (edit, split, merge, seek); Apply-to-all styling.
- [ ] SRT import/export.

**Export**
- [ ] Dialog fields:
  - [ ] Name, location
  - [ ] Resolution 480p-4K
  - [ ] Bitrate Lower/Recommended/Higher/Custom
  - [ ] H.264 / HEVC (hardware where available)
  - [ ] mp4/mov
  - [ ] 24/25/30/50/60 fps
  - [ ] Audio-only (MP3/WAV/AAC)
  - [ ] Live size estimate
- [ ] Progress with cancel; open folder on completion.
- [ ] Export range; export still frame.
- [ ] **No watermark, no export-time paywall.**

**Shortcuts**
- [ ] CapCut-compatible default keymap (§7) with Mac mapping, plus an in-app Shortcuts panel.

### P1: next (expected, or a differentiator)

- [ ] Masks (linear, mirror, circle, rectangle, heart, star, pen) with feather, round corners, invert, on-canvas handles, keyframes; adjust-mask.
- [ ] Chroma key (strength, shadow, edge feather, spill); **local AI background removal** (e.g., RVM / BiRefNet / MODNet class models); custom brush refine.
- [ ] Speed curves: presets (Montage, Hero, Bullet, Jump cut, Flash in/out) plus bezier editor 0.1-10x; frame blending; optical-flow interpolation.
- [ ] Color: HSL (8 swatches), curves (Luma/R/G/B), color wheels (Lift/Gamma/Gain/Offset), auto adjust, color match.
- [ ] **Scopes** (waveform, vectorscope, RGB parade, histogram): CapCut has none.
- [ ] Keyframe panel (Alt+K): per-property lanes, easing presets, bezier handles, copy/paste keyframes.
- [ ] Compound clips as **true editable nested sequences**; Subprojects bin; copy/paste attributes with checklist; replace clip; relink media.
- [ ] Text: templates, word-art presets, bubbles, glow, curved text, text animations library; caption templates with **word-by-word highlight (karaoke)** and keyword highlight; filler-word detection.
- [ ] **Transcript-based editing:** delete words to cut; remove fillers and pauses with a threshold; search.
- [ ] Local TTS (Piper / Kokoro-class voices) with "update speech when text changes".
- [ ] Audio: noise reduction (DeepFilterNet/RNNoise-class), enhance voice, vocal isolation/stems (Demucs-class), fill channel, auto-ducking, beat detection with beat markers.
- [ ] **Audio mixer:** track volume/pan, buses, EQ, compressor, limiter, meters. CapCut has none.
- [ ] Stabilization; motion tracking for text/stickers; split scene (shot detection).
- [ ] Export: GIF, SRT/VTT/TXT captions, HDR10/HLG 10-bit HEVC, AV1 (hardware), ProRes/DNxHR (via FFmpeg), export queue.
- [ ] **Interchange:** OTIO and FCPXML/EDL export; open project spec.
- [ ] Layout presets (Default, Media first, Player first, Timeline first, Transcript) plus Reset layout.
- [ ] Free layer / arbitrary z-order (reversible, unlike CapCut).
- [ ] Cover/thumbnail designer.
- [ ] Customizable shortcuts with Premiere/FCP presets and conflict detection.
- [ ] Extended blend modes (Add, Difference, Exclusion, Hue, Color, Luminosity).
- [ ] Track height control, track targeting, solo.
- [ ] Linux build; web build (WebCodecs/WebGPU) with shared core.

### P2: later or optional

- [ ] Multicam (sync by audio/timecode/marker; angle grid; live switching).
- [ ] Auto reframe (subject-aware crop for 9:16 / 1:1), batch.
- [ ] Retouch (face smoothing/reshaping, makeup), body effects, AI relight.
- [ ] Enhance quality / upscale (Real-ESRGAN-class), video denoise, deflicker.
- [ ] Voice changer (filters and characters), speech-to-song, voice clone (local where feasible).
- [ ] Lyrics recognition, AI emojis, AI caption packaging.
- [ ] Long video to shorts (highlight detection plus vertical reframe plus captions).
- [ ] Generative AI (text/image-to-video, image gen, AI stylize, AI expand) via **BYO API keys** with transparent cost estimates and no charge on failure.
- [ ] Script-to-video, AI avatars, video translation with lip sync.
- [ ] Prompt-driven "auto cut / edit agent" (EditPilot-style first pass).
- [ ] Templates system with replaceable slots; template/preset sharing.
- [ ] Cloud sync / team spaces / brand kit (optional, never required).
- [ ] Plugin API (OFX/CLAP/VST3 or a JS/WASM effect SDK) and scripting.
- [ ] Semantic media search ("scenes, or dialogs") over local media.

---

## Sources

**CapCut official (help, resource, and tools pages; screenshots)**
- https://www.capcut.com/resource/how-to-add-keyframes-in-capcut (2025 editor screenshots used for layout and palette sampling)
- https://www.capcut.com/resource/how-to-add-subtitle-in-capcut
- https://www.capcut.com/resource/capcut-pro-pc
- https://www.capcut.com/tools/desktop-video-editor
- https://www.capcut.com/resource/pc-professional-video-editor
- https://www.capcut.com/help/capcut-ui-update-changes
- https://www.capcut.com/help/keyframes-in-capcut-pc
- https://www.capcut.com/help/export-videos-in-capcut
- https://www.capcut.com/help/export-clip-of-video
- https://www.capcut.com/help/captions-fail-to-export
- https://www.capcut.com/help/how-to-import-subtitles
- https://www.capcut.com/help/auto-captions-in-capcut
- https://www.capcut.com/help/chroma-key-feature
- https://www.capcut.com/help/standard-version-access-to-diamond-items
- https://www.capcut.com/help/how-to-use-auto-cut
- https://www.capcut.com/resource/capcut-color-grading
- https://www.capcut.com/resource/capcut-stabilizer
- https://www.capcut.com/tools/optical-flow
- https://www.capcut.com/resource/optical-flow-in-capcut
- https://www.capcut.com/tools/remove-video-flicker
- https://www.capcut.com/tools/speed-ramp
- https://www.capcut.com/tools/text-to-speech
- https://www.capcut.com/tools/video-translator
- https://www.capcut.com/resource/multicam-editing
- https://www.capcut.com/resource/edit-talking-head-videos-faster-editpilot-capcut-pc
- https://www.capcut.com/resource/about-capcut-terms-of-service
- https://www.capcut.com/pricing

**Tutorials, guides, screenshots**
- https://www.emotionvideo.com.au/wp-content/uploads/2025/05/The-2025-CapCut-Desktop-Guide-by-eMotion-Video-and-Media-Training.pdf
- https://grace.unitn.it/wp-content/uploads/2024/11/Anastasia-Ellis-How-to_CapCut-compressed.pdf
- https://primalvideo.com/guides/capcut-for-pc-mac-tutorial/
- https://filmora.wondershare.com/advanced-video-editing/capcut-timeline.html
- https://filmora.wondershare.com/video-editing/compound-clip-capcut.html
- https://www.tourboxtech.com/en/news/what-is-free-layer-in-capcut.html
- https://tourboxtech.com/en/news/capcut-what-is-a-compound-clip.html
- https://www.sparklestock.com/docs/import-luts-in-capcut-desktop/
- https://riverside.com/blog/how-to-add-captions-in-capcut
- https://store.hollyland.com/blogs/creator-hub/best-export-settings-from-capcut-desktop-for-youtube-shorts
- https://www.hollyland.com/blog/topics/capcut-hdr-video-how-to-export-and-create-an-hdr-look
- https://www.toutiao.com/zixun/7501372204051859508/ (JianYing toggle definitions)

**Shortcuts**
- https://litcommerce.com/wp-content/uploads/2026/03/CapCut-ToolCheat-Sheet.pdf
- https://tutorialtactic.com/blog/capcut-shortcuts/
- https://fastshortcuts.com/shortcuts/capcut/

**Reviews, news, pricing, pain points**
- https://newsweek.com/app-used-millions-nearly-doubles-subscription-price-overnight-11535999
- https://en.wikipedia.org/wiki/CapCut
- https://larryjordan.com/articles/caution-capcut-changed-their-license-and-may-own-your-content/
- https://www.trustpilot.com/review/capcut.com
- https://atomisystems.com/screencasting/capcut-pc-review-2026-is-free-video-editing-really-worth-your-time/
- https://www.zebracat.ai/post/i-tried-capcut
- https://descript.com/blog/article/capcut-captions-arent-free-anymore-heres-a-better-option
- https://pixflow.net/blog/?p=94259 (2026 update timeline)
- https://pixflow.net/blog/capcut-pro-price/
- https://www.hooked.so/compare/capcut-pricing
- https://filmora.wondershare.de/answers/capcut-keep-crashing-long-videos.html

**Versions**
- https://www.filehorse.com/download-capcut/old-versions/
- https://capcut.en.uptodown.com/windows/versions

**Draft format (reverse-engineered)**
- https://github.com/GuanYixuan/pyJianYingDraft
- https://cdn.jsdelivr.net/npm/capcut-cli-david@2.5.0/docs/draft-schema/README.md
- https://cdn.jsdelivr.net/npm/capcut-cli-david@2.5.0/docs/draft-schema/01-tracks-and-segments.md
- https://cdn.jsdelivr.net/npm/capcut-cli-david@2.5.0/docs/draft-schema/03-keyframes-and-animations.md
- https://github.com/sun-guannan/CapCutAPI
