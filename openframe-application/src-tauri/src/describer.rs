//! The app-owned, pinned local vision runtime. No external model service is needed.
use crate::{ffmpeg, files};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Condvar, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, Manager};

const BUILD: &str = "b11529";
const REVISION: &str = "1cd86afb9a95c410a6038ab3b40d8b578c892266";
#[derive(Clone, Copy)]
struct Asset {
    name: &'static str,
    bytes: u64,
    sha256: &'static str,
}
const MODEL: Asset = Asset {
    name: "Qwen3VL-4B-Instruct-Q4_K_M.gguf",
    bytes: 2497281664,
    sha256: "66358cb18bb6b3b1b6675aa412c7a88ef01d228f481184d13668e5201c730a0a",
};
const ENCODER: Asset = Asset {
    name: "mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf",
    bytes: 453974304,
    sha256: "30ba2c7dd3127a4561b6cba9d13d0f711c91bdb38742e2f56d73c8cb596bd06d",
};
fn asset(os: &str, arch: &str) -> Result<Asset, String> {
    let (name, bytes, sha256) = match (os, arch) {
        ("windows", "x86_64") => (
            "llama-b11529-bin-win-vulkan-x64.zip",
            33469593,
            "ee9bba6669b018c303a30acc18c41edc9eff540fa75ec54278970ddf134af5c4",
        ),
        ("windows", "aarch64") => (
            "llama-b11529-bin-win-vulkan-arm64.zip",
            26029736,
            "570ff8eeaebe56a1a02c77f4425c9c0a1bc232f87f94fbdccecd6bbafbd0bae3",
        ),
        ("macos", "aarch64") => (
            "llama-b11529-bin-macos-arm64.tar.gz",
            12084163,
            "da75564de557d5ebcc90ea88e8dead4fd5f4253248ffe2d6340163b97c3a0e96",
        ),
        ("macos", "x86_64") => (
            "llama-b11529-bin-macos-x64.tar.gz",
            11610739,
            "4c5ebc90125845747586cd706ced9cb4c0fcf5d49699b04cf10150d69a7b5805",
        ),
        ("linux", "x86_64") => (
            "llama-b11529-bin-ubuntu-vulkan-x64.tar.gz",
            31791256,
            "89719c08818b5c69ce79d22aa2dd8d812962eeabc5a7c2bd26854f974aa47423",
        ),
        ("linux", "aarch64") => (
            "llama-b11529-bin-ubuntu-vulkan-arm64.tar.gz",
            24993078,
            "431345b39f76d31f94f71b1a4f86a99c5d0ffaccac0d1a39a4eaa8e9a63577e8",
        ),
        _ => return Err(format!("The describer does not support {os}/{arch}")),
    };
    Ok(Asset {
        name,
        bytes,
        sha256,
    })
}
fn current_asset() -> Result<Asset, String> {
    asset(std::env::consts::OS, std::env::consts::ARCH)
}
fn installed(path: &Path, asset: Asset) -> bool {
    path.metadata()
        .is_ok_and(|m| m.is_file() && m.len() == asset.bytes)
}
fn server_binary(dir: &Path) -> Option<PathBuf> {
    let name = format!("llama-server{}", std::env::consts::EXE_SUFFIX);
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        // Do not traverse archive symlinks out of the runtime folder.
        let kind = entry.file_type().ok()?;
        if kind.is_file() && entry.file_name() == name.as_str() {
            return Some(path);
        }
        if kind.is_dir() {
            if let Some(p) = server_binary(&path) {
                return Some(p);
            }
        }
    }
    None
}
fn runtime_dir(root: &Path) -> PathBuf {
    root.join("runtime").join(BUILD)
}
fn runtime_installed(root: &Path) -> bool {
    fs::read_to_string(runtime_dir(root).join(".verified")).is_ok_and(|s| s == BUILD)
        && server_binary(&runtime_dir(root)).is_some()
}
fn model_path(root: &Path, a: Asset) -> PathBuf {
    root.join("models").join(a.name)
}
fn sha256(path: &Path) -> Result<String, String> {
    let mut f = File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buf = [0; 65536];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn system_tool(name: &str) -> PathBuf {
    #[cfg(windows)]
    {
        PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()))
            .join("System32")
            .join(format!("{name}.exe"))
    }
    #[cfg(not(windows))]
    {
        name.into()
    }
}

fn part_path(dest: &Path) -> PathBuf {
    dest.with_file_name(format!(
        "{}.part",
        dest.file_name().unwrap().to_string_lossy()
    ))
}
fn part_bytes(dest: &Path, a: Asset) -> u64 {
    part_path(dest)
        .metadata()
        .map(|m| m.len().min(a.bytes))
        .unwrap_or(0)
}
fn curl_args(part_exists: bool) -> Vec<&'static str> {
    let mut args = vec!["-fL", "--retry", "3", "--silent", "--show-error"];
    if part_exists {
        args.extend(["-C", "-"]);
    }
    args.push("-o");
    args
}
fn verify_download(path: &Path, a: Asset) -> Result<(), String> {
    if installed(path, a) && sha256(path)? == a.sha256 {
        return Ok(());
    }
    fs::remove_file(path).map_err(|e| e.to_string())?;
    Err(format!(
        "Size or SHA-256 verification failed for {}; the partial download was removed",
        a.name
    ))
}
#[derive(Default)]
struct DownloadRun {
    epoch: u64,
    bytes: u64,
    total: u64,
}
fn disk_budget(needed: u64, free: u64, drive: &str) -> Result<(), String> {
    let required = needed.saturating_add(512 * 1024 * 1024);
    if free < required {
        return Err(format!(
            "The describer needs {:.2} GB free on {drive}; {:.2} GB is free",
            required as f64 / 1e9,
            free as f64 / 1e9
        ));
    }
    Ok(())
}
fn check_disk(root: &Path, needed: u64) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let path: Vec<u16> = root.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut free = 0;
        // SAFETY: path is null-terminated and free is a live output buffer.
        if unsafe {
            GetDiskFreeSpaceExW(
                path.as_ptr(),
                &mut free,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(format!(
                "Could not check describer disk space: {}",
                std::io::Error::last_os_error()
            ));
        }
        let drive = root
            .components()
            .next()
            .map(|p| p.as_os_str().to_string_lossy().into_owned())
            .unwrap_or_default();
        disk_budget(needed, free, &drive)
    }
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let path =
            std::ffi::CString::new(root.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
        let mut stat = std::mem::MaybeUninit::<libc::statvfs>::uninit();
        // SAFETY: path is null-terminated; statvfs initializes stat on success.
        if unsafe { libc::statvfs(path.as_ptr(), stat.as_mut_ptr()) } != 0 {
            return Err(format!(
                "Could not check describer disk space: {}",
                std::io::Error::last_os_error()
            ));
        }
        // SAFETY: statvfs returned success.
        let stat = unsafe { stat.assume_init() };
        let free = u64::try_from(u128::from(stat.f_bavail) * u128::from(stat.f_frsize))
            .unwrap_or(u64::MAX);
        disk_budget(needed, free, &root.display().to_string())
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct DescriberStatus {
    state: String,
    runtime_installed: bool,
    model_installed: bool,
    bytes_needed: u64,
    device: Option<String>,
    error: Option<String>,
}
#[derive(Serialize, Clone)]
pub struct PrepareProgress {
    stage: String,
    fraction: f64,
    bytes: u64,
    total: u64,
}
#[derive(Deserialize)]
pub struct AskRequest {
    pub images: Vec<String>,
    pub prompt: String,
    pub schema: Option<Value>,
    pub max_tokens: Option<u32>,
}
struct Server {
    child: Child,
    port: u16,
    key: String,
}
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
struct Inner {
    state: String,
    error: Option<String>,
    device: Option<String>,
    server: Option<Server>,
    preparation: Option<Arc<Preparation>>,
    listeners: Vec<Channel<PrepareProgress>>,
    progress: Option<PrepareProgress>,
    last_ask: Instant,
}
impl Default for Inner {
    fn default() -> Self {
        Self {
            state: "missing".into(),
            error: None,
            device: None,
            server: None,
            preparation: None,
            listeners: Vec::new(),
            progress: None,
            last_ask: Instant::now(),
        }
    }
}
#[derive(Default)]
struct Preparation {
    result: Mutex<Option<Result<DescriberStatus, String>>>,
    finished: Condvar,
}
#[derive(Default)]
pub struct Describer {
    inner: Mutex<Inner>,
    operation: Mutex<()>,
    asks: Mutex<usize>,
    available: Condvar,
    epoch: AtomicU64,
    #[cfg(windows)]
    job: ffmpeg::job::KillOnClose,
}
struct AskPermit<'a>(&'a Describer);
impl Drop for AskPermit<'_> {
    fn drop(&mut self) {
        let mut active = self.0.asks.lock().unwrap();
        self.0.inner.lock().unwrap().last_ask = Instant::now();
        *active -= 1;
        self.0.available.notify_one();
    }
}
impl Describer {
    fn acquire_ask(&self) -> AskPermit<'_> {
        let mut active = self.asks.lock().unwrap();
        while *active >= 2 {
            active = self.available.wait(active).unwrap();
        }
        *active += 1;
        AskPermit(self)
    }
    fn assign(&self, child: &Child) {
        #[cfg(windows)]
        self.job.assign(child);
        #[cfg(not(windows))]
        let _ = child;
    }
    fn check_epoch(&self, epoch: u64) -> Result<(), String> {
        if self.epoch.load(Ordering::SeqCst) != epoch {
            Err("The describer was stopped".into())
        } else {
            Ok(())
        }
    }
    fn status(&self, root: &Path) -> DescriberStatus {
        let runtime_installed = runtime_installed(root);
        let model_installed = installed(&model_path(root, MODEL), MODEL)
            && installed(&model_path(root, ENCODER), ENCODER);
        let bytes_needed = if runtime_installed {
            0
        } else {
            current_asset().map(|a| a.bytes).unwrap_or(0)
        } + [MODEL, ENCODER]
            .iter()
            .filter(|&&a| !installed(&model_path(root, a), a))
            .map(|a| a.bytes)
            .sum::<u64>();
        let mut i = self.inner.lock().unwrap();
        if i.server
            .as_mut()
            .is_some_and(|s| s.child.try_wait().ok().flatten().is_some())
        {
            i.server = None;
            i.state = "error".into();
            i.error = Some(server_error(root, "The describer exited"));
        }
        let state = if matches!(i.state.as_str(), "downloading" | "starting" | "error") {
            i.state.clone()
        } else if !runtime_installed || !model_installed {
            "missing".into()
        } else if i.server.is_some() {
            "ready".into()
        } else {
            "stopped".into()
        };
        DescriberStatus {
            state,
            runtime_installed,
            model_installed,
            bytes_needed,
            device: i.device.clone(),
            error: i.error.clone(),
        }
    }
    fn progress(&self, stage: &str, bytes: u64, total: u64) {
        let p = PrepareProgress {
            stage: stage.into(),
            fraction: if total == 0 {
                0.0
            } else {
                (bytes as f64 / total as f64).clamp(0.0, 1.0)
            },
            bytes,
            total,
        };
        let mut i = self.inner.lock().unwrap();
        i.progress = Some(p.clone());
        i.listeners.retain(|c| c.send(p.clone()).is_ok());
    }
    pub fn stop(&self) {
        self.epoch.fetch_add(1, Ordering::SeqCst);
        let mut i = self.inner.lock().unwrap();
        i.server = None;
        i.state = "stopped".into();
        i.error = None;
    }
    pub fn idle_timer(this: &Arc<Self>) {
        let weak = Arc::downgrade(this);
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(15));
            let Some(this) = weak.upgrade() else {
                break;
            };
            if let Ok(_op) = this.operation.try_lock() {
                let active = this.asks.lock().unwrap();
                let mut i = this.inner.lock().unwrap();
                if *active == 0
                    && i.server.is_some()
                    && i.last_ask.elapsed() >= Duration::from_secs(600)
                {
                    i.server = None;
                    i.state = "stopped".into();
                }
            };
        });
    }
    fn download(
        &self,
        root: &Path,
        a: Asset,
        url: &str,
        dest: &Path,
        run: &mut DownloadRun,
    ) -> Result<(), String> {
        let stage = if a.name.ends_with(".gguf") {
            "model"
        } else {
            "runtime"
        };
        fs::create_dir_all(dest.parent().ok_or("Invalid download path")?)
            .map_err(|e| e.to_string())?;
        let part = part_path(dest);
        let base = run.bytes.saturating_sub(part_bytes(dest, a));
        // A completed part can survive a stop just before its atomic rename.
        if part.metadata().is_ok_and(|m| m.len() >= a.bytes) {
            verify_download(&part, a)?;
            self.check_epoch(run.epoch)?;
            files::replace(&part, dest).map_err(|e| e.to_string())?;
            run.bytes = base + a.bytes;
            self.progress(stage, run.bytes, run.total);
            return Ok(());
        }
        let errors = File::create(root.join("download.log")).map_err(|e| e.to_string())?;
        let mut child = ffmpeg::command(&system_tool("curl"))
            .args(curl_args(part.exists()))
            .arg(&part)
            .arg(url)
            .stdout(Stdio::null())
            .stderr(errors)
            .spawn()
            .map_err(|e| format!("Could not start curl: {e}"))?;
        self.assign(&child);
        let result = (|| {
            loop {
                self.check_epoch(run.epoch)?;
                self.progress(stage, base + part_bytes(dest, a), run.total);
                if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                    if !status.success() {
                        return Err(format!(
                            "Could not download {}: {}",
                            a.name,
                            fs::read_to_string(root.join("download.log")).unwrap_or_default()
                        ));
                    }
                    break;
                }
                std::thread::sleep(Duration::from_millis(250));
            }
            verify_download(&part, a)?;
            self.check_epoch(run.epoch)?;
            files::replace(&part, dest).map_err(|e| e.to_string())?;
            run.bytes = base + a.bytes;
            self.progress(stage, run.bytes, run.total);
            Ok(())
        })();
        if result.is_err() {
            let _ = child.kill();
            let _ = child.wait();
        }
        result
    }
    fn install(&self, root: &Path, epoch: u64) -> Result<(), String> {
        fs::create_dir_all(root).map_err(|e| e.to_string())?;
        self.inner.lock().unwrap().state = "downloading".into();
        let runtime = current_asset()?;
        let archive = root.join(runtime.name);
        let needs_runtime = !runtime_installed(root);
        let needs_archive =
            needs_runtime && (!installed(&archive, runtime) || sha256(&archive)? != runtime.sha256);
        let mut missing = Vec::new();
        if needs_archive {
            missing.push((archive.clone(), runtime));
        }
        for a in [MODEL, ENCODER] {
            let dest = model_path(root, a);
            if !installed(&dest, a) {
                missing.push((dest, a));
            }
        }
        let mut run = DownloadRun {
            epoch,
            total: missing.iter().map(|(_, a)| a.bytes).sum(),
            bytes: missing.iter().map(|(dest, a)| part_bytes(dest, *a)).sum(),
        };
        if !missing.is_empty() {
            check_disk(root, run.total.saturating_sub(run.bytes))?;
        }
        self.progress(
            if needs_runtime { "runtime" } else { "model" },
            run.bytes,
            run.total,
        );
        if needs_runtime {
            let a = runtime;
            // A verified archive may survive an interrupted extraction.
            if needs_archive {
                self.download(
                    root,
                    a,
                    &format!(
                        "https://github.com/ggml-org/llama.cpp/releases/download/{BUILD}/{}",
                        a.name
                    ),
                    &archive,
                    &mut run,
                )?;
            }
            let dir = runtime_dir(root);
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let log = File::create(root.join("extract.log")).map_err(|e| e.to_string())?;
            let mut child = ffmpeg::command(&system_tool("tar"))
                .arg("-xf")
                .arg(&archive)
                .arg("-C")
                .arg(&dir)
                .stdout(Stdio::null())
                .stderr(log)
                .spawn()
                .map_err(|e| format!("Could not start tar: {e}"))?;
            self.assign(&child);
            let status = loop {
                if let Err(e) = self.check_epoch(epoch) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(e);
                }
                if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
                    break s;
                }
                std::thread::sleep(Duration::from_millis(100));
            };
            if !status.success() || server_binary(&dir).is_none() {
                return Err(format!(
                    "Could not unpack the describer runtime: {}",
                    fs::read_to_string(root.join("extract.log")).unwrap_or_default()
                ));
            }
            fs::write(dir.join(".verified"), BUILD).map_err(|e| e.to_string())?;
            let _ = fs::remove_file(archive);
        }
        for a in [MODEL, ENCODER] {
            let dest = model_path(root, a);
            if !installed(&dest, a) {
                self.download(root, a, &format!("https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/{REVISION}/{}", a.name), &dest, &mut run)?;
            }
        }
        Ok(())
    }
    fn start(&self, root: &Path, epoch: u64) -> Result<(), String> {
        self.check_epoch(epoch)?;
        if self.status(root).state == "ready" {
            return Ok(());
        }
        let status = self.status(root);
        if !status.runtime_installed || !status.model_installed {
            return Err("The describer is not installed; prepare it first".into());
        }
        {
            let mut i = self.inner.lock().unwrap();
            i.state = "starting".into();
            i.error = None;
        }
        let (bytes, total) = self
            .inner
            .lock()
            .unwrap()
            .progress
            .as_ref()
            .map(|p| (p.bytes, p.total))
            .unwrap_or((0, 0));
        self.progress("starting", bytes, total);
        let binary = server_binary(&runtime_dir(root))
            .ok_or("The describer runtime is missing llama-server")?;
        let log_path = root.join("server.log");
        let log = File::create(&log_path).map_err(|e| e.to_string())?;
        // Device discovery can print to either stream; keep both out of a bounded pipe.
        let mut child = ffmpeg::command(&binary)
            .arg("--list-devices")
            .stdout(log.try_clone().map_err(|e| e.to_string())?)
            .stderr(log)
            .spawn()
            .map_err(|e| e.to_string())?;
        self.assign(&child);
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            if let Err(e) = self.check_epoch(epoch) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(e);
            }
            if child.try_wait().map_err(|e| e.to_string())?.is_some() {
                break;
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                return Err(server_error(root, "Device discovery timed out"));
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let device = if cfg!(target_os = "macos") {
            None
        } else {
            choose_device(&fs::read_to_string(&log_path).unwrap_or_default())
        };
        let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        drop(listener);
        let key = api_key()?;
        let log = File::create(&log_path).map_err(|e| e.to_string())?;
        let mut command = ffmpeg::command(&binary);
        command
            .arg("-m")
            .arg(model_path(root, MODEL))
            .arg("--mmproj")
            .arg(model_path(root, ENCODER));
        if let Some(dev) = &device {
            command.args(["--device", dev]);
        }
        command.args([
            "-ngl",
            "99",
            "-c",
            "8192",
            "-np",
            "2",
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
            "--no-webui",
            "--api-key",
            &key,
        ]);
        command
            .stdout(log.try_clone().map_err(|e| e.to_string())?)
            .stderr(log);
        let child = command.spawn().map_err(|e| e.to_string())?;
        self.assign(&child);
        {
            let mut i = self.inner.lock().unwrap();
            // Stop may have arrived while spawning, before the child was published.
            if let Err(e) = self.check_epoch(epoch) {
                drop(Server { child, port, key });
                return Err(e);
            }
            i.server = Some(Server {
                child,
                port,
                key: key.clone(),
            });
            i.device = device;
        }
        let deadline = Instant::now() + Duration::from_secs(180);
        loop {
            self.check_epoch(epoch)?;
            let alive = {
                let mut i = self.inner.lock().unwrap();
                i.server
                    .as_mut()
                    .is_some_and(|s| matches!(s.child.try_wait(), Ok(None)))
            };
            if !alive {
                return Err(server_error(root, "The describer exited while starting"));
            }
            if http(port, "GET", "/health", &key, "", Duration::from_secs(2)).is_ok_and(
                |(code, body)| {
                    code == 200
                        && serde_json::from_str::<Value>(&body).is_ok_and(|v| v["status"] == "ok")
                },
            ) {
                let mut i = self.inner.lock().unwrap();
                self.check_epoch(epoch)?;
                i.state = "ready".into();
                i.last_ask = Instant::now();
                drop(i);
                self.progress("starting", total, total);
                return Ok(());
            }
            if Instant::now() >= deadline {
                self.inner.lock().unwrap().server = None;
                return Err(server_error(
                    root,
                    "The describer did not become ready within 180 seconds",
                ));
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    }
    fn prepare(
        &self,
        root: &Path,
        channel: Channel<PrepareProgress>,
    ) -> Result<DescriberStatus, String> {
        let (preparation, leader) = {
            let mut i = self.inner.lock().unwrap();
            if let Some(p) = &i.progress {
                let _ = channel.send(p.clone());
            }
            i.listeners.push(channel);
            if let Some(preparation) = &i.preparation {
                (preparation.clone(), false)
            } else {
                let preparation = Arc::new(Preparation::default());
                i.preparation = Some(preparation.clone());
                i.error = None;
                (preparation, true)
            }
        };
        if !leader {
            let mut result = preparation.result.lock().unwrap();
            while result.is_none() {
                result = preparation.finished.wait(result).unwrap();
            }
            return result.clone().expect("finished preparation");
        }
        let epoch = self.epoch.load(Ordering::SeqCst);
        let _op = self.operation.lock().unwrap();
        let result: Result<DescriberStatus, String> = (|| {
            self.check_epoch(epoch)?;
            if self.status(root).state != "ready" {
                self.install(root, epoch)?;
                self.start(root, epoch)?;
            }
            Ok(self.status(root))
        })();
        let mut i = self.inner.lock().unwrap();
        if let Err(e) = &result {
            if self.check_epoch(epoch).is_ok() {
                i.state = "error".into();
                i.error = Some(e.clone());
            }
            i.server = None;
        }
        *preparation.result.lock().unwrap() = Some(result.clone());
        i.preparation = None;
        i.listeners.clear();
        i.progress = None;
        preparation.finished.notify_all();
        result
    }
    // Callers hold operation only while changing the server, never during inference.
    fn start_checked(&self, root: &Path, epoch: u64) -> Result<(), String> {
        if let Err(e) = self.start(root, epoch) {
            let mut i = self.inner.lock().unwrap();
            if self.check_epoch(epoch).is_ok() {
                i.state = "error".into();
                i.error = Some(e.clone());
                i.server = None;
            }
            return Err(e);
        }
        Ok(())
    }
    fn ask(&self, root: &Path, request: AskRequest) -> Result<String, String> {
        let epoch = self.epoch.load(Ordering::SeqCst);
        let _permit = self.acquire_ask();
        {
            let _op = self.operation.lock().unwrap();
            self.start_checked(root, epoch)?;
        }
        let body = ask_body(request).to_string();
        for attempt in 0..2 {
            self.check_epoch(epoch)?;
            let endpoint = {
                let i = self.inner.lock().unwrap();
                i.server.as_ref().map(|s| (s.port, s.key.clone()))
            };
            // Status may have reaped a dead server between startup and this snapshot.
            let key = endpoint.as_ref().map(|(_, key)| key.as_str());
            let result = match &endpoint {
                Some((port, key)) => http(
                    *port,
                    "POST",
                    "/v1/chat/completions",
                    key,
                    &body,
                    Duration::from_secs(120),
                )
                .and_then(|(code, body)| answer(code, &body).map_err(HttpError::from)),
                None => Err(HttpError::from("The describer exited")),
            };
            self.check_epoch(epoch)?;
            match result {
                Ok(answer) => return Ok(answer),
                Err(error) => {
                    let exited = {
                        let mut i = self.inner.lock().unwrap();
                        i.server.as_mut().is_none_or(|s| {
                            Some(s.key.as_str()) != key
                                || s.child.try_wait().ok().flatten().is_some()
                        })
                    };
                    if !retry_ask(&error, exited, attempt) {
                        return Err(if attempt == 1 || exited {
                            server_error(root, &error.message)
                        } else {
                            error.message
                        });
                    }
                    let _op = self.operation.lock().unwrap();
                    self.check_epoch(epoch)?;
                    {
                        let mut i = self.inner.lock().unwrap();
                        // Another failed ask may already have restarted this server.
                        if i.server
                            .as_ref()
                            .is_some_and(|s| Some(s.key.as_str()) == key)
                        {
                            i.server = None;
                            i.state = "stopped".into();
                        }
                    }
                    self.start_checked(root, epoch)
                        .map_err(|e| server_error(root, &e))?;
                }
            }
        }
        unreachable!("each ask has at most one retry")
    }
}
fn server_error(root: &Path, message: &str) -> String {
    // Read only a bounded tail, even after a long session.
    use std::io::{Seek, SeekFrom};
    let tail = (|| -> std::io::Result<String> {
        let mut f = File::open(root.join("server.log"))?;
        let size = f.metadata()?.len();
        f.seek(SeekFrom::Start(size.saturating_sub(8192)))?;
        let mut bytes = Vec::new();
        f.read_to_end(&mut bytes)?;
        let text = String::from_utf8_lossy(&bytes);
        let lines: Vec<_> = text.lines().collect();
        Ok(lines[lines.len().saturating_sub(12)..].join("\n"))
    })()
    .unwrap_or_default();
    format!("{message}\n{tail}")
}
fn choose_device(output: &str) -> Option<String> {
    let devices: Vec<_> = output
        .lines()
        .filter_map(|line| {
            let (id, rest) = line.trim().split_once(':')?;
            if !id.starts_with("Vulkan")
                || !id[6..].chars().all(|c| c.is_ascii_digit())
                || id.len() == 6
            {
                return None;
            }
            let free = rest
                .split(" MiB free")
                .next()?
                .rsplit([' ', ','])
                .find(|s| !s.is_empty())?
                .parse::<u64>()
                .unwrap_or(0);
            let name = rest.rsplit_once(" (").map(|(name, _)| name).unwrap_or(rest);
            let lower = name.to_lowercase();
            let intel_integrated = lower.contains("intel(r)")
                && lower.contains("graphics")
                && !lower.contains("arc a");
            let amd_integrated = lower.contains("amd radeon(tm) graphics")
                && !lower.chars().any(|c| c.is_ascii_digit());
            let integrated = intel_integrated
                || amd_integrated
                || lower.contains("microsoft basic render")
                || lower.contains("llvmpipe");
            Some((id.to_string(), free, integrated))
        })
        .collect();
    devices
        .iter()
        .filter(|d| !d.2)
        .max_by_key(|d| d.1)
        .or_else(|| devices.first())
        .map(|d| d.0.clone())
}
fn api_key() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    #[cfg(windows)]
    {
        #[link(name = "bcrypt")]
        extern "system" {
            fn BCryptGenRandom(
                algorithm: *mut std::ffi::c_void,
                buffer: *mut u8,
                length: u32,
                flags: u32,
            ) -> i32;
        }
        // SAFETY: the system RNG writes exactly 16 bytes into a live buffer.
        let status = unsafe { BCryptGenRandom(std::ptr::null_mut(), bytes.as_mut_ptr(), 16, 2) };
        if status < 0 {
            return Err("Could not generate the describer API key".into());
        }
    }
    #[cfg(not(windows))]
    File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut bytes))
        .map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn ask_body(request: AskRequest) -> Value {
    let mut content = vec![json!({"type":"text", "text": request.prompt})];
    content.extend(request.images.into_iter().map(|image| json!({"type":"image_url", "image_url":{"url":format!("data:image/jpeg;base64,{image}")}})));
    let mut body = json!({"messages":[{"role":"user", "content":content}], "temperature":0.2, "max_tokens":request.max_tokens.unwrap_or(300), "repeat_penalty":1.1});
    if let Some(schema) = request.schema {
        body["response_format"] =
            json!({"type":"json_schema", "json_schema":{"name":"moment", "schema":schema}});
    }
    body
}
fn answer(code: u16, body: &str) -> Result<String, String> {
    let value: Value = serde_json::from_str(body)
        .map_err(|e| format!("Invalid describer response (HTTP {code}): {e}"))?;
    if let Some(e) = value["error"]["message"].as_str() {
        return Err(e.into());
    }
    if !(200..300).contains(&code) {
        return Err(format!("The describer answered HTTP {code}: {body}"));
    }
    value["choices"][0]["message"]["content"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "The describer returned no answer text".into())
}
fn unchunk(mut bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut body = Vec::new();
    loop {
        let end = bytes
            .windows(2)
            .position(|w| w == b"\r\n")
            .ok_or("Invalid HTTP chunk size")?;
        let size = std::str::from_utf8(&bytes[..end])
            .map_err(|e| e.to_string())?
            .split(';')
            .next()
            .unwrap_or("")
            .trim();
        let n = usize::from_str_radix(size, 16).map_err(|_| "Invalid HTTP chunk size")?;
        bytes = &bytes[end + 2..];
        if n == 0 {
            return Ok(body);
        }
        if n > bytes.len().saturating_sub(2) || &bytes[n..n + 2] != b"\r\n" {
            return Err("Truncated HTTP chunk".into());
        }
        body.extend_from_slice(&bytes[..n]);
        bytes = &bytes[n + 2..];
    }
}
fn parse_http(raw: &[u8]) -> Result<(u16, String), String> {
    let end = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or("Invalid HTTP response")?;
    let headers = std::str::from_utf8(&raw[..end]).map_err(|e| e.to_string())?;
    let status = headers
        .lines()
        .next()
        .and_then(|s| s.split_whitespace().nth(1))
        .and_then(|s| s.parse().ok())
        .ok_or("Missing HTTP status")?;
    let chunked = headers
        .lines()
        .filter_map(|s| s.split_once(':'))
        .any(|(k, v)| {
            k.eq_ignore_ascii_case("transfer-encoding")
                && v.split(',')
                    .any(|s| s.trim().eq_ignore_ascii_case("chunked"))
        });
    let body = &raw[end + 4..];
    let body = if chunked {
        unchunk(body)?
    } else {
        body.to_vec()
    };
    Ok((status, String::from_utf8(body).map_err(|e| e.to_string())?))
}
#[derive(Debug)]
struct HttpError {
    message: String,
    connection_lost: bool,
}
impl From<std::io::Error> for HttpError {
    fn from(error: std::io::Error) -> Self {
        Self {
            connection_lost: matches!(
                error.kind(),
                std::io::ErrorKind::ConnectionRefused | std::io::ErrorKind::ConnectionReset
            ),
            message: error.to_string(),
        }
    }
}
impl From<String> for HttpError {
    fn from(message: String) -> Self {
        Self {
            message,
            connection_lost: false,
        }
    }
}
impl From<&str> for HttpError {
    fn from(message: &str) -> Self {
        message.to_owned().into()
    }
}
fn retry_ask(error: &HttpError, exited: bool, attempt: usize) -> bool {
    attempt == 0 && (error.connection_lost || exited)
}
fn http(
    port: u16,
    method: &str,
    path: &str,
    key: &str,
    body: &str,
    timeout: Duration,
) -> Result<(u16, String), HttpError> {
    let deadline = Instant::now() + timeout;
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut socket =
        TcpStream::connect_timeout(&addr, Duration::from_secs(2)).map_err(HttpError::from)?;
    socket
        .set_read_timeout(Some(timeout))
        .map_err(HttpError::from)?;
    socket
        .set_write_timeout(Some(timeout))
        .map_err(HttpError::from)?;
    let headers = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {key}\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n",body.len());
    socket
        .write_all(headers.as_bytes())
        .and_then(|_| socket.write_all(body.as_bytes()))
        .map_err(HttpError::from)?;
    let mut raw = Vec::new();
    let mut buf = [0; 16384];
    loop {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .filter(|d| !d.is_zero())
            .ok_or("The describer request timed out")?;
        socket
            .set_read_timeout(Some(remaining))
            .map_err(HttpError::from)?;
        let n = socket.read(&mut buf).map_err(HttpError::from)?;
        if n == 0 {
            break;
        }
        raw.extend_from_slice(&buf[..n]);
    }
    parse_http(&raw).map_err(HttpError::from)
}
fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|p| p.join("describer"))
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn describer_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Describer>>,
) -> Result<DescriberStatus, String> {
    let root = root(&app)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.status(&root))
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command(rename_all = "snake_case")]
pub async fn describer_prepare(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Describer>>,
    on_progress: Channel<PrepareProgress>,
) -> Result<DescriberStatus, String> {
    let root = root(&app)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.prepare(&root, on_progress))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn describer_ask(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Describer>>,
    request: AskRequest,
) -> Result<String, String> {
    let root = root(&app)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.ask(&root, request))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn describer_stop(state: tauri::State<'_, Arc<Describer>>) {
    state.stop();
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn curl_resumes_only_when_a_part_exists() {
        for present in [false, true] {
            let args = curl_args(present);
            assert_eq!(&args[..3], &["-fL", "--retry", "3"]);
            assert_eq!(args.windows(2).any(|a| a == ["-C", "-"]), present);
            assert_eq!(args.last(), Some(&"-o"));
        }
    }
    #[test]
    fn retries_only_first_connection_loss_or_exited_server() {
        use std::io::ErrorKind::*;
        for kind in [
            ConnectionRefused,
            ConnectionReset,
            TimedOut,
            BrokenPipe,
            InvalidData,
            PermissionDenied,
        ] {
            let error = HttpError::from(std::io::Error::from(kind));
            assert_eq!(
                retry_ask(&error, false, 0),
                matches!(kind, ConnectionRefused | ConnectionReset)
            );
            assert!(retry_ask(&error, true, 0));
            assert!(!retry_ask(&error, false, 1));
            assert!(!retry_ask(&error, true, 1));
        }
        for message in [
            "HTTP 400: invalid image",
            "HTTP 500: out of memory",
            "Invalid HTTP response",
            "The describer request timed out",
        ] {
            let error = HttpError::from(message);
            assert!(!retry_ask(&error, false, 0));
            assert!(retry_ask(&error, true, 0));
        }
    }
    #[test]
    fn two_asks_enter_and_a_third_waits_until_one_finishes() {
        let state = Arc::new(Describer::default());
        let first = state.acquire_ask();
        let second = state.acquire_ask();
        assert_eq!(*state.asks.lock().unwrap(), 2);
        state.inner.lock().unwrap().last_ask = Instant::now() - Duration::from_secs(700);
        let (sender, receiver) = std::sync::mpsc::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let worker_state = state.clone();
        let worker = std::thread::spawn(move || {
            sender.send(false).unwrap();
            let _third = worker_state.acquire_ask();
            sender.send(true).unwrap();
            wait.recv().unwrap();
        });
        assert!(!receiver.recv_timeout(Duration::from_secs(3)).unwrap());
        assert!(receiver.recv_timeout(Duration::from_millis(100)).is_err());
        drop(first);
        assert!(receiver.recv_timeout(Duration::from_secs(3)).unwrap());
        assert_eq!(*state.asks.lock().unwrap(), 2);
        assert!(state.inner.lock().unwrap().last_ask.elapsed() < Duration::from_secs(2));
        release.send(()).unwrap();
        worker.join().unwrap();
        drop(second);
        assert_eq!(*state.asks.lock().unwrap(), 0);
    }
    #[test]
    fn disk_budget_includes_margin_and_names_the_volume() {
        let margin = 512 * 1024 * 1024;
        assert!(disk_budget(1_000_000_000, 1_000_000_000 + margin, "C:").is_ok());
        let error = disk_budget(1_000_000_000, 1_000_000_000 + margin - 1, "C:").unwrap_err();
        assert_eq!(
            error,
            "The describer needs 1.54 GB free on C:; 1.54 GB is free"
        );
        let error = disk_budget(2_000_000_000, 1_000_000_000, "C:").unwrap_err();
        assert_eq!(
            error,
            "The describer needs 2.54 GB free on C:; 1.00 GB is free"
        );
        let dir = scratch("disk-volume");
        fs::create_dir_all(&dir).unwrap();
        check_disk(&dir, 1).unwrap();
        fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn corrupt_finished_parts_are_removed_but_verified_parts_survive() {
        let path = scratch("verify.part");
        let a = Asset {
            name: "test",
            bytes: 3,
            sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        };
        for bytes in [b"ab".as_slice(), b"abd", b"abcd"] {
            fs::write(&path, bytes).unwrap();
            assert!(verify_download(&path, a)
                .unwrap_err()
                .contains("verification failed"));
            assert!(!path.exists());
        }
        fs::write(&path, b"abc").unwrap();
        verify_download(&path, a).unwrap();
        assert!(path.exists());
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn failed_transfer_preserves_a_partial_download_for_the_next_prepare() {
        let dir = scratch("interrupted");
        fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("model.gguf");
        let part = part_path(&dest);
        fs::write(&part, b"a").unwrap();
        let missing = tauri::Url::from_file_path(dir.join("missing-source")).unwrap();
        let result = Describer::default().download(
            &dir,
            Asset {
                name: "model.gguf",
                bytes: 3,
                sha256: "unused",
            },
            missing.as_str(),
            &dest,
            &mut DownloadRun {
                epoch: 0,
                total: 3,
                bytes: 1,
            },
        );
        assert!(result.unwrap_err().contains("Could not download"));
        assert_eq!(fs::read(&part).unwrap(), b"a");
        assert!(!dest.exists());
        fs::remove_file(part).unwrap();
        fs::remove_file(dir.join("download.log")).unwrap();
        fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn download_progress_is_overall_and_resumes_existing_parts() {
        let dir = scratch("overall");
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("source");
        fs::write(&source, b"abc").unwrap();
        let url = tauri::Url::from_file_path(&source).unwrap().to_string();
        let state = Describer::default();
        let messages = Arc::new(Mutex::new(Vec::<Value>::new()));
        let capture = messages.clone();
        state
            .inner
            .lock()
            .unwrap()
            .listeners
            .push(Channel::new(move |p| {
                let tauri::ipc::InvokeResponseBody::Json(p) = p else {
                    panic!("expected JSON progress")
                };
                capture
                    .lock()
                    .unwrap()
                    .push(serde_json::from_str::<Value>(&p).unwrap());
                Ok(())
            }));
        let names = ["runtime.zip", "model.gguf", "encoder.gguf"];
        let asset = |name| Asset {
            name,
            bytes: 3,
            sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        };
        fs::write(part_path(&dir.join(names[1])), b"a").unwrap();
        fs::write(part_path(&dir.join(names[2])), b"abc").unwrap();
        let mut run = DownloadRun {
            epoch: 0,
            total: 9,
            bytes: 4,
        };
        for name in names {
            state
                .download(&dir, asset(name), &url, &dir.join(name), &mut run)
                .unwrap();
        }
        // Starting retains the preparation's completed byte count.
        let p = state.inner.lock().unwrap().progress.clone().unwrap();
        state.progress("starting", p.bytes, p.total);
        let messages = messages.lock().unwrap();
        assert!(messages.len() >= 4);
        assert!(messages.iter().all(|p| p["total"] == 9));
        assert!(messages
            .windows(2)
            .all(|p| p[0]["bytes"].as_u64() <= p[1]["bytes"].as_u64()));
        assert_eq!(messages.last().unwrap()["fraction"], 1.0);
        for name in names {
            assert_eq!(fs::read(dir.join(name)).unwrap(), b"abc");
            assert!(!part_path(&dir.join(name)).exists());
            fs::remove_file(dir.join(name)).unwrap();
        }
        fs::remove_file(source).unwrap();
        fs::remove_file(dir.join("download.log")).unwrap();
        fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn picks_discrete_device_even_when_integrated_has_more_memory() {
        let text = "Available devices:\n  Vulkan0: Intel(R) Graphics (18347 MiB, 17579 MiB free)\n  Vulkan1: NVIDIA GeForce RTX 5070 Laptop GPU (7891 MiB, 7123 MiB free)";
        assert_eq!(choose_device(text).as_deref(), Some("Vulkan1"));
        assert_eq!(
            choose_device("Vulkan0: Intel(R) UHD Graphics (8192 MiB, 7000 MiB free)").as_deref(),
            Some("Vulkan0")
        );
        assert_eq!(choose_device("Vulkan0: AMD Radeon(TM) Graphics (8000 MiB, 7000 MiB free)\nVulkan1: AMD Radeon RX 7900 XTX (24000 MiB, 22000 MiB free)").as_deref(), Some("Vulkan1"));
        assert_eq!(choose_device("Vulkan0: Intel(R) Arc A770 Graphics (16000 MiB, 14000 MiB free)\nVulkan1: NVIDIA RTX 3060 (12000 MiB, 10000 MiB free)").as_deref(), Some("Vulkan0"));
        assert_eq!(choose_device("Vulkan0: Microsoft Basic Render Driver (100 MiB, 90 MiB free)\nVulkan1: llvmpipe (200 MiB, 190 MiB free)").as_deref(), Some("Vulkan0"));
        assert_eq!(choose_device("Metal: Apple M3\nNo Vulkan devices"), None);
        assert_eq!(choose_device(""), None);
    }
    #[test]
    fn pinned_platform_assets() {
        let expected = [
            (
                "windows",
                "x86_64",
                "llama-b11529-bin-win-vulkan-x64.zip",
                33469593,
                "ee9bba6669b018c303a30acc18c41edc9eff540fa75ec54278970ddf134af5c4",
            ),
            (
                "windows",
                "aarch64",
                "llama-b11529-bin-win-vulkan-arm64.zip",
                26029736,
                "570ff8eeaebe56a1a02c77f4425c9c0a1bc232f87f94fbdccecd6bbafbd0bae3",
            ),
            (
                "macos",
                "aarch64",
                "llama-b11529-bin-macos-arm64.tar.gz",
                12084163,
                "da75564de557d5ebcc90ea88e8dead4fd5f4253248ffe2d6340163b97c3a0e96",
            ),
            (
                "macos",
                "x86_64",
                "llama-b11529-bin-macos-x64.tar.gz",
                11610739,
                "4c5ebc90125845747586cd706ced9cb4c0fcf5d49699b04cf10150d69a7b5805",
            ),
            (
                "linux",
                "x86_64",
                "llama-b11529-bin-ubuntu-vulkan-x64.tar.gz",
                31791256,
                "89719c08818b5c69ce79d22aa2dd8d812962eeabc5a7c2bd26854f974aa47423",
            ),
            (
                "linux",
                "aarch64",
                "llama-b11529-bin-ubuntu-vulkan-arm64.tar.gz",
                24993078,
                "431345b39f76d31f94f71b1a4f86a99c5d0ffaccac0d1a39a4eaa8e9a63577e8",
            ),
        ];
        for (os, arch, name, bytes, hash) in expected {
            let a = asset(os, arch).unwrap();
            assert_eq!(a.name, name);
            assert_eq!(a.bytes, bytes);
            assert_eq!(a.sha256, hash);
        }
        assert!(asset("windows", "x86").is_err());
        assert_eq!(MODEL.bytes + ENCODER.bytes, 2951255968);
    }
    fn scratch(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../scratch/describer-tests");
        fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }
    #[test]
    fn streams_sha256_and_checks_size_without_loading_models() {
        let path = scratch("hash.txt");
        fs::write(&path, b"abc").unwrap();
        assert_eq!(
            sha256(&path).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let a = Asset {
            name: "test",
            bytes: 3,
            sha256: "",
        };
        assert!(installed(&path, a));
        fs::write(&path, b"abcd").unwrap();
        assert!(!installed(&path, a));
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn reads_chunked_responses_and_rejects_truncation() {
        assert_eq!(
            unchunk(b"4;foo=bar\r\nWiki\r\n5\r\npedia\r\n0\r\nX-Foo: bar\r\n\r\n").unwrap(),
            b"Wikipedia"
        );
        assert!(unchunk(b"6\r\nshort").is_err());
        assert!(unchunk(b"zz\r\n").is_err());
        assert_eq!(
            parse_http(
                b"HTTP/1.1 200 OK\r\nTransfer-Encoding: Chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n"
            )
            .unwrap(),
            (200, "{}".into())
        );
    }
    #[test]
    fn reads_server_errors_and_answer_text() {
        let (code,body) = parse_http(b"HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\n\r\n{\"error\":{\"message\":\"image is invalid\"}}").unwrap();
        assert_eq!(answer(code, &body).unwrap_err(), "image is invalid");
        assert_eq!(
            answer(
                200,
                r#"{"choices":[{"message":{"content":"A camera pans right."}}]}"#
            )
            .unwrap(),
            "A camera pans right."
        );
        assert!(answer(200, "{}").is_err());
    }
    #[test]
    fn loopback_request_authenticates_and_decodes_chunked_http() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut raw = Vec::new();
            let mut byte = [0];
            while !raw.ends_with(b"\r\n\r\n") {
                socket.read_exact(&mut byte).unwrap();
                raw.push(byte[0]);
            }
            let headers = String::from_utf8(raw).unwrap();
            assert!(headers.starts_with("POST /v1/chat/completions HTTP/1.1\r\n"));
            assert!(headers.contains("Authorization: Bearer secret\r\n"));
            assert!(headers.contains("Connection: close\r\n"));
            assert!(headers.contains("Content-Length: 2\r\n"));
            let mut body = [0; 2];
            socket.read_exact(&mut body).unwrap();
            assert_eq!(&body, b"{}");
            let error = r#"{"error":{"message":"test error"}}"#;
            write!(socket, "HTTP/1.1 400 Bad Request\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{error}\r\n0\r\n\r\n", error.len()).unwrap();
        });
        let (code, body) = http(
            port,
            "POST",
            "/v1/chat/completions",
            "secret",
            "{}",
            Duration::from_secs(3),
        )
        .unwrap();
        assert_eq!(answer(code, &body).unwrap_err(), "test error");
        server.join().unwrap();
    }
    #[test]
    fn request_includes_images_schema_and_defaults() {
        let body = ask_body(AskRequest {
            images: vec!["abc".into()],
            prompt: "Describe".into(),
            schema: Some(json!({"type":"object"})),
            max_tokens: None,
        });
        assert_eq!(body["max_tokens"], 300);
        assert_eq!(body["messages"][0]["content"][0]["text"], "Describe");
        assert_eq!(
            body["messages"][0]["content"][1]["image_url"]["url"],
            "data:image/jpeg;base64,abc"
        );
        assert_eq!(
            body["response_format"]["json_schema"]["schema"]["type"],
            "object"
        );
        let body = ask_body(AskRequest {
            images: vec![],
            prompt: "Describe".into(),
            schema: None,
            max_tokens: Some(50),
        });
        assert!(body.get("response_format").is_none());
        assert_eq!(body["max_tokens"], 50);
    }
    #[test]
    fn key_is_random_128_bit_hex() {
        let a = api_key().unwrap();
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, api_key().unwrap());
    }
    #[test]
    fn missing_status_is_read_only_and_ask_requires_prepare() {
        let root = scratch("missing");
        let state = Describer::default();
        let status = state.status(&root);
        assert_eq!(status.state, "missing");
        assert!(!status.runtime_installed);
        assert!(!status.model_installed);
        assert_eq!(
            status.bytes_needed,
            2951255968 + current_asset().unwrap().bytes
        );
        assert!(!root.exists());
        assert_eq!(
            state
                .ask(
                    &root,
                    AskRequest {
                        images: vec![],
                        prompt: "test".into(),
                        schema: None,
                        max_tokens: None
                    }
                )
                .unwrap_err(),
            "The describer is not installed; prepare it first"
        );
    }
    #[test]
    fn concurrent_preparations_share_progress_and_their_own_result() {
        let state = Arc::new(Describer::default());
        let preparation = Arc::new(Preparation::default());
        state.inner.lock().unwrap().preparation = Some(preparation.clone());
        let messages = Arc::new(AtomicU64::new(0));
        let (sender, results) = std::sync::mpsc::channel();
        let mut workers = Vec::new();
        for _ in 0..2 {
            let (state, sender, messages) = (state.clone(), sender.clone(), messages.clone());
            workers.push(std::thread::spawn(move || {
                let channel = Channel::new(move |_| {
                    messages.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                });
                let result = state.prepare(&scratch("shared-missing"), channel);
                sender.send(result).unwrap();
            }));
        }
        let deadline = Instant::now() + Duration::from_secs(3);
        while state.inner.lock().unwrap().listeners.len() != 2 {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        state.progress("runtime", 1, 2);
        assert_eq!(messages.load(Ordering::SeqCst), 2);
        *preparation.result.lock().unwrap() = Some(Err("shared failure".into()));
        // A later preparation must not capture waiters belonging to this one.
        state.inner.lock().unwrap().preparation = Some(Arc::new(Preparation::default()));
        preparation.finished.notify_all();
        for _ in 0..2 {
            assert_eq!(
                results
                    .recv_timeout(Duration::from_secs(3))
                    .unwrap()
                    .unwrap_err(),
                "shared failure"
            );
        }
        for worker in workers {
            worker.join().unwrap();
        }
    }
    #[test]
    #[ignore = "requires OPENFRAME_TEST_DESCRIBER and OPENFRAME_TEST_VIDEO; runs 17 GPU asks without downloads"]
    fn installed_model_compares_one_and_two_slots() {
        let root = PathBuf::from(
            std::env::var_os("OPENFRAME_TEST_DESCRIBER").expect("OPENFRAME_TEST_DESCRIBER"),
        );
        let video =
            PathBuf::from(std::env::var_os("OPENFRAME_TEST_VIDEO").expect("OPENFRAME_TEST_VIDEO"));
        let (ffmpeg, _) = ffmpeg::test_tools().expect("bundled-or-PATH ffmpeg/ffprobe");
        let out = ffmpeg::command(&ffmpeg)
            .args(["-v", "error", "-i"])
            .arg(video)
            .args([
                "-frames:v",
                "1",
                "-vf",
                "scale=768:-2",
                "-f",
                "image2pipe",
                "-c:v",
                "mjpeg",
                "-",
            ])
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        let image = crate::shotlog::base64(&out.stdout);
        let state = Describer::default();
        let request = || AskRequest {
            images: vec![image.clone()],
            prompt: "Describe what is visible in this video frame in one brief sentence.".into(),
            schema: None,
            max_tokens: Some(100),
        };
        // Exclude model loading and first-request shader warm-up from both timings.
        assert!(!state.ask(&root, request()).unwrap().is_empty());
        let mut times = Vec::new();
        for slots in [1, 2] {
            let started = Instant::now();
            for _ in 0..8 / slots {
                std::thread::scope(|scope| {
                    let workers: Vec<_> = (0..slots)
                        .map(|_| scope.spawn(|| state.ask(&root, request())))
                        .collect();
                    for worker in workers {
                        assert!(!worker.join().unwrap().unwrap().is_empty());
                    }
                });
            }
            let elapsed = started.elapsed();
            println!("8 one-frame asks, {slots} in flight: {elapsed:?}");
            times.push(elapsed.as_secs_f64());
        }
        state.stop();
        println!("two-slot speedup: {:.2}x", times[0] / times[1]);
    }
    /// Lead: OPENFRAME_TEST_DESCRIBER=<app-local-data>/describer,
    /// OPENFRAME_TEST_VIDEO=<file>, then cargo test installed_model -- --ignored --nocapture.
    #[test]
    #[ignore = "requires the installed pinned model/runtime and a video; does not download"]
    fn installed_model_describes_one_frame() {
        let root = PathBuf::from(
            std::env::var_os("OPENFRAME_TEST_DESCRIBER").expect("OPENFRAME_TEST_DESCRIBER"),
        );
        let video =
            PathBuf::from(std::env::var_os("OPENFRAME_TEST_VIDEO").expect("OPENFRAME_TEST_VIDEO"));
        let state = Describer::default();
        let out = ffmpeg::command(Path::new("ffmpeg"))
            .args(["-v", "error", "-i"])
            .arg(video)
            .args([
                "-frames:v",
                "1",
                "-vf",
                "scale=768:-2",
                "-f",
                "image2pipe",
                "-c:v",
                "mjpeg",
                "-",
            ])
            .output()
            .unwrap();
        assert!(out.status.success());
        let request = AskRequest {
            images: vec![crate::shotlog::base64(&out.stdout)],
            prompt: "Describe what is visible in this video frame in one brief sentence.".into(),
            schema: None,
            max_tokens: Some(100),
        };
        let result = state.ask(&root, request);
        state.stop();
        println!("{}", result.unwrap());
    }
}
