//! Projects on disk (ADR-011): `<app data>/projects/<id>.json`, the previous
//! save as `<id>.json.bak`, and `<id>.summary.json` for the home screen, so
//! listing projects never parses whole timelines. Every write goes to a
//! temporary file first and is moved into place.

use crate::files;
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};
use tauri::Manager;

fn dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let d = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("projects");
    fs::create_dir_all(&d).map_err(|e| format!("{}: {e}", d.display()))?;
    Ok(d)
}

/// Ids become file names, so they must not be able to name anything else.
fn check_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    ok.then_some(())
        .ok_or_else(|| format!("not a project id: {id:?}"))
}

/// Write `bytes` to `path` so that a crash leaves either the old file or the
/// new one, never half of either: temp file, flush to disk, then move.
fn write_atomic(path: &Path, bytes: &[u8], keep_previous: bool) -> io::Result<()> {
    let with = |suffix: &str| {
        let mut p = path.as_os_str().to_owned();
        p.push(suffix);
        PathBuf::from(p)
    };
    let tmp = with(".tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    } // closed before the move, or Windows answers os error 32
    if keep_previous && path.exists() {
        fs::copy(path, with(".bak"))?;
    }
    files::replace(&tmp, path)
}

pub fn save(dir: &Path, id: &str, project: &str, summary: &str) -> Result<(), String> {
    check_id(id)?;
    let shown = |p: &Path, e: io::Error| format!("{}: {e}", p.display());
    let main = dir.join(format!("{id}.json"));
    write_atomic(&main, project.as_bytes(), true).map_err(|e| shown(&main, e))?;
    let sum = dir.join(format!("{id}.summary.json"));
    write_atomic(&sum, summary.as_bytes(), false).map_err(|e| shown(&sum, e))
}

pub fn load(dir: &Path, id: &str) -> Result<String, String> {
    check_id(id)?;
    let p = dir.join(format!("{id}.json"));
    fs::read_to_string(&p).map_err(|e| format!("{}: {e}", p.display()))
}

/// Every summary, newest first. A summary that does not parse (a write cut
/// short before this code existed, a hand edit) is skipped, not fatal.
pub fn list(dir: &Path) -> Result<Vec<serde_json::Value>, String> {
    let mut out: Vec<serde_json::Value> = fs::read_dir(dir)
        .map_err(|e| format!("{}: {e}", dir.display()))?
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().ends_with(".summary.json"))
        .filter_map(|e| serde_json::from_slice(&fs::read(e.path()).ok()?).ok())
        .collect();
    let updated = |v: &serde_json::Value| v["updatedAt"].as_f64().unwrap_or(0.0);
    out.sort_by(|a, b| updated(b).total_cmp(&updated(a)));
    Ok(out)
}

pub fn delete(dir: &Path, id: &str) -> Result<(), String> {
    check_id(id)?;
    for name in [
        format!("{id}.json"),
        format!("{id}.json.bak"),
        format!("{id}.summary.json"),
    ] {
        match fs::remove_file(dir.join(&name)) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(format!("{name}: {e}")),
            _ => {}
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn project_list(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    list(&dir(&app)?)
}

/// The project as JSON text; the webview parses it.
#[tauri::command]
pub async fn project_load(app: tauri::AppHandle, id: String) -> Result<String, String> {
    load(&dir(&app)?, &id)
}

#[tauri::command]
pub async fn project_save(
    app: tauri::AppHandle,
    id: String,
    project: String,
    summary: String,
) -> Result<(), String> {
    save(&dir(&app)?, &id, &project, &summary)
}

#[tauri::command]
pub async fn project_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    delete(&dir(&app)?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ve-project-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn save_list_load_delete() {
        let d = temp_dir("roundtrip");
        save(&d, "p_old", r#"{"v":1}"#, r#"{"id":"p_old","updatedAt":1}"#).unwrap();
        save(&d, "p_new", r#"{"v":2}"#, r#"{"id":"p_new","updatedAt":2}"#).unwrap();
        let ids: Vec<_> = list(&d).unwrap().iter().map(|v| v["id"].clone()).collect();
        assert_eq!(ids, ["p_new", "p_old"], "newest first");
        assert_eq!(load(&d, "p_old").unwrap(), r#"{"v":1}"#);

        delete(&d, "p_old").unwrap();
        assert_eq!(list(&d).unwrap().len(), 1);
        assert!(load(&d, "p_old").is_err());
        delete(&d, "p_old").unwrap(); // deleting twice is fine
    }

    #[test]
    fn a_save_replaces_and_keeps_the_previous_version() {
        let d = temp_dir("bak");
        save(&d, "p1", "first", "{}").unwrap();
        save(&d, "p1", "second", "{}").unwrap();
        assert_eq!(load(&d, "p1").unwrap(), "second");
        assert_eq!(fs::read_to_string(d.join("p1.json.bak")).unwrap(), "first");
        let leftovers: Vec<_> = fs::read_dir(&d)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "no temp files left behind");
    }

    #[test]
    fn a_broken_summary_is_skipped() {
        let d = temp_dir("broken");
        save(&d, "good", "{}", r#"{"id":"good","updatedAt":1}"#).unwrap();
        fs::write(d.join("cut.summary.json"), r#"{"id":"cu"#).unwrap();
        assert_eq!(list(&d).unwrap().len(), 1);
    }

    #[test]
    fn ids_cannot_escape_the_folder() {
        let d = temp_dir("ids");
        for bad in [
            "",
            "../evil",
            "a/b",
            r"a\b",
            "C:",
            "x.json",
            &"a".repeat(65),
        ] {
            assert!(save(&d, bad, "{}", "{}").is_err(), "{bad:?} accepted");
            assert!(load(&d, bad).is_err());
            assert!(delete(&d, bad).is_err());
        }
        save(&d, "p_0a9F-x", "{}", "{}").unwrap();
    }
}
