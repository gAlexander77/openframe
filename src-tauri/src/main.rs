// Prevents an additional console window on Windows in release. Debug builds
// keep the console so `println!` diagnostics stay visible during development.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // An MCP client launches the exe with --mcp-stdio and talks over the
    // pipes it hands over (they are inherited even by a windows-subsystem
    // build); no window opens.
    if std::env::args().any(|a| a == "--mcp-stdio") {
        return video_editor_lib::run_mcp_stdio_bridge();
    }
    video_editor_lib::run()
}
