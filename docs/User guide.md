# OpenFrame user guide

OpenFrame is a desktop-first video editor in active development (named
"Video Editor" until 2026-10-17).

## Get the editor

The source is public at github.com/gAlexander77/openframe; there is no
packaged release yet. Follow the root README's source setup and run
`npm run tauri dev` in the `openframe-application` folder. Node.js/npm, Rust, and the platform's Tauri prerequisites
are required. Install FFmpeg and ffprobe on `PATH` for the desktop's broader
media-format support. `OPENFRAME_FFMPEG` points the app at another FFmpeg
(the older `VIDEO_EDITOR_FFMPEG` still works).

Use `npm run dev` to try the secondary browser build at
`http://localhost:1420`. Browser support and codecs vary by device; desktop
is the development priority. Read [[Features]] for the current feature map
and [[Roadmap]] for what is still planned.

## Make your first edit

On desktop, drag any noninteractive part of the top header to move the
window, including the logo, save status and spaces between controls.
Double-click the same areas to maximize the window; double-click again to
restore its previous size. Menus, project renaming and buttons keep their
normal actions. The maximize button changes to a Restore button while the
window is maximized. Clicking a window control keeps your typing focus, so
resizing does not submit an unfinished project rename.

1. On the home screen, create a project and choose a canvas preset if you
   know the destination format. Otherwise, the first clip can establish the
   canvas size and frame rate on an empty timeline.
2. Import your own video, audio, or images with the media picker or by
   dropping files into the app. Dropping onto the timeline also places them.
3. Arrange clips on the timeline. Drag to move them, drag an edge to trim,
   and use the toolbar or context menu to split. The magnet keeps the main
   track gapless; snapping helps align edits, and linkage makes overlays
   follow their shots through ripples.
4. Select a clip to adjust its visual or audio properties in the inspector.
   Add text or captions as needed. Double-click a title or caption in the
   viewer to edit its text on the canvas. Undo is available for edits.
5. Play the timeline and review the picture and sound, then open Export.
   Choose from the formats and codecs the current platform can encode.
   Select the output destination when offered, or use Download when the
   browser's export workflow provides it. Play the exported file to check it.

In the inspector, one drag of a slider (or holding an arrow key on it) is
one Undo step, and so is dragging in a color picker. A typed value applies
when you press Enter or leave the field, including by clicking another
clip; Escape puts the old value back. An empty or non-numeric entry
changes nothing, and a decimal comma works ("1,5" is 1.5). Sections stay
open or closed as you left them, across clips and reloads.

In a clip's **Animation** tab, each preset tile pictures its motion: the
layer where it settles and a dashed outline where it starts (In), ends
(Out) or swings to (loops); hover a tile to see it move. Picking one plays
that part of the clip once in the viewer, silently, and stops.

A title template (Text tab) lands on rows of its own above your footage,
never on a B-roll row, and its layers are grouped: they select and move
together. Alt+click one layer to edit it alone.

Export presets name where the video goes. **TikTok, Reels and Shorts** is
made for a 9:16 canvas; on another shape the dialog says what size will be
exported (a 16:9 project stays 1920×1080) and offers **Make the canvas
9:16**. The canvas changes only when you click it, and Undo restores it.
When a mix is normalized to its loudness target, the finished export says
so in green; an amber note means something did not go as asked.

For the sound alone, turn **Video** off and choose MP3, AAC (M4A) or WAV,
or pick the **Audio only (MP3)** preset. When the project has captions,
the **Captions** row decides what becomes of them: burned into the
picture (as you see them), an **SRT file beside it** for YouTube and other
sites that take one (the picture stays clean), both, or none. The SRT
matches the exported range. The desktop app saves it next to the video
with the same name; the browser version downloads it.

Under the player, the outer buttons jump to the start and the end of the
timeline, and the inner ones step a frame. Drag the playhead along the
ruler to hear short snippets of the sound under it, to find a word or a
beat by ear; turn this off in **Preferences** under Playback. The gear at the top right opens
**Preferences** (also on Home); the keyboard beside it lists the shortcuts.
The app's shortcut panel is the source for the current keyboard bindings.
[[Features]] explains the deeper trim, color, keyframe, and audio tools.

**File → New project** saves the current project and creates a new one.
A new project is kept once you do something in it: create a project and
go back to Home straight away, and no empty project is left behind.
**File → Open project** saves the current project, returns to Home and
focuses Search projects; select a saved project card to reopen it. Open also
focuses search when you are already on Home. The project shortcuts shown in
the shortcut panel use these same actions. Home ignores editing/playback
shortcuts so they cannot change a closed project.

If saving fails, New, Open and Back to home keep the current project open
with its edits. Resolve the storage problem and retry; a failed save does
not show a successful-save notification.

Edits made while a save is running are saved before navigation completes.
While a project is opening or the old one is being saved for a switch,
repeated navigation requests are ignored. Home shows **Opening project…**
and disables creation/deletion during loading; retry after it finishes.
A focused project card opens with Enter or Space; its Delete button never
opens it.

Deleting a project moves it to **Recently deleted** at the bottom of Home,
and the notice that says so has **Undo**. A deleted project waits there
for 30 days: open the section to **Restore** it (it returns to its place)
or **Delete forever** (click twice; this cannot be undone). After 30 days
it is deleted for good. Your media files are never deleted.

Closing or switching projects cancels unfinished captions/analysis and
discards late import results. Reopening the same project starts a new session;
restart unfinished work there. A movie export already in progress may finish
from its original project snapshot.

Choose **File → Save a copy…**, give the version a name, and choose whether
to open it after saving. The original saves first and remains independent:
later edits to either version do not change the other. Both reference the
same footage, so keep those media files available. A project copy is not a
backup of the footage. Save errors keep the dialog open for retry.

## Find and reuse imported media

In **Media**, combine Search media with **All types** and **All usage** to
find video, audio, images, used files or unused files. **Clear filters**
shows all imports again. **Audio** uses the same browsing controls but only
shows audio files. Stickers remain in their separate tab.

Choose **Import order**, a name sort, or shortest/longest source duration.
Name sorting puts numbered shots in natural order (Shot2 before Shot10).
Images have no fixed source duration, so they sort after timed media in
both duration directions. Sorting never rearranges timeline clips.

Switch to **List view** beside the file count to see duration, dimensions,
frame rate and file size when available. Click a **timeline uses** count
to select every referencing clip and seek the earliest one. Counts include
disabled clips and references on hidden, muted or locked tracks; **Unused**
means no timeline reference. It does not remove any source files.

To rename a file in the project, right-click its card and choose
**Rename…**, or in the grid view double-click its name; Enter keeps the new
name and Escape the old one. The file on disk keeps its own name, and clips you have not
renamed show the new one.

Drag a row, double-click it, or use its Add button to place media, just as
with the grid. Search/filter/view choices survive tab changes. Opening or
creating a project clears search/type/usage filters; view and sort last for
the app session. Browsing and selecting uses do not consume Undo steps.

## Select and arrange clips

Click a picture in the viewer to select the top unlocked clip whose box
contains the pointer. Clicking empty canvas or stage space clears selection.
Hidden and locked tracks do not intercept the click.

With the main track magnet on, drag a clip to the start to make it the first
shot. Linkage carries short titles and sound effects with their shots;
a music bed covering two or more complete shots stays at its timeline time.

Adding a title or sticker briefly previews its In animation, then restores
the playhead. Reduced motion skips that preview. Pausing a preview stops it
without a later jump back.

Right-click a clip for the everyday edits in one place: Ripple delete,
Split, **Speed…** (opens the Speed tab), **Reverse** (shows a check while
the clip plays backward), **Copy effects** and **Paste effects** (onto
every selected clip), Rename, Ungroup and Duplicate, among others.

Name a clip with right-click > **Rename…**, or double-click the name on
its strip (a title's double-click edits its words, so use the menu for
titles). Clear the name to show the file's name again.

Add a transition between touching clips, or click its timeline marker, to
open **Transition** settings. Undo history gives agent edits readable names
such as **Add clip** and **Change opacity**.

## Compose with viewer guides

Choose **Safe margins**, **Rule of thirds**, or **Safe margins + thirds**
from the Player header's guides selector or the View menu. The action box
encloses 93% of the canvas dimensions and is labeled at its top; the title
box encloses 90% and is labeled at its bottom. Use them to keep text away
from edges and balance a shot. They are general guides,
not platform-specific safe-area requirements.

Guides follow the picture when resizing, using a portrait canvas or entering
full screen. They do not block editing handles, appear in exports, change
the project or consume an Undo step. The choice lasts for this app session;
choose **Guides off** to hide them.

## Organize edits with markers

Open **View → Markers**, **Timeline → Manage markers**, or the library's
**Markers** tab. **Add marker** places a note at the playhead. Click a row
to jump to it and edit its note, position and color; choose **Save marker**
to apply all changes in one Undo step. Cancel discards the draft. Position
accepts timecode or seconds with `s`, such as `12.5s`, rounded to the nearest
project frame. Invalid timecodes cannot be saved.

Search matches note text or displayed timecode; the color filter narrows
that list. Ruler flags remain visible while searching. Previous/Next moves
through all markers. Double-click a flag to open its editor, or use the
list's trash button to delete it. Undo restores a deletion. The shortcuts
panel lists marker navigation bindings.

Markers retain their absolute timeline positions when clips move. Notes
beyond the last clip are reachable and appear in the list, but do not make
the exported movie longer. Editing markers leaves clips, gaps and clip
selection alone. Saved markers reopen with the project; clip-specific
markers and range markers are not implemented yet.

Use **Export shown markers** to preview and save just the notes shown by
the current search and color filter. **Timecoded notes** keeps frame-exact
positions; **YouTube chapters** uses whole-second timestamps. The export
preview can be selected and copied with your normal text-copy shortcut.
**Save text** uses the platform's save picker or browser download fallback.

Chapter checks flag a missing `00:00` start, fewer than three chapters,
duplicate timestamps, markers at/past the movie end, and chapters shorter
than ten seconds (including the last). You can still save a draft and fix
its markers later. Names without notes become numbered chapter titles.
Times refer to the full timeline, even if an export In/Out range is set;
chapter timestamps round down to whole seconds. This saves a text file for
your video description; chapter display also depends on the destination's
requirements. [YouTube's chapter guidance](https://support.google.com/youtube/answer/9884579?hl=en).

## Manage effects

Select a visual clip or adjustment layer on the timeline, then open the
right-hand inspector's **Effects** tab. Its count shows how many effects
are attached. Use the eye to enable/disable an effect, or its trash button
to remove it; Undo restores a removed effect. Filters and color correction
remain under **Adjust**. Inspector tabs wrap when space is narrow.

Effects run from top to bottom. Use the up/down arrows to change their
order, or Reset to restore one effect's defaults and clear its keyframes.
**Disable all / Enable all** sets the whole stack off/on; Undo restores a
previous mix of enabled and disabled effects. **Remove all** clears the
stack and its effect keyframes in one undoable step. Color grading,
transforms and their keyframes are retained. Unlock a track before editing
its effects. Text and caption clips have the same Effects tab.

To reuse a stack, choose **Copy effects**, select another clip, and choose
**Paste effects** in its Effects tab. For several selected clips, use
**Paste effects to N clips** in the Selection inspector. It appends effects
and their keyframes to unlocked visual clips; audio and locked clips are
excluded and the count reflects that. Existing effects, grading, transforms
and timing stay intact. One Undo reverses the whole paste.

This clipboard lasts for the current app session and is separate from
normal clip/keyframe copying. Animation keeps its timing relative to the
clip's beginning, including when copied between projects with different
frame rates. Keys beyond a shorter clip's end are retained so the visible
part of an animated effect keeps the same interpolation.

## Where your work lives

**Desktop:** project JSON and home-screen summaries are saved in the app's
data folder. Saves keep a previous project version as a `.json.bak` file.
Imported media is referenced by its path, so keep the original files
available. Autosave does not make a portable backup of all source footage.

**Browser:** locally imported media and project JSON are kept in the origin private
file system (OPFS) for that browser profile and site. Clearing site data,
changing the site origin, or switching profiles can make those projects
unavailable. Storage failures can leave imported files usable for the current
session without keeping them for a reload. Keep independent backups of your
original media and important project data.
Media imported by its address (through automation) is copied into the same
storage, so the project keeps working when the address goes away; a file
over 1 GB stays linked to its address, and the app says so when it is
imported. See [[Web capability log]].

The OpenFrame rename must preserve existing saved work. Its migration plan
is in [[Renaming]]. The project format itself is documented in
[[Project format]].

## AI features and automation

Manual editing does not require an AI coding agent. The editor's optional
features include auto captions, local analysis, and the AI assistant. Some models or
tools need a separate download or installation; local inference can still
require network access to obtain model files. The current AI assistant uses a
local model server such as Ollama or LM Studio.

**Remove a background:** select a video clip, open Video > Remove BG and
turn on Auto removal (or use the AI tools card). The first time downloads
the model (88 MB, or 0.5 MB on a computer without a capable GPU); after
that it works offline. A bar shows progress and Cancel stops it. When it
finishes, the person plays over whatever is on the tracks below. Turning it
off and on again is instant.

**Ask the AI assistant for an edit:** click **AI assistant** in the title
bar. It opens as a column at the right of the editor, which makes room for
it (in a window too narrow for four columns the media library steps aside
until you close it); drag its left edge to resize it. Pick the model server
and model at the top, type what you want in the box at the bottom and
press Enter to send (Shift with Enter starts a new line). The box grows as
you type. While the model works, the steps it takes appear as they run;
**Stop** ends the turn. Each answer that changed the timeline has an
**Undo** button for all of its changes at once, and a failed request can be
tried again. The examples in an empty conversation fill the box for you.

**Connect Codex or Claude Code (desktop app):** open the AI assistant's
**Connect agents** tab and turn on **Allow AI agents**. Then click **Add to
Codex** or **Add to Claude Code**: the app asks that program to add
OpenFrame to its settings and tells you whether it was added, was already
there, or the program was not found (with a link to install it). You can
also copy the ready-made command or, for Codex, the `config.toml` entry.
Start a new Codex or Claude Code session afterwards, and keep OpenFrame
open with Allow AI agents on while the agent works.

External agents connect only after the user enables "Allow AI agents".
[[Automation]] explains the controls, MCP connection (with step-by-step
Codex CLI and Claude Code setup), headless rendering, and the `openframe`
command line. [[AI tools]] records the algorithms and limits.

## About OpenFrame

**Help → About OpenFrame** shows the version, the license (GPL-3.0-only:
you may share and change the app under its terms) and the open-source
packages it is built with. Its links open the license text, the source
code, this guide and the full list of third-party licenses in your
browser.

## Report a problem or help improve it

Follow [CONTRIBUTING.md](../CONTRIBUTING.md). Include the revision, OS,
desktop/browser target, steps, expected result, and actual result. Share only
media you have permission to share and remove private paths and tokens from
logs. Report it as an issue on the repository.

## Reuse settings

In the clip inspector's **Effects** tab, open **Effect presets…**. Name and
save the selected clip's stack, then choose it on another clip and **Apply
preset**. Presets append effects with independent animation and work across
projects on this device. Rename/delete them in the same dialog. Applying is
undoable; deleting a saved preset does not remove already applied effects.

Use **Copy attributes** in a clip inspector, select the destination clip(s),
then **Paste attributes…**. Choose transform, color, audio or effects. Checked
groups replace those settings and their animation; effects append unless
**Replace existing effects** is selected. Timing and source offsets stay put.
Unavailable groups need compatible targets on unlocked tracks. Undo restores
the previous settings.

## Preview trim edges

While dragging with Trim, Ripple, Slip, Roll or Slide, the player shows two
clip-edge frames and their times. Roll compares the outgoing and incoming
frames; Slide compares neighboring clips. Other tracks and transitions are
excluded so the cut is clear. Release to keep the edit; cancel the gesture to
restore it. The whole drag is one Undo step. In a short player the frames
shrink so the preview's title and note stay in view.

## Nest clips in a compound clip

Select the clips (any tracks: video, titles, sound), then choose **Create
compound clip** from the right-click menu or the **Timeline** menu (Alt+G).
They become one green clip that plays them as they were. Its speed,
position, scale, opacity, blend mode, color, effects and volume act on the
whole group, so a fade or a filter covers every layer at once.
Double-click it to edit what is inside; the bar above the timeline shows
where you are, and its first name takes you back. A change inside shows in
every copy of that compound clip. **Break apart** (Alt+Shift+G) puts the
clips back where they were. Undo works the same inside and out, and saving
or exporting always takes the whole project.

## Preview sources

Choose **Preview** under a media card to open its source. Play, scrub or step
frames, set **Mark In** and **Mark Out**, then **Add range**. Out includes the
frame you see. The range is placed using the current timeline mode; Undo
removes it. Previewing does not move the timeline playhead. Marks reset when
the preview closes. Image previews offer **Add image** instead.

## Organize media

In **Manage media → Organize folders**, create a folder, then choose it beside
each file. Mark **Favorite** for your preferred takes. Filter the library by
folder or **Favorites only**, combined with its other filters. Rename and
delete folders in the same section; deleting a folder unfiles its media and
keeps all clips and source files. Organization is saved with this project and
can be undone. These are virtual folders, so footage stays on disk where it is.

## Remove media

Right-click a media card and choose **Remove from project**. A file that
clips on the timeline use says how many and removes those clips too. To
clear out everything the timeline does not use, open **Manage media** and
choose **Remove unused**. Only the project forgets the file; it stays on
disk, and Undo brings it back.

## Relink moved media

Open **Media → Manage media** to check source availability and see file paths.
Choose **Locate…**, pick one replacement, review its path, then **Relink file**.
Every use keeps its cuts and effects; Undo restores the old location. Choose
the same media kind with the original audio/video streams and at least the
original duration. When a proxy exists, the check reports that editing copy.

## Mix tracks

Open **Mixer** from the timeline toolbar or **View > Mixer**. Move each
track's vertical fader to balance its level in dB, and use pan to place it
left or right. **Mute** silences a track; **Solo** plays only soloed tracks.
The meters show peak and RMS after track gain and pan. The master strip
controls the whole mix, including exports, and shows stereo levels and
short-term LUFS. A drag is one undo step. Double-click a fader or pan to
reset it. Close the panel with **Close mixer**.

## Use animated images

Import an animated GIF, WebP or APNG like any image. Supported webviews read
its frame timing and transparency. A new clip lasts one loop; drag its right
edge farther to repeat it. Hover across its library card to scrub frames.
The same animation is drawn during playback and export, including imported
animated stickers. When ImageDecoder is unavailable the image is treated as
a still. Loops larger than 256 MiB after decoding are refused; use a smaller
animation in that case.

## Change the timeline display

Open **Timeline display** on the timeline toolbar to show or hide waveforms,
video thumbnails or clip names, and choose small, medium or large tracks.
These choices stay with your profile and do not change exports. Medium
retains individual heights set in track menus. Right-click a track header
and choose a **Track color** swatch to tint its clips. A clip with its own
label color keeps that color instead. **No track color** removes the tint.

## Move or open a project file

On desktop, choose **File > Collect files**, then a destination folder.
OpenFrame creates a new subfolder containing `project.json` and `media`.
Wait for copying to finish, then move that entire subfolder together. Media,
proxies, LUTs and background-removal cutouts are included. A missing source
must be relinked before collecting. The original project and files stay put.

Choose **File > Open project file** and select the JSON. It opens as a new
saved project; its relative media paths are resolved beside the JSON on
desktop. If media is missing, open **Media > Manage media** and relink it.

On the web, **Collect files** downloads only the JSON. Media remains in this
browser profile. Opening that JSON elsewhere does not transfer its media;
relink the original files there. Automation's `collect_project` is desktop
only; `open_project_file` accepts a path only on desktop.
