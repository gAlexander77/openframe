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
- [ ] Source preview and In/Out selection before timeline placement.
- [ ] Reusable effect presets and selective Paste Attributes.
- [ ] Two-up trim preview.
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
