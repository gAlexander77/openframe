# Next agent handoff - OpenFrame

**Updated:** 2026-10-22. This is the current owner direction for the next
Claude Code or Codex pickup. Read it before resuming previous tasks.

## Current state - 2026-10-22 (read first)

- `main` holds all seven improvements rounds (to ADR-144), the shot log
  (ADR-145, 2026-10-23) and its end-to-end hardening (ADR-146,
  `improvements-9`, 2026-10-24; History, "The shot log checked end to end").
- **The owner's standing direction (2026-10-21):** keep finding and fixing
  bugs, add what major editors have that OpenFrame lacks, test the MCP
  tools with real, voiced edits, and merge finished work into `main`
  through pull requests (the owner is the only person on the repository).
  Hand detailed work to Codex (`codex exec`) to spare Claude usage.
- **New on 2026-10-22: a stream-clipping channel.** The owner wants to clip
  streamers' VODs into shorts, with the streamers' permission, credited.
  `find_highlights`, `apply_stream_layout`, `create_clips` and
  `export_projects` do it (ADR-140 to ADR-143). The app has no downloader
  on purpose: the owner brings the VOD file.
- **How lanes ran in round 7:** Claude Code writes a spec, `codex exec`
  builds it in its own worktree, and Claude Code runs the drives, reviews
  and merges. Codex's sandbox cannot launch a browser or vitest's default
  pool: give it `npx vitest run --configLoader native --pool threads
  --maxWorkers 2` and run every drive yourself. A Codex blind tester needs
  `--approve-for-me` (approvals "never" refuses every MCP tool not marked
  read-only; it cannot be combined with `-s`) and a longer tool timeout,
  `-c mcp_servers.openframe.tool_timeout_sec=900`.
- **Memory is the limit on this machine.** One highlight run on a
  45-minute VOD peaks the app's WebView2 at about 5.5 GB (back to 2 GB on a
  project switch, ADR-144). Run one drive at a time while the desktop app
  is up; Claude Code stops background jobs when memory runs low.
- **Sweeps:** skip the desktop-only `media-relink` and
  `desktop-session-jobs`, and `window-header`, which needs its own runner;
  `music-structure` needs the private promo track. Rerun failures alone
  before reading them as bugs ([[Driving the app]], traps 23 to 26).
- **The shot log next:** create_clips reading the log (place hooks clear of
  on-screen text it read); a log measured by an older measurer is reused
  until refreshed (a measurer version in the log would re-measure it);
  a web-build describer is not planned.
- **Then:** rerun the clipping blind test through to exported files (the
  first one was stopped by low memory before it exported); bring the
  highlight peak memory down (the analysis of one long file);
  variable-line canvas editing and per-letter border fades (ADR-136);
  the compositor's shader warm-up polls programs a draw or unmount already
  deleted (harmless `GL_INVALID_VALUE: glGetProgramiv` warnings).
- **Blind MCP tests** found most of rounds 5 to 7: run `claude -p` (or
  `codex exec`) from a folder outside the repo, so only the user-scope
  OpenFrame MCP server is registered. Allow only the OpenFrame tools plus
  Read, Write, Edit and Glob, with no shell or web. Give it a brief and its
  media, and fix what its report and calls show. Run one tester per app,
  because the tools act on the app's one open project.

## Decisions and scope

- The chosen product name is **OpenFrame**, spelled as one word with capital
  O and F. Use `openframe` for the intended package/binary/repository slug.
- Repository: [gAlexander77/openframe](https://github.com/gAlexander77/openframe),
  renamed from `video-editor` on 2026-10-17 at the owner's instruction,
  together with the app, binary and packages (docs/Renaming.md).
- The owner selected GPL-3.0. The root LICENSE and README apply
  **GPL-3.0-only** to original code and documentation.
- **Desktop first** remains the priority. The owner explicitly clarified
  this after discussing the web development process. ADR-003 still applies.
- The owner made the repository public on 2026-10-17. Do not deploy a
  hosted app, change GitHub settings, or create a release without a separate
  owner instruction.
- This handoff was a documentation/licensing pass. App code, configuration,
  manifests, locks, automation names, saved data, and existing agent work were
  left untouched. The owner subsequently authorized local commits of this
  documentation pass. Pushing and publication remain unrequested.

## Preserve the paused work

The owner reported that Claude Code had exhausted its usage allowance and
asked that its work not be interrupted. Do not infer that paused worktrees
are abandoned. Inspect current status, history, and worktree changes before
editing. At inspection, main was `1af6774` and the worktrees included
`bg-removal`, `compound-clips`, `inline-text`, and `timeline-ux`; this is a
dated observation, not a claim about their current progress.

Do not stop agent sessions, dev servers, browser sessions, or desktop apps
to make room for unrelated work. Do not reset, merge, commit, delete, or clean
another worktree without coordinating its ownership and current state.
Keep your own worktree and all scratch under
`<worktrees>\<repo>\<purpose>` (the folder is in `CLAUDE.local.md`) and remove it when its work lands.

## Codex pickup (added 2026-10-14 by Claude Code)

Codex starts from `CODEX_GUIDE.md` at the repository root: rules, the
headless drive runner, an ordered list of small tasks, and the parked
branches it must not touch (`bg-removal`, `compound-clips`, `timeline-ux`,
all committed as WIP and pushed as backup; the `inline-text` worktree is
merged and removed).

## Pickup order

1. Read `AGENTS.md`, `CLAUDE.md`, [[Index]], and the current worktree status.
   Preserve the documentation handoff and any pending changes. Coordinate
   with the resumed agent before overlapping
   edits or starting the implementation rename.
2. Follow [[Renaming]] to rename the entire project in a controlled change.
   Start with the identity inventory; preserve old projects and automation.
   Changing the app-data identifier needs migration and recovery evidence.
3. Follow [[Release preparation]] to complete licensing metadata, dependency
   and asset notices, reproducible source builds, and distribution documents.
   The GPL file is in place; this does not mean an installer is ready to ship.
4. Continue desktop development and desktop verification. Log the secondary
   web-app capability findings described below before making parity claims.

## Browser development: log the uncertainty

The owner was unsure whether a change to the web development process would
work and then confirmed **desktop should be first**. No browser-first switch,
server backend, new hosting target, or promise of complete web parity was
approved.

Use the existing web build as a secondary target and a useful shared-UI
development surface. A browser-only test does not validate desktop behavior.
After the relevant desktop workflow works, record whether its web counterpart
works, needs a browser-specific fallback, or remains desktop-only. In a dated
entry, record the tested revision, browser/OS, media/codec, result, and limits.

Initial checks to log: OPFS import and reload persistence, save/export picker
and download fallback, decode and encode availability, memory behavior with
large files, captions/model loading, and the desktop-only FFmpeg and local
MCP paths. Cover only platforms actually tested; leave the rest unverified.
Keep platform differences inside the established seam and update [[Features]]
and [[User guide]] with supported behavior. This is a validation plan, not a
report of tests run during this documentation pass.

## Existing issue observed during inspection

The tracked `.gitignore` at `1af6774` contains `<<<<<<< HEAD`, `=======`,
and `>>>>>>> ux-audit` merge-marker lines around the scratch/audit ignores.
Git reported a clean working tree before this pass. The markers were left
untouched to respect the documentation-only scope. Have the owning agent
resolve them, retaining both intended ignore rules, before release work.

**Resolved 2026-10-14** by the owning agent (Claude Code): both rules kept
(`scratch/` and `scripts/ui-review/shots/**/*.png`). The cause was a merge
helper that assumed LF endings; see [[History]].

## Documentation entry points

The root README explains the AI experiment and current repository status.
[[AI development]] explains the purpose of the documentation and how agents
use it. [[User guide]] helps users get started; `CONTRIBUTING.md` explains
how people and agents can help. [[History]] records this handoff separately
from the earlier implementation and its historical test results.

## State at 2026-10-16, evening (Claude Code)

- **No parked work.** `timeline-ux`, `compound-clips` and `bg-removal`
  are finished and merged; their worktrees and local branches are gone
  (the remote backup branches remain). No agent worktree is open.
- **What landed** is listed in [[History]] ("CapCut parity pass") and
  marked in the build order of [[Feature gaps 2026-10-16]]; [[Roadmap]]
  holds what is next, starting with a desktop check of these features.
- **Verification:** type-check, unit tests and every web drive pass on
  main; the desktop app was not driven.
- **For the owner:** `origin/main` was pushed from this clone at 18:50 to
  `1e0dbe9`, not by an agent; nothing since is pushed. The background
  model's training-data terms are flagged in [[Release preparation]].
- **Traps added today** (see [[Driving the app]]): unlink worktree
  junctions before removing a worktree (12), and Vite can miss a file
  replaced by rename, so write files in place, once (13).

## Late evening, 2026-10-16 (Claude Code)

- **Sixteen more features landed on main**, listed in [[History]] ("Late
  evening"); the [[UX audit 2026-10-14]] has no open items and
  [[Feature gaps 2026-10-16]] is current (a note at its top lists what is
  still open at P0/P1).
- **Since then:** transcript editing (Captions tab, `get_transcript`),
  frame blending (ADR-051), caption find and replace, an undo history
  list (right-click Undo or Redo), text case, loudness-normalized export,
  channel fill and keyframed pan landed too. A full run of all 72 web
  drives against a freshly started server passed, apart from the two
  desktop-only drives (`desktop-session-jobs`, `media-relink`, which
  import from `F:/` paths); `project-jobs.js` still imports store-backed
  modules plainly (trap 14) but passes on a fresh server.
- **Next candidates**, in rough value order: border and shadow on
  pictures (layer shader, not an effect), auto reframe and motion
  tracking (both need a tracker in a worker), optical flow (ADR-051's
  `next` is where it hooks in), one-side trims of a linked pair for J/L
  cuts.
- **Translated captions are blocked on a fixture**, not on code: Whisper's
  translate task exists, but Kokoro speaks English only, so nothing local
  can produce non-English speech to check it against.
- **Still for the owner:** push (main is well ahead of `origin/main`), and
  a desktop check of the microphone, speech models, fonts and the new
  LUFS worklet (the desktop CSP allows same-origin worklets, as the
  voiceover's already proves, but it was not driven).

## 2026-10-17 (Claude Code)

- **Renamed and public.** The app, binary, packages and repository are
  OpenFrame (`gAlexander77/openframe`), public at the owner's request; the
  identifier and saved-data keys keep the old name ([[Renaming]]).
  Machine-specific paths live in the git-ignored `CLAUDE.local.md`; never
  commit personal data, paths or tokens (the owner's standing rule).
- **The agent surface grew from two videos made over MCP** (RacePulse and
  OpenFrame promos, [[History]]): change summaries, `batch`,
  `frame_region`, `export_video`, `preview_frames`, `add_voiceover`, text
  boxes, `align_clips` margins, a limiter in export loudness, mono measured
  as it plays, and a compressor with Enhance voice (ADR-052, ADR-053).
- **CI** (`.github/workflows/ci.yml`) runs the gates only when the owner
  starts it (ADR-082): type check and unit tests on Linux, Rust fmt, clippy
  and tests on Windows. Never start it; run the gates locally.
- **Next**: [[Roadmap]] holds the order.

## 2026-10-17, late (Claude Code): the `improvements` branch

- **Where it is.** Branch `improvements`, in its own worktree, committed
  locally and **not pushed or merged**: the owner asked for the work on a
  branch and decides when it reaches `main`. A detached `verify` worktree
  holds a snapshot for full drive runs on its own Vite port; remove both
  worktrees (junctions first, trap 12) once the branch lands.
- **What it adds** ([[Everyday gaps 2026-10-17]] has the research and the
  status of each gap):
  - Tracking and Auto reframe ([[ADR-054 Tracking writes position keyframes]]).
  - Sync audio by waveform.
  - Linked picture and sound with out-of-sync counts.
  - Media removal and editing several clips at once.
  - Typing a time to jump, and saving a frame from the player.
  - The rest:
    - camera and screen recording;
    - sound effects;
    - caption looks and Enter-to-split;
    - saved text styles;
    - Magnify;
    - a TikTok, Reels and Shorts guide;
    - a motion path;
    - a pipette on color fields;
    - Home card rename and duplicate;
    - fades on a video's own sound;
    - a few agent-only commands now in the UI.
- **How it was checked.**
  - Every commit passed tsc and the unit tests.
  - Every feature has its own headless drive.
  - Full runs of all web drives on snapshots passed.
  - `scripts/drive/style-sweep.js` checks 129 states (every tab, menu
    and dialog at 1600 x 950, 1280 x 720 and 1100 x 680) for layout
    faults, names and contrast; it is clean.
- **Not checked on the desktop:**
  - the camera and screen permissions in WebView2 (Record);
  - the EyeDropper API in WebView2.

  Both are listed under the [[Roadmap]]'s desktop check.

## 2026-10-18 (Claude Code): tools an AI model can make a professional video with

- **Where it is.** Still on branch `improvements`, committed locally and
  **not pushed or merged**. The four toolkit branches (epic, ads, fx,
  audio) and the polish branch are merged into it, and their worktrees
  are removed.
- **What it adds** (History's 2026-10-18 entry has each piece and why):
  - **The MCP guide** ([[ADR-055 The MCP guide is generated from the tools]]):
    - a `help` tool, three prompts, `guide://` and `catalog://`
      resources, and tool titles and hints;
    - [[MCP tools]] and [[Agent playbook]] are generated, and tests fail
      when they are stale, when a tool is not filed in a group, when an
      example breaks its schema, or when any parameter lacks a
      description.
  - **Toolkits:**
    - epic edits: music structure, cut to beats, hits, ramps, bars, fit
      music, new transitions and sounds;
    - ads: kinetic titles, brand kit, ad elements, text behind the
      subject, versions per shape;
    - graphics: shapes, track mattes, motion blur, edge modes, overshoot
      eases, wiggle;
    - sound: filters, reverb, echo, tape stop, broadcast loudness,
      `measure_loudness`.
  - **Review tools:**
    - `preview_media` and `preview_motion`;
    - `check_project`, the design rules measured, with each finding
      naming the tool that fixes it;
    - `save_project_copy`, `move_track` and `slip_clip`.
  - **`scripts/mcp-web.mjs`** serves the web build's MCP over HTTP from
    a headless browser, so a model can be tested against the tools as a
    client sees them ([[Driving the app]]).
- **How it was checked.**
  - Each merge passed tsc, the unit tests (810) and its drives.
  - A full run of all web drives on the merged branch passed (116; the
    other three are desktop-only by design).
  - Two blind tests, each a fresh agent given only the MCP connection,
    made an ad and an epic edit. Every finding they reported is fixed,
    with a test or a drive.
- **Next, if the owner wants more:**
  - a third blind test with real footage;
  - per-version overrides in `export_versions`;
  - undo should also drop a voiceover's speech files;
  - beat markers should follow the music that `fit_music` trims.
