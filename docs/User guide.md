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

## Manage effects

Select a visual clip or adjustment layer on the timeline, then open the
right-hand inspector's **Effects** tab. Its count shows how many effects
are attached. Use the eye to enable/disable an effect, or its trash button
to remove it; Undo restores a removed effect. Filters and color correction
remain under **Adjust**. Inspector tabs wrap when space is narrow.

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
