// Prevents an additional console window on Windows in release. Debug builds
// keep the console so `println!` diagnostics stay visible during development.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    video_editor_lib::run()
}
