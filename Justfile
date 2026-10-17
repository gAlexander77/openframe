# OpenFrame task runner — run `just` to list recipes.
# Windows: winget install casey.just · macOS: brew install just

# -ExecutionPolicy Bypass: Windows PowerShell 5.1 refuses npm.ps1 under the
# default policy; this applies to the spawned shell only (TermHQ lesson).
set windows-shell := ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"]

default:
    @just --list

# run the desktop app in dev mode (hot reload)
dev:
    npm run tauri dev

# run the web build in a browser at http://localhost:1420
web:
    npm run dev

# every quality gate — run before pushing
check:
    npm run build
    npm test
    cargo fmt --check --manifest-path src-tauri/Cargo.toml
    cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
    cargo test --manifest-path src-tauri/Cargo.toml

# unit tests only
test:
    npm test
    cargo test --manifest-path src-tauri/Cargo.toml

# regenerate the test media in fixtures/media (needs ffmpeg on PATH)
fixtures:
    node scripts/make-fixtures.mjs

# format Rust
fmt:
    cargo fmt --manifest-path src-tauri/Cargo.toml

# build this platform's release installer
build:
    npm run tauri build
