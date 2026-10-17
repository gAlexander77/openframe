//! Files the webview writes (ADR-012): exports, and dropped `File`s copied
//! into app data. The webview streams positional chunks as raw `invoke`
//! bodies (metadata in headers), Rust writes them into `<dest>.part` and
//! renames it into place on success, so a crash or a cancel never leaves a
//! truncated file under the user's chosen name.

use crate::files;
use std::{
    collections::HashMap,
    fs::File,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    ipc::{InvokeBody, Request},
    Manager,
};
use tauri_plugin_dialog::DialogExt;

struct Job {
    file: Arc<File>,
    part: PathBuf,
    dest: PathBuf,
}

#[derive(Default)]
pub struct Exports {
    next: Mutex<u32>,
    jobs: Mutex<HashMap<u32, Job>>,
    /// Finished exports, so "show in folder" never takes a path from the page.
    done: Mutex<HashMap<u32, PathBuf>>,
}

impl Exports {
    /// Start writing `dest` (through `<dest>.part`); answers the job id.
    pub fn open(&self, dest: PathBuf) -> Result<u32, String> {
        let mut part = dest.clone().into_os_string();
        part.push(".part");
        let part = PathBuf::from(part);
        let file = File::options()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&part)
            .map_err(|e| format!("{}: {e}", part.display()))?;
        let id = {
            let mut n = self.next.lock().unwrap();
            *n += 1;
            *n
        };
        self.jobs.lock().unwrap().insert(
            id,
            Job {
                file: Arc::new(file),
                part,
                dest,
            },
        );
        Ok(id)
    }

    fn file(&self, id: u32) -> Result<Arc<File>, String> {
        let jobs = self.jobs.lock().unwrap();
        Ok(jobs.get(&id).ok_or("unknown export")?.file.clone())
    }

    fn take(&self, id: u32) -> Result<Job, String> {
        let job = self.jobs.lock().unwrap().remove(&id);
        job.ok_or_else(|| "unknown export".into())
    }
}

/// Flush and move into place (`commit`), or delete the partial file. Blocks:
/// the rename may wait out a virus scanner (`files::replace`).
fn complete(job: Job, commit: bool) -> Result<PathBuf, String> {
    let shown = |e: std::io::Error| format!("{}: {e}", job.dest.display());
    let synced = job.file.sync_all();
    drop(job.file); // close before the rename, or Windows answers os error 32
    if !commit {
        std::fs::remove_file(&job.part).map_err(shown)?;
        return Ok(job.dest);
    }
    synced.map_err(shown)?;
    files::replace(&job.part, &job.dest).map_err(shown)?;
    Ok(job.dest)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Begun {
    id: u32,
    display_name: String,
}

/// Ask where to save; `None` when the user cancels. Rust shows the dialog so
/// the page can never pick an arbitrary destination itself.
#[tauri::command]
pub async fn export_begin(
    app: tauri::AppHandle,
    suggested_name: String,
    extension: String,
    exports: tauri::State<'_, Exports>,
) -> Result<Option<Begun>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Export")
        .set_file_name(format!("{suggested_name}.{extension}"))
        .add_filter(extension.to_uppercase(), &[extension.as_str()])
        .blocking_save_file(); // an async command: blocking here is off the main thread
    let Some(picked) = picked else {
        return Ok(None);
    };
    let dest = picked.into_path().map_err(|e| e.to_string())?;
    let display_name = dest
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    Ok(Some(Begun {
        id: exports.open(dest)?,
        display_name,
    }))
}

/// Start an export into `<Videos>/<app name>/` without a dialog: an agent
/// exporting over MCP has no one to answer one. The page names only the
/// file, never the folder, and an existing file is never replaced (" (2)",
/// " (3)"...). `display_name` is the whole path, which the agent reports.
#[tauri::command]
pub async fn export_begin_auto(
    app: tauri::AppHandle,
    suggested_name: String,
    extension: String,
    exports: tauri::State<'_, Exports>,
) -> Result<Begun, String> {
    let plain = |s: &str| {
        !s.is_empty()
            && !s.contains(['/', '\\', ':'])
            && Path::new(s).file_name() == Some(std::ffi::OsStr::new(s))
    };
    if !plain(&suggested_name) || !plain(&extension) {
        return Err("an export needs a plain file name".into());
    }
    let dir = app
        .path()
        .video_dir()
        .map_err(|e| e.to_string())?
        .join(&app.package_info().name);
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let taken = |p: &Path| p.exists() || p.with_extension(format!("{extension}.part")).exists();
    let dest = (1..)
        .map(|n| match n {
            1 => dir.join(format!("{suggested_name}.{extension}")),
            n => dir.join(format!("{suggested_name} ({n}).{extension}")),
        })
        .find(|p| !taken(p))
        .expect("some numbered name is free");
    Ok(Begun {
        id: exports.open(dest.clone())?,
        display_name: dest.display().to_string(),
    })
}

#[derive(serde::Serialize)]
pub struct Adopted {
    id: u32,
    path: PathBuf,
}

/// Copy a webview `File` (which has no path) into app data: the same writes
/// as an export, into `<local data>/media/`. Media is local data, never
/// Roaming, because it can be gigabytes.
#[tauri::command]
pub async fn adopt_begin(
    app: tauri::AppHandle,
    name: String,
    exports: tauri::State<'_, Exports>,
) -> Result<Adopted, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("media");
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let path = dir.join(format!("{stamp:x}-{}", safe_name(&name)));
    Ok(Adopted {
        id: exports.open(path.clone())?,
        path,
    })
}

/// A file name that cannot climb out of its folder or upset any OS.
fn safe_name(name: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let clean: String = base
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || " ._-()".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect();
    let clean = clean.trim_matches(|c| c == '.' || c == ' ');
    if clean.is_empty() {
        "file".into()
    } else {
        clean.chars().take(120).collect()
    }
}

/// Body = raw bytes; `x-export-id` and `x-position` headers carry the rest.
/// Writes land in call order: an MP4 muxer patches earlier bytes at the end.
#[tauri::command]
pub async fn export_write(
    request: Request<'_>,
    exports: tauri::State<'_, Exports>,
) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected a raw body".into());
    };
    let num = |k: &str| request.headers().get(k)?.to_str().ok()?.parse::<u64>().ok();
    let (Some(id), Some(pos)) = (num("x-export-id"), num("x-position")) else {
        return Err("missing x-export-id / x-position".into());
    };
    let file = exports.file(id as u32)?;
    let bytes = bytes.clone(); // borrowed from the request: one memcpy
    tauri::async_runtime::spawn_blocking(move || write_all_at(&file, &bytes, pos))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_finish(
    id: u32,
    commit: bool,
    exports: tauri::State<'_, Exports>,
) -> Result<(), String> {
    let job = exports.take(id)?;
    let dest = tauri::async_runtime::spawn_blocking(move || complete(job, commit))
        .await
        .map_err(|e| e.to_string())??;
    if commit {
        exports.done.lock().unwrap().insert(id, dest);
    }
    Ok(())
}

/// Show a finished export in the system file manager.
#[tauri::command]
pub async fn export_reveal(id: u32, exports: tauri::State<'_, Exports>) -> Result<(), String> {
    let path = exports
        .done
        .lock()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or("unknown export")?;
    reveal(&path).map_err(|e| format!("{}: {e}", path.display()))
}

/// Open the folder holding `path`, with the file selected where the OS
/// supports it. ponytail: Linux opens the folder without selecting; the
/// FileManager1 D-Bus call would select it.
fn reveal(path: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // explorer parses its own command line: the quotes must be raw.
        std::process::Command::new("explorer")
            .raw_arg(format!("/select,\"{}\"", path.display()))
            .spawn()?;
    }
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg("-R")
        .arg(path)
        .spawn()?;
    #[cfg(all(unix, not(target_os = "macos")))]
    std::process::Command::new("xdg-open")
        .arg(path.parent().unwrap_or(path))
        .spawn()?;
    Ok(())
}

fn write_all_at(f: &File, mut buf: &[u8], mut off: u64) -> std::io::Result<()> {
    while !buf.is_empty() {
        #[cfg(windows)]
        let n = std::os::windows::fs::FileExt::seek_write(f, buf, off)?;
        #[cfg(unix)]
        let n = std::os::unix::fs::FileExt::write_at(f, buf, off)?;
        if n == 0 {
            return Err(std::io::ErrorKind::WriteZero.into());
        }
        buf = &buf[n..];
        off += n as u64;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ve-export-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// The MP4 case: later writes patch earlier offsets, and the file only
    /// appears under its real name once finished.
    #[test]
    fn positional_writes_then_rename() {
        let d = temp_dir("commit");
        let dest = d.join("out.mp4");
        let ex = Exports::default();
        let id = ex.open(dest.clone()).unwrap();
        let f = ex.file(id).unwrap();
        write_all_at(&f, b"HELLO", 4).unwrap();
        write_all_at(&f, b"WORLD", 9).unwrap();
        write_all_at(&f, b"MP4!", 0).unwrap();
        drop(f);
        assert!(!dest.exists(), "nothing under the real name before finish");
        assert_eq!(complete(ex.take(id).unwrap(), true).unwrap(), dest);
        assert_eq!(std::fs::read(&dest).unwrap(), b"MP4!HELLOWORLD");
        assert!(!d.join("out.mp4.part").exists());
        assert!(ex.take(id).is_err(), "a job finishes once");
    }

    #[test]
    fn abort_deletes_the_part_file() {
        let d = temp_dir("abort");
        let ex = Exports::default();
        let id = ex.open(d.join("gone.mp4")).unwrap();
        write_all_at(&ex.file(id).unwrap(), b"partial", 0).unwrap();
        complete(ex.take(id).unwrap(), false).unwrap();
        assert_eq!(std::fs::read_dir(&d).unwrap().count(), 0);
    }

    #[test]
    fn adopted_names_stay_in_their_folder() {
        assert_eq!(safe_name("clip.mp4"), "clip.mp4");
        assert_eq!(safe_name("../../evil.exe"), "evil.exe");
        let n = safe_name(r"C:\Windows\x.dll");
        assert!(n.ends_with("x.dll") && !n.contains(['\\', '/', ':']), "{n}");
        assert_eq!(safe_name("a<b>:c?.mov"), "a_b__c_.mov");
        assert_eq!(safe_name(".."), "file");
        assert_eq!(safe_name(""), "file");
    }
}
