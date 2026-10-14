mod media;

use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(media::Media::default()))
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
        .invoke_handler(tauri::generate_handler![media::media_register])
        .run(tauri::generate_context!())
        .expect("error while running the application");
}
