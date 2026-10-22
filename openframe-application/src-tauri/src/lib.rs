mod about;
mod agent_cli;
mod export;
mod ffmpeg;
mod files;
mod mcp;
mod media;
mod models;
mod project;
mod project_files;
mod render;

use std::sync::Arc;
use tauri::Manager;

/// `openframe --mcp-stdio`: be an MCP stdio server that forwards to the
/// running app (ADR-009), instead of opening a window.
pub fn run_mcp_stdio_bridge() {
    mcp::run_stdio_bridge()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // `--render project.json --out file`: render headless, then exit (ADR-029).
    let args: Vec<String> = std::env::args().collect();
    let job = match render::parse_args(&args) {
        Ok(Some(a)) => {
            render::attach_console();
            match render::load_job(a) {
                Ok(job) => Some(job),
                Err(e) => {
                    eprintln!("{}", serde_json::json!({ "event": "error", "message": e }));
                    std::process::exit(2);
                }
            }
        }
        Ok(None) => None,
        Err(e) => {
            render::attach_console();
            eprintln!("{}", serde_json::json!({ "event": "error", "message": e }));
            std::process::exit(2);
        }
    };
    let headless = job.is_some();
    tauri::Builder::default()
        .manage(render::Render {
            job: std::sync::Mutex::new(job),
        })
        .setup(move |app| {
            if headless {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(media::Media::default()))
        .manage(export::Exports::default())
        .manage(ffmpeg::Ffmpeg::default())
        .manage(mcp::Mcp::default())
        .on_page_load(|webview, payload| {
            if webview.label() == "main"
                && payload.event() == tauri::webview::PageLoadEvent::Started
            {
                mcp::page_reloading(&webview.app_handle().state::<mcp::Mcp>());
            }
        })
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
            project_files::project_collect,
            project_files::project_open_file,
            project::project_list,
            project::project_load,
            project::project_save,
            project::project_delete,
            export::export_begin,
            export::export_begin_auto,
            export::adopt_begin,
            export::export_write,
            export::export_finish,
            export::export_reveal,
            export::export_sidecar,
            ffmpeg::ffmpeg_probe,
            ffmpeg::ffmpeg_proxy,
            ffmpeg::ffmpeg_playback_proxy,
            ffmpeg::ffmpeg_playback_proxy_info,
            ffmpeg::ffmpeg_delete_playback_proxy,
            ffmpeg::ffmpeg_cancel,
            mcp::mcp_enable,
            mcp::mcp_reply,
            agent_cli::agent_cli_add,
            agent_cli::agent_cli_install_page,
            about::about_open,
            models::model_request,
            render::render_job,
            render::render_open_out,
            render::render_progress,
            render::render_done,
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
