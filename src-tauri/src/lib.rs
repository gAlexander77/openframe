mod export;
mod ffmpeg;
mod files;
mod mcp;
mod media;
mod project;

use std::sync::Arc;
use tauri::Manager;

/// `video-editor --mcp-stdio`: be an MCP stdio server that forwards to the
/// running app (ADR-009), instead of opening a window.
pub fn run_mcp_stdio_bridge() {
    mcp::run_stdio_bridge()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(media::Media::default()))
        .manage(export::Exports::default())
        .manage(ffmpeg::Ffmpeg::default())
        .manage(mcp::Mcp::default())
        .register_asynchronous_uri_scheme_protocol("media", |ctx, request, responder| {
            let media = ctx
                .app_handle()
                .state::<Arc<media::Media>>()
                .inner()
                .clone();
            // File reads stay off the event loop; the responder works from any thread.
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(media::respond(&request, &media))
            });
        })
        .invoke_handler(tauri::generate_handler![
            media::media_register,
            project::project_list,
            project::project_load,
            project::project_save,
            project::project_delete,
            export::export_begin,
            export::adopt_begin,
            export::export_write,
            export::export_finish,
            export::export_reveal,
            ffmpeg::ffmpeg_probe,
            ffmpeg::ffmpeg_proxy,
            ffmpeg::ffmpeg_cancel,
            mcp::mcp_enable,
            mcp::mcp_reply,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // No ffmpeg outlives the app (ADR-013).
                app.state::<ffmpeg::Ffmpeg>().kill_all();
            }
        });
}
