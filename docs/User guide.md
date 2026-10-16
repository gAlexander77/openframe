# OpenFrame user guide

OpenFrame is a desktop-first video editor in active development. The
documentation uses the chosen name; the current application still displays
"Video Editor" until the coordinated rename is implemented.

## Get the editor

The repository is currently private and no public release is announced.
With repository access, follow the root README's source setup and run
`npm run tauri dev`. Node.js/npm, Rust, and the platform's Tauri prerequisites
are required. Install FFmpeg and ffprobe on `PATH` for the desktop's broader
media-format support. `VIDEO_EDITOR_FFMPEG` is the current override; the
rename will retain compatibility with it.

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

The app's shortcut panel is the source for the current keyboard bindings.
[[Features]] explains the deeper trim, color, keyframe, and audio tools.

**File → New project** saves the current project and creates a new one.
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
A focused project card opens with Enter or Space. Activating its Delete
button with the keyboard only arms deletion, just like clicking it.

Closing or switching projects cancels unfinished captions/analysis and
discards late import results. Reopening the same project starts a new session;
restart unfinished work there. A movie export already in progress may finish
from its original project snapshot.

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

Drag a row, double-click it, or use its Add button to place media, just as
with the grid. Search/filter/view choices survive tab changes. Opening or
creating a project clears search/type/usage filters; view and sort last for
the app session. Browsing and selecting uses do not consume Undo steps.

## Compose with viewer guides

Choose **Safe margins**, **Rule of thirds**, or **Safe margins + thirds**
from the Player header's guides selector or the View menu. The action box
encloses 90% of the canvas dimensions; the title box encloses 80%. Use them
to keep text away from edges and balance a shot. They are general guides,
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
URL imports through automation retain their original URLs and need those
sources to stay reachable after reload; see [[Web capability log]].

The OpenFrame rename must preserve existing saved work. Its migration plan
is in [[Renaming]]. The project format itself is documented in
[[Project format]].

## AI features and automation

Manual editing does not require an AI coding agent. The editor's optional
features include auto captions, local analysis, and Copilot. Some models or
tools need a separate download or installation; local inference can still
require network access to obtain model files. The current Copilot uses a
local model server such as Ollama or LM Studio.

External agents connect only after the user enables "Allow AI agents".
[[Automation]] explains the controls, MCP connection, headless rendering,
and the current `video-editor` command names. [[AI tools]] records the
algorithms and limits.

## Report a problem or help improve it

Follow [CONTRIBUTING.md](../CONTRIBUTING.md). Include the revision, OS,
desktop/browser target, steps, expected result, and actual result. Share only
media you have permission to share and remove private paths and tokens from
logs. During the private phase, use the review channel agreed with the owner.
