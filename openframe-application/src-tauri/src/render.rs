//! Headless rendering (ADR-029): `openframe --render project.json --out
//! video.mp4` opens the app with its window hidden, the webview exports the
//! project with the same engine as the export dialog, progress goes to
//! stdout as JSON lines, and the process exits 0 on success. This is the
//! entry point for pipelines that make videos without a person: an agent
//! writes the project JSON, this turns it into a file.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::export::Exports;

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RenderJob {
    /// The project JSON, with relative media paths made absolute.
    pub project: String,
    pub out: String,
    pub format: Option<String>,
    pub resolution: Option<String>,
    pub quality: Option<String>,
}

#[derive(Default)]
pub struct Render {
    pub job: Mutex<Option<RenderJob>>,
}

/// What `--render` was asked to do.
#[derive(Debug, PartialEq)]
pub struct RenderArgs {
    pub project: PathBuf,
    pub out: PathBuf,
    pub format: Option<String>,
    pub resolution: Option<String>,
    pub quality: Option<String>,
}

/// Parse `--render <file> --out <file> [--format mp4|webm|mov|mkv]
/// [--resolution 720p|1080p|...] [--quality lower|recommended|higher]`.
pub fn parse_args(args: &[String]) -> Result<Option<RenderArgs>, String> {
    let get = |flag: &str| {
        args.iter()
            .position(|a| a == flag)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    let Some(project) = get("--render") else {
        return Ok(None);
    };
    let out = get("--out").ok_or("--render needs --out <file>")?;
    Ok(Some(RenderArgs {
        project: PathBuf::from(project),
        out: PathBuf::from(out),
        format: get("--format"),
        resolution: get("--resolution"),
        quality: get("--quality"),
    }))
}

/// Make every asset `src` that is a relative path absolute, relative to
/// the project file's folder, so a project and its media can travel as a
/// folder (what an agent naturally writes).
pub fn resolve_assets(json: &str, base: &Path) -> Result<String, String> {
    let mut v: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("project is not valid JSON: {e}"))?;
    if let Some(assets) = v.get_mut("assets").and_then(|a| a.as_array_mut()) {
        for a in assets {
            let Some(src) = a.get("src").and_then(|s| s.as_str()) else {
                continue;
            };
            let p = Path::new(src);
            if src.contains("://") || p.is_absolute() {
                continue;
            }
            a["src"] = serde_json::Value::String(base.join(p).display().to_string());
        }
    }
    Ok(v.to_string())
}

pub fn load_job(a: RenderArgs) -> Result<RenderJob, String> {
    let (project, out) = (a.project.as_path(), a.out.as_path());
    let json = std::fs::read_to_string(project)
        .map_err(|e| format!("cannot read {}: {e}", project.display()))?;
    let base = project.parent().map(Path::to_path_buf).unwrap_or_default();
    let base = std::fs::canonicalize(&base).unwrap_or(base);
    let out = if out.is_absolute() {
        out.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|d| d.join(out))
            .unwrap_or(out.to_path_buf())
    };
    Ok(RenderJob {
        project: resolve_assets(&json, &base)?,
        out: out.display().to_string(),
        format: a.format,
        resolution: a.resolution,
        quality: a.quality,
    })
}

/// The render job, if the app was started to render one.
#[tauri::command]
pub fn render_job(state: State<'_, Render>) -> Option<RenderJob> {
    state.job.lock().unwrap().clone()
}

/// Open the job's output for positional writes. Only the path given on the
/// command line can be opened this way, never one the page picks.
#[tauri::command]
pub fn render_open_out(
    state: State<'_, Render>,
    exports: State<'_, Exports>,
) -> Result<u32, String> {
    let job = state.job.lock().unwrap().clone().ok_or("no render job")?;
    exports.open(PathBuf::from(job.out))
}

/// One progress line on stdout for the calling pipeline.
#[tauri::command]
pub fn render_progress(line: String) {
    println!("{line}");
}

/// Finish: print the last line and exit with the job's result.
#[tauri::command]
pub fn render_done(app: AppHandle, ok: bool, line: String) {
    if ok {
        println!("{line}");
    } else {
        eprintln!("{line}");
    }
    app.exit(if ok { 0 } else { 1 });
}

/// A windows-subsystem exe started from a console has no stdout; attach to
/// the parent's console so progress lines show up there. Pipes (how a
/// pipeline runs it) work either way.
pub fn attach_console() {
    #[cfg(windows)]
    unsafe {
        windows_sys::Win32::System::Console::AttachConsole(
            windows_sys::Win32::System::Console::ATTACH_PARENT_PROCESS,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_render_args() {
        let a: Vec<String> = [
            "app", "--render", "p.json", "--out", "o.mp4", "--format", "webm",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let r = parse_args(&a).unwrap().unwrap();
        assert_eq!(r.project, PathBuf::from("p.json"));
        assert_eq!(r.out, PathBuf::from("o.mp4"));
        assert_eq!(r.format.as_deref(), Some("webm"));
        assert_eq!(r.resolution, None);
        assert!(parse_args(&["app".to_string()]).unwrap().is_none());
        assert!(parse_args(&["app".into(), "--render".into(), "p.json".into()]).is_err());
    }

    #[test]
    fn resolves_relative_media_next_to_the_project() {
        let base = if cfg!(windows) {
            Path::new("C:\\proj")
        } else {
            Path::new("/proj")
        };
        let abs = if cfg!(windows) {
            "D:\\media\\a.mp4"
        } else {
            "/media/a.mp4"
        };
        let json = format!(
            r#"{{"assets":[{{"src":"clips/intro.mp4"}},{{"src":{}}},{{"src":"https://x/y.mp4"}}]}}"#,
            serde_json::json!(abs)
        );
        let out: serde_json::Value =
            serde_json::from_str(&resolve_assets(&json, base).unwrap()).unwrap();
        assert_eq!(
            out["assets"][0]["src"],
            base.join("clips/intro.mp4").display().to_string()
        );
        assert_eq!(out["assets"][1]["src"], abs);
        assert_eq!(out["assets"][2]["src"], "https://x/y.mp4");
    }
}
