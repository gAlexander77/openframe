# Development pass — 2026-10-16

The owner approved the six proposed workflow additions and asked for styling
and interaction checks through Playwright MCP attached to a real application
WebView. Keep each intention in a local commit with its documentation.
Preserve `Modelfile.qwen32k`, the owner's open desktop instance and the parked
`bg-removal`, `compound-clips` and `timeline-ux` worktrees. No publication.

## Delivery checklist

- [x] Project-session ownership for delayed imports and analysis.
- [x] Save a copy / independent project versions.
- [x] Missing-media relinking.
- [x] Media folders and favorites.
- [x] Source preview and In/Out selection before timeline placement.
- [x] Reusable effect presets and selective Paste Attributes.
- [x] Two-up trim preview.
- [ ] Final real desktop WebView review through Playwright MCP.

## Decisions and evidence

### Delayed work belongs to one open document session

Use an abort signal renewed on every document load and aborted after a
successful close. An ID check alone cannot detect closing and reopening the
same project. Capture ownership before pickers/adoption, decoding, worker
requests and file reads. Discard late media/LUT/subtitle/sticker results;
cancel captions and analysis with their existing abort paths. A failed save
does not close the session. Exports already consume a document snapshot and
do not apply edits, so they can finish independently.

The capture travels through browser file adoption and timeline drops too.
Adding an asset also requires it to belong to the current document. Imported
bytes or generated proxy/sticker files may finish writing after cancellation;
this change does not delete files or promise immediate interruption of every
decoder/converter. No saved-data fields or dependencies were added.

Eight `project-jobs` checks pass through isolated headless Playwright MCP:
late media, picker result after same-ID reopening, subtitles, LUTs, analysis,
stickers, caption generation and successful work in the new session. The
scope unit test exercises close/reopen invalidation; TypeScript and all 380
unit tests pass. These checks are not native desktop evidence.

### Real desktop verification setup

The owner chose the current app, then explicitly authorized restarting that
test instance. It was closed gracefully and restarted with WebView debugging
on localhost:9222. Playwright MCP attaches with `--cdp-endpoint`; a probe
confirmed `platform() === "desktop"`. Its shutdown disconnects without
calling `browser_close`. The temporary isolated validation worktree/build was
stopped and removed before this change of setup. OS input, native file dialogs
and window dragging remain outside the DOM/WebView automation boundary.

### Save a copy

File → Save a copy creates a separate project ID and detached edit document,
preserving internal clip/asset references. It shares source file locations,
so this is an alternate edit/version, not a footage backup. The original is
saved before copying; an optional switch waits for the copy write and another
original save to protect edits made during I/O. A failed copy keeps the
original open and the dialog draft available; retry uses the same generated
ID. A native modal supplies focus trapping and keyboard isolation.

This follows the useful distinction between a project document and its
referenced media in [Adobe's project copying guidance](https://helpx.adobe.com/premiere/desktop/organize-media/transfer-files/copy-transcode-or-archive-project.html).
Media collection/archival is separate work. Seven `project-copy` checks pass
on the real desktop WebView through MCP, including real Rust persistence,
copy failure/retry, original independence, cancel, name validation and
1100×680 fit. The desktop screenshot was inspected. TypeScript and all 382
unit tests pass.

Lesson: after module changes, reload the testing WebView before importing
dev-only module helpers. A page spanning hot reloads can contain old/new
module instances; the first drive created an invisible second session.
The corrected drive starts from a fresh page and uses Home/rename UI.

### Missing-media relinking

Media → Manage media checks editing sources and lists their paths. Locate
probes one replacement, converts unsupported desktop codecs if needed, then
shows its path and metadata before Relink applies it. It keeps the original
asset ID/label and every clip edit; Undo restores the old location. Duration
must cover the original source, including unused handles. Stream/type checks
prevent accidental loss of picture or sound. See ADR-041 for the rationale.

`relink_media` exposes the same operation using an already imported replacement.
Cursor cache keys now include the source location so relink/undo cannot keep
showing an old decoder. The scope and original-location checks reject stale
picker results. There is no batch path guessing or source timecode alignment.
Availability checks examine the editing proxy when present; they do not
certify that a separately referenced original still exists.

Seven `media-relink` checks pass through MCP on the real desktop WebView:
missing detection, picker cancellation, incompatible image rejection, edit
preservation, actual decoded output, Undo and 1100×680 layout. The replacement
file selection is stubbed (no OS dialog control); file probing/rendering are
real desktop I/O. Screenshot inspected. TypeScript and all 384 tests pass.
Lesson: even after reload, Vite can serve timestamped module dependencies.
Dev-only test hooks must import the URL recorded in Resource Timing rather
than an unversioned URL that can create a second store instance.

### Media folders and favorites

Manage media now creates/renames/deletes flat virtual folders and assigns
assets and favorites. Folder deletion unfiles media without removing files
or clips; rename/delete and membership changes are undoable metadata edits.
Library folder/favorites filters intersect the existing search/type/usage
filters. Deleted/undone folder selections clear instead of hiding everything.

Optional `mediaFolders`, asset `folder` and `favorite` fields extend schema 1;
old documents need no migration. The loader repairs case/whitespace duplicates
and invalid favorites. Older builds can still render these projects, but may
discard folder definitions on saving. ADR-042 explains the compatibility
tradeoff. Commands expose folder CRUD and multi-asset assignment.

Nine real desktop MCP checks pass for membership, rename, combined filters,
empty results, clearing, native save/load, deletion, Undo and narrow layout.
Both desktop screenshots were inspected. TypeScript and 387 unit tests pass.

### Source preview and In/Out

Each Media/Audio card has Preview. The source modal decodes through private
engine cursors, with Web Audio playback and its own clock. It pauses program
playback without moving the program playhead. Scrub and frame-step before
marking In/Out; Out includes the current source frame. Add range converts the
exclusive interval to whole project frames, rounding down to avoid going past
the selection. It uses the existing insert/placement path and is undoable.
Still images have preview/Add image; audio has transport/range controls.

The modal's marks are session-only. Closing it cancels playback, and changing
projects or relinking during preview prevents stale insertion. `add_media_clip`
already exposes equivalent source offset/duration controls. Private cursor
cleanup waits for in-flight decoding before releasing borrowed samples.

Eight `source-monitor` checks pass through real desktop MCP: exact marks,
range playback, untouched program state, correct inserted duration/offset,
Undo, audio range, cancel and narrow layout. Screenshot inspected. TypeScript
and 389 unit tests pass. Audibility was not assessed by a human; playback
progress and actual desktop audio decoding/scheduling were exercised.
Reference: [Adobe Source monitor In/Out workflow](https://helpx.adobe.com/premiere/desktop/get-started/source-and-program-monitor-adjustments/set-in-and-out-points-in-the-source-monitor.html).

### Reusable effect presets

Inspector → Effects → Effect presets saves, renames, deletes and applies
named stacks across projects on this device. Presets include enabled state,
parameters, keyframes and source frame rate. Applying uses the established
stack copier: append independent effect IDs, convert key times, preserve
existing attributes, and respect track locks. `apply_effect_preset` accepts
the same serialized preset for automation.

The local preset library is separate from the project and its Undo history;
applying a preset is undoable. Storage writes precede visible changes. Failed
writes retain the draft and old library; corrupt stored data reports a
recoverable error. The parser validates catalog types/paths, numeric data,
frame rates and easing. No dependency or document fields were added.

Six real desktop MCP checks pass: failed storage/retry, rename, persistence
through WebView reload and a new project, application Undo, deletion and
narrow layout. Screenshot inspected. TypeScript and 391 tests pass. The first
drive needed its Close selector scoped to the modal (the title bar also has
a Close button); no native window button was clicked.

### Selective Paste Attributes

The inspector offers a detached attribute clipboard and a group-selection
dialog: transform/crop/opacity/blend, color/filter, audio settings/fades, and
effects. Only compatible groups across all targets are enabled; locked tracks
are rejected atomically. Checked groups replace their static settings and
keys. Effects append by default or explicitly replace the existing stack.
Clip timing, source offset, speed, text content, masks and animations stay.

Keyframes and audio fades preserve seconds across frame rates; fades clamp to
the target duration. Color carries its referenced LUT into another project
without reusing a conflicting ID. This shares the existing local file, not
its bytes. `paste_attributes` exposes same-project copying to automation.
Attribute/preset application uses metadata transactions so magnetic mode
cannot compact intentional gaps as a side effect.

Six real desktop MCP checks pass for selective color, unchanged gaps, effect
replacement/independent IDs, Undo, lock enforcement and narrow fit. Screenshot
inspected. TypeScript and 395 unit tests pass, including mixed-rate keys/fades,
cross-project LUT references and all-target validation. The first drive used
an incorrect command name for locking; corrected to `update_track`.

### Two-up trim preview

During trim/ripple/slip drags the player shows the clip's first and last
frames. Roll shows outgoing/incoming edges; slide shows the neighboring
edges. The panels read the actual applied edit after source limits clamp it.
They isolate clips with their settings, excluding transitions/other tracks;
audio clips show edge timecodes. The displayed source timecodes use project
fps. Private engine cursors supply actual frames without moving the playhead.

Release commits one Undo step and restores the program viewer. Escape,
pointer cancellation and lost focus restore the gesture's starting edit and
clear the preview/listeners. Loading a document clears the gesture baseline
so a later cancellation cannot restore another project. No saved fields or
editing command are needed: this observes existing trim operations.

Eight real desktop MCP checks pass, including pixel decoding of the numbered
fixture for roll, slip, slide and trim; one-step Undo; Escape/pointer cancel;
and 1100×680 layout. Both screenshots inspected. TypeScript and 397 unit
tests pass, including clamped handles, reverse and freeze edge mapping.
The existing Timeline gesture handlers were touched; Claude's parked
`timeline-ux` worktree remains untouched and will need normal conflict review.
Reference: [Adobe trim mode](https://helpx.adobe.com/premiere/desktop/edit-projects/trim-clips/edit-in-trim-mode.html).
