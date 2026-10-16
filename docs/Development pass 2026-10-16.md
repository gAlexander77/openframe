# Development pass — 2026-10-16

The owner approved the six proposed workflow additions and asked for styling
and interaction checks through Playwright MCP attached to a real application
WebView. Keep each intention in a local commit with its documentation.
Preserve `Modelfile.qwen32k`, the owner's open desktop instance and the parked
`bg-removal`, `compound-clips` and `timeline-ux` worktrees. No publication.

## Delivery checklist

- [x] Project-session ownership for delayed imports and analysis.
- [ ] Save a copy / independent project versions.
- [ ] Missing-media relinking.
- [ ] Media folders and favorites.
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

The owner's existing desktop process has no WebView debugging port. Final
checks will use the real Tauri application with an isolated project folder
and WebView profile, attached through Playwright MCP. The existing app is
preserved; OS input, native file dialogs and window dragging are outside
the DOM/WebView automation boundary. Record the final results here.
