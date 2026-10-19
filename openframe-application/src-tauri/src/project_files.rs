//! Portable project copies: the native dialog owns the destination; each
//! collection creates a new directory and never overwrites existing files.
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri_plugin_dialog::DialogExt;

fn rewrite(
    value: &mut Value,
    f: &mut impl FnMut(&str) -> Result<String, String>,
) -> Result<(), String> {
    match value {
        Value::Array(items) => {
            for item in items {
                rewrite(item, f)?;
            }
        }
        Value::Object(fields) => {
            for (key, value) in fields {
                if (key == "src" || key == "proxy") && value.is_string() {
                    *value = Value::String(f(value.as_str().unwrap())?);
                } else {
                    rewrite(value, f)?;
                }
            }
        }
        _ => {}
    }
    Ok(())
}
fn read_project(path: &Path) -> Result<Value, String> {
    if !path.is_absolute()
        || path
            .extension()
            .and_then(|x| x.to_str())
            .is_none_or(|x| !x.eq_ignore_ascii_case("json"))
    {
        return Err("Choose an absolute path to a project JSON file".into());
    }
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > 32 * 1024 * 1024 {
        return Err("Project must be a JSON file under 32 MiB".into());
    }
    let value: Value = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if !value.is_object() {
        return Err("Project must be an object".into());
    }
    Ok(value)
}
fn collect(
    parent: &Path,
    mut value: Value,
    mut progress: impl FnMut(f64),
) -> Result<PathBuf, String> {
    if !parent.is_absolute() || !parent.is_dir() {
        return Err("Choose an existing folder".into());
    }
    let mut sources = HashMap::<String, String>::new();
    rewrite(&mut value, &mut |src| {
        if let Some(relative) = sources.get(src) {
            return Ok(relative.clone());
        }
        let path = Path::new(src);
        if !path.is_absolute() || !fs::metadata(path).is_ok_and(|m| m.is_file()) {
            return Err(format!("Media is missing or is not a local file: {src}"));
        }
        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("bin");
        if !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Err("Invalid media extension".into());
        }
        let relative = format!("media/{:04}.{ext}", sources.len() + 1);
        sources.insert(src.into(), relative.clone());
        Ok(relative)
    })?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let dest = parent.join(format!("OpenFrame-{stamp}"));
    fs::create_dir(&dest).map_err(|e| e.to_string())?;
    let result = (|| {
        fs::create_dir(dest.join("media")).map_err(|e| e.to_string())?;
        progress(0.0);
        for (index, (src, relative)) in sources.iter().enumerate() {
            let mut input = fs::File::open(src).map_err(|e| e.to_string())?;
            let mut output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(dest.join(relative))
                .map_err(|e| e.to_string())?;
            std::io::copy(&mut input, &mut output).map_err(|e| e.to_string())?;
            output.sync_all().map_err(|e| e.to_string())?;
            progress((index + 1) as f64 / (sources.len() + 1) as f64);
        }
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(dest.join("project.json"))
            .map_err(|e| e.to_string())?;
        output
            .write_all(&serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        output.sync_all().map_err(|e| e.to_string())?;
        progress(1.0);
        Ok(dest.join("project.json"))
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&dest);
    }
    result
}
#[tauri::command]
pub async fn project_collect(
    app: tauri::AppHandle,
    project: String,
    progress: tauri::ipc::Channel<f64>,
) -> Result<Option<String>, String> {
    if project.len() > 32 * 1024 * 1024 {
        return Err("Project is too large".into());
    }
    let value: Value = serde_json::from_str(&project).map_err(|e| e.to_string())?;
    if !value.is_object() {
        return Err("Project must be an object".into());
    }
    let Some(folder) = app
        .dialog()
        .file()
        .set_title("Collect files")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let parent = folder.into_path().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        collect(&parent, value, |v| {
            let _ = progress.send(v);
        })
        .map(|p| Some(p.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn project_open_file(
    app: tauri::AppHandle,
    path: Option<String>,
) -> Result<Option<Value>, String> {
    let path = match path {
        Some(path) => PathBuf::from(path),
        None => {
            let Some(file) = app
                .dialog()
                .file()
                .set_title("Open project file")
                .add_filter("Project", &["json"])
                .blocking_pick_file()
            else {
                return Ok(None);
            };
            file.into_path().map_err(|e| e.to_string())?
        }
    };
    tauri::async_runtime::spawn_blocking(move || {
        read_project(&path)
            .map(|project| Some(serde_json::json!({ "project": project, "path": path })))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn copies_deduplicates_and_resolves() {
        let root = std::env::temp_dir().join(format!(
            "openframe-collect-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let src = root.join("source.gif");
        fs::write(&src, b"pixels").unwrap();
        let value = serde_json::json!({"assets":[{"src":src,"proxy":src}],"luts":[]});
        let mut steps = Vec::new();
        let path = collect(&root, value, |v| steps.push(v)).unwrap();
        let saved: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved["assets"][0]["src"], "media/0001.gif");
        assert_eq!(saved["assets"][0]["src"], saved["assets"][0]["proxy"]);
        let opened = read_project(&path).unwrap();
        assert_eq!(
            fs::read(
                path.parent()
                    .unwrap()
                    .join(opened["assets"][0]["src"].as_str().unwrap())
            )
            .unwrap(),
            b"pixels"
        );
        assert_eq!(steps.last(), Some(&1.0));
        assert_eq!(fs::read(&src).unwrap(), b"pixels");
        assert!(collect(
            &root,
            serde_json::json!({"assets":[{"src":"relative.gif"}]}),
            |_| {}
        )
        .is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn refuses_non_project_paths() {
        assert!(read_project(Path::new("relative.json")).is_err());
    }
}
