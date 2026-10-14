# Renaming the application

"Video Editor" is a placeholder. This is the checklist for the rename, kept
current as sites are added, so the rename is an afternoon rather than an
archaeology dig (TermHQ's rename went exactly that way).

## 1. The bundle identifier moves every user's data — read first

`src-tauri/tauri.conf.json` → `"identifier": "com.alex.video-editor"`.

Tauri derives the app config, data and cache directories from the identifier,
so on Windows that string *is* the folder (`%APPDATA%\com.alex.video-editor`).
Change it alone and every install looks factory-fresh: settings, recent
projects and autosaves orphaned. Ship the rename with a one-time migration
that moves the old folder (TermHQ's `migrate.rs` is the template).

The web build keeps projects in the origin's IndexedDB and OPFS, keyed by
the database name in `src/platform/web.ts`. Renaming that database name
orphans browser projects the same way.

## 2. Find-and-replace sites

| Site | What |
|---|---|
| `src/lib/brand.ts` | `APP_NAME`, `PROJECT_EXT` (old extension must keep opening) |
| `src-tauri/tauri.conf.json` | `productName`, `mainBinaryName`, window `title`, `identifier` (§1) |
| `src-tauri/Cargo.toml` | package `name`, `description`, lib name `video_editor_lib` |
| `src-tauri/src/main.rs` | `video_editor_lib::run()` |
| `package.json` | `name` |
| `index.html` | `<title>` |
| `README.md`, `CLAUDE.md`, `docs/Index.md` | headings and prose |
| `assets/app-icon.svg` | regenerate icons with `npx tauri icon assets/app-icon.svg` |
| GitHub repository | `gAlexander77/video-editor` — GitHub redirects the old URL |
