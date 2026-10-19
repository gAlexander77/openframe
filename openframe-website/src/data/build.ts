// How to build OpenFrame from source: the README's and CONTRIBUTING.md's
// commands, in one place, so the home page and the docs say the same thing.
// When the app moves into openframe-application/, add that `cd` here.

export const CLONE = `git clone https://github.com/gAlexander77/openframe.git
cd openframe`;

export const DESKTOP = `npm ci
npm run tauri dev`;

export const WEB = `npm run dev`;

export const WEB_URL = "http://localhost:1420";

export const RELEASE_BUILD = `npm run tauri build`;

export const CHECKS = `npm run build
npm test
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml`;

export const PREREQUISITES = [
  { name: "Node.js and npm", url: "https://nodejs.org/", note: "for the editor's interface and engine" },
  { name: "Rust", url: "https://www.rust-lang.org/tools/install", note: "for the desktop shell" },
  { name: "Tauri's prerequisites for your system", url: "https://v2.tauri.app/start/prerequisites/", note: "on Windows, WebView2 and the C++ build tools" },
  { name: "FFmpeg and ffprobe on PATH (optional)", url: "https://ffmpeg.org/download.html", note: "for formats the webview cannot decode, such as ProRes and DNxHR" },
];
