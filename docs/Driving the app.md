# Driving the app

How to steer the **running desktop app** from a script (real webview, real
Tauri IPC, real Rust, real files) and read back what actually happened.
Ported from TermHQ's page of the same name and rewritten for this app.
Reach for it whenever "does the built thing work" matters more than "does
the unit pass".

**Owner direction, 2026-10-15:** do not control this computer's desktop,
mouse or keyboard while the owner is working. Use headless Playwright MCP.
The owner may provide a separate computer for native checks later. The
desktop setup below is a reference for an explicitly authorized session,
not permission to interrupt the current one.

**Which harness:**

- **The web build** (`npm run dev`, :1420): engine and UI logic with no IPC.
  Run a drive headless with `node scripts/drive/run.mjs scripts/drive/<name>.js
  [--size 1600x950]` (once: `npm i --prefix scratch playwright-core`); it
  prints PASS/FAIL, the failed checks, and writes the full result to
  `scratch/`. The Playwright MCP tool's `browser_run_code_unsafe` runs the
  same files.
- **This page**: the desktop app over WebView2's debug port. Anything that
  crosses IPC: the `media:` protocol, projects, exports, FFmpeg proxies,
  OS drops.
- Neither proves an **OS-level** action (a real Explorer drag, a keystroke
  the OS delivers). Those stay hand checks.

WebView2 is Chromium, so it speaks the DevTools protocol; macOS WKWebView
and Linux WebKitGTK do not, and have no equivalent of this page yet.

## Setup, once per session

1. Generate the test media: `node scripts/make-fixtures.mjs` (into
   `fixtures/media/`, gitignored).
2. Launch the dev app with the WebView2 debug port open:

   ```
   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev
   ```

   The variable is WebView2's own and is *appended* to the app's browser
   arguments; it opens the standard DevTools protocol for this app only.

   **Beside another instance** (a worktree, a second agent), give the run its
   own Vite port, debug port and app folders with a config file in the
   worktree's gitignored `scratch/`:

   ```json
   {
     "build": { "devUrl": "http://localhost:1430", "beforeDevCommand": "npx vite --port 1430 --strictPort" },
     "app": { "appDirectoriesOverride": "F:/Dev/2026/worktrees/video-editor/<purpose>/scratch/appdata" }
   }
   ```

   ```
   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9230 npx tauri dev --config scratch/dev.conf.json
   ```

   `appDirectoriesOverride` moves app data, cache *and* the WebView2 profile
   (it lives in local data) into `scratch/appdata`, so a drive never touches
   the owner's projects, and two instances never share one WebView2 profile
   (browser arguments that differ need different profiles).
3. In `scratch/`: `npm init -y && npm i playwright-core`. It attaches to
   existing browsers and downloads none of its own.
4. Sanity check: `curl http://127.0.0.1:9222/json/list` lists one page,
   `http://localhost:1420/` in dev (`http://tauri.localhost/` in a build).

## The script skeleton

```js
const { chromium } = require("playwright-core");
(async () => {
  const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const app = b.contexts().flatMap((c) => c.pages())
    .find((p) => /localhost:14\d\d|tauri\.localhost/.test(p.url()));
  // ... drive ...
  await b.close(); // detaches; the app keeps running
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
```

The drives in `scripts/drive/` are files holding `async (page, ...args) =>
result`. A runner in `scratch/` reads one, evaluates it, and calls it with
the page plus command-line arguments; `framecode.js` takes the absolute
fixtures folder as its second argument on the desktop and must return
`bad: []`.

**What to drive with:**

- **`window.videoEditor`** (`src/automation.ts`): `import([{ name, src }])`
  with an absolute path, `exec(command, args)`, `describe()`, `project()`,
  `seek(frame)`, `rendered()`, `pixels()`, `platform()`.
- **The platform module itself.** In dev,
  `await import("/src/platform/index.ts")` inside `page.evaluate` returns
  the instance the app uses (Vite serves one module graph), so
  `saveProject`, `listProjects`, `createExportTarget` and `adoptFiles` can
  be called directly.
- **mediabunny in the page.** A bare `import("mediabunny")` cannot resolve.
  Read its pre-bundled URL from a module that imports it
  (`fetch("/src/platform/desktop.ts")`, match
  `/node_modules/.vite/deps/mediabunny.js?v=…`) and import that.
- **Raw commands**: `window.__TAURI_INTERNALS__.invoke(cmd, args)`.
- **Verify below the UI**: the files in `scratch/appdata/projects`,
  `ffprobe` on an export or a proxy, a full `ffmpeg -i out.mp4 -f null -`
  decode. The UI agreeing with itself proves nothing.

## Native dialogs

The open and save dialogs are native windows: Playwright cannot see them,
and the `invoke` that opened one waits until it closes.
`scripts/drive/answer-dialog.ps1 <pid> <file>` answers one through UI
Automation: it finds the `#32770` window owned by the app's process, sets
the file name box (AutomationId `1001` in Save, `1148` in Open, exposed as
a *Pane* of class `Edit`) with `WM_SETTEXT` and clicks button `1` with
`BM_CLICK`. Never `SendKeys`: if focus moves, the keys land in someone
else's window.

Start the page side first (the `evaluate` that awaits the dialog), then run
the answerer alongside it. Find the pid by the exe's **path**, never by
name: the main checkout may be running its own `video-editor.exe`.

## OS drops

A real Explorer drag needs the real mouse. Instead, raise the event Tauri
emits for one, which tests everything after the OS:

```js
window.__TAURI_INTERNALS__.invoke("plugin:event|emit_to", {
  target: { kind: "Webview", label: "main" },
  event: "tauri://drag-drop",
  payload: { paths: ["C:\\media\\clip.mp4"], position: { x: 400, y: 400 } },
});
```

## The traps, each one paid for

1. **A Git Bash heredoc collapses `\\` to `\`.** A drive written with
   `cat <<'EOF'` turned `` `${dir}\\${n}` `` into an escaped `` \${n} ``, and
   every import failed on a path ending in `${n}`. Write drive files with an
   editor.
2. **A lost CDP connection does not stop `page.evaluate`.** An export kept
   running in the page after its driver died and wrote a complete file once
   the dialog was answered. Check for leftovers before trusting a rerun.
3. **mediabunny's `Output.cancel()` closes the target's stream; it does not
   abort it**, so the platform sees a finish and commits a truncated file.
   Abort the target first (the export engine does; ADR-012).
4. **Explorer windows are titled `<folder> - File Explorer`** on Windows 11.
   `reveal()` opens one; close only the one you opened, by that name.
5. **A Rust edit rebuilds and relaunches the app** under `tauri dev`: the
   media ids and export jobs in Rust start over, and the page reloads.
6. **Stopping `tauri dev` does not stop its children.** The app exe and Vite
   outlive the shell that started them. Find holders with
   `Get-NetTCPConnection -LocalPort <port> -State Listen` and the exe by
   path, and stop only your own.
7. **Playwright screenshots hide the caret** (`caret: "hide"` is the
   default). Pass `caret: "initial"` to judge where a text caret sits.
8. **To check DOM text against the engine's text**, paint the DOM glyphs a
   color the frame lacks (red), hide the canvas, screenshot, and compare
   the ink line by line with `pixels()` (`scripts/drive/inline-text.js`).
   Single edges scatter a pixel or so; compare averages, at a large size.
9. **Never ship a debug port**: any local process could drive the app. The
   variable belongs in a dev shell, not in config.

## Header interaction check — 2026-10-15

The owner expects the whole header to behave like a desktop caption: drag
to move, double-click to maximize, double-click again to restore. The old
bare `data-tauri-drag-region` attributes matched only direct targets, so
the logo, save-status text and right-side spaces were dead areas. One
`data-tauri-drag-region="deep"` on the header covers all noninteractive
descendants. Remove the nested bare attributes: they would stop ancestor
matching. Tauri 2.12.3's installed `src/window/scripts/drag.js` supplies the
native gesture handling and excludes buttons/inputs. The menubar explicitly
opts out so dropdown padding and separators cannot drag the window.

`scripts/drive/window-header.js` checks the real rendered Home/editor header
with the installed Tauri Windows drag script and official JS API mocks.
Its second argument is `{ drag, mocks }`: `drag` is that script with its
`__TEMPLATE_os_name__` replaced by `'windows'`; `mocks` is
`node_modules/@tauri-apps/api/mocks.js` with its final export statement
removed. Inject both before page initialization in a single init script.
The local `scratch/run-headless-mcp.mjs` supplied these inputs through a
dedicated Playwright MCP stdio session using `--headless --browser msedge
--isolated`; it did not attach to the owner's browser or desktop app.

All 15 checks passed: Home/editor drag targets, one maximize/restore command
per double-click, project renaming, dropdown separators, Shortcuts, and the
maximize button without duplicate dragging. This verifies frontend event
routing with simulated IPC. Native window movement, Windows snap behavior,
and other operating systems remain unverified; no desktop interaction was
attempted after the owner's instruction to stop.
