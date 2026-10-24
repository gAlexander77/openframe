//! FFmpeg as a child process (ADR-013): find it, probe files, and make
//! edit-friendly proxies of media the webview cannot decode (ProRes, DNxHR,
//! MPEG-2, interlaced or 4:2:2 footage). The CLI runs at arm's length, so a
//! crash in it cannot take the app down and its license stays its own.

use crate::files;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    ffi::OsString,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{ipc::Channel, Manager};

/// Where the binaries come from, first match wins:
/// 1. `OPENFRAME_FFMPEG` (or, from before the rename, `VIDEO_EDITOR_FFMPEG`):
///    the ffmpeg executable or its folder (ffprobe is looked up beside it);
/// 2. a bundled copy: `<resources>/ffmpeg/` or beside the app's exe;
/// 3. `PATH` (development machines).
pub fn tool(app: &tauri::AppHandle, name: &str) -> PathBuf {
    let exe = format!("{name}{}", std::env::consts::EXE_SUFFIX);
    if let Some(v) =
        std::env::var_os("OPENFRAME_FFMPEG").or_else(|| std::env::var_os("VIDEO_EDITOR_FFMPEG"))
    {
        let v = PathBuf::from(v);
        if v.is_dir() {
            return v.join(&exe);
        }
        if name == "ffmpeg" {
            return v;
        }
        return v.with_file_name(&exe);
    }
    let bundled = [
        app.path()
            .resource_dir()
            .ok()
            .map(|d| d.join("ffmpeg").join(&exe)),
        std::env::current_exe()
            .ok()
            .and_then(|e| e.parent().map(|d| d.join(&exe))),
    ];
    bundled
        .into_iter()
        .flatten()
        .find(|p| p.is_file())
        .unwrap_or_else(|| exe.into())
}

pub(crate) fn command(program: &Path) -> Command {
    let mut c = Command::new(program);
    c.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flash per job
    }
    c
}

fn spawn_error(program: &Path, e: std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::NotFound {
        format!(
            "{} was not found. Install FFmpeg or set OPENFRAME_FFMPEG to its location.",
            program.display()
        )
    } else {
        format!("{}: {e}", program.display())
    }
}

// ---- probe -------------------------------------------------------------------

/// What the app needs to know about a file, from ffprobe's JSON.
#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    /// ffprobe's container list, e.g. `mov,mp4,m4a,3gp,3g2,mj2`.
    pub format: String,
    /// Seconds; 0 when unknown.
    pub duration: f64,
    pub video: Option<Video>,
    pub audio: Option<Audio>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Video {
    pub codec: String,
    pub width: u32,
    pub height: u32,
    pub pix_fmt: String,
    pub fps: Option<f64>,
    /// Nominal stream rate; may exceed the average for variable-frame-rate video.
    pub r_fps: Option<f64>,
    pub interlaced: bool,
    /// Clockwise degrees to apply, from the display matrix.
    pub rotation: i32,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Audio {
    pub codec: String,
    pub channels: u32,
    pub sample_rate: u32,
}

// ffprobe prints many numbers as strings, so those stay strings here.
#[derive(Deserialize, Default)]
#[serde(default)]
struct RawProbe {
    streams: Vec<RawStream>,
    format: RawFormat,
    error: Option<RawError>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct RawStream {
    codec_type: String,
    codec_name: String,
    width: u32,
    height: u32,
    pix_fmt: String,
    field_order: String,
    avg_frame_rate: String,
    r_frame_rate: String,
    duration: Option<String>,
    channels: u32,
    sample_rate: Option<String>,
    disposition: HashMap<String, i32>,
    side_data_list: Vec<RawSideData>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct RawSideData {
    rotation: Option<f64>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct RawFormat {
    format_name: String,
    duration: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct RawError {
    string: String,
}

fn rate(r: &str) -> Option<f64> {
    let (n, d) = r.split_once('/')?;
    let (n, d): (f64, f64) = (n.parse().ok()?, d.parse().ok()?);
    let fps = n / d;
    (n > 0.0 && d > 0.0 && fps.is_finite() && fps > 0.0).then_some(fps)
}

fn summarize(json: &[u8]) -> Result<Summary, String> {
    let raw: RawProbe = serde_json::from_slice(json).map_err(|e| e.to_string())?;
    if let Some(e) = raw.error {
        return Err(e.string);
    }
    let seconds = |s: &Option<String>| s.as_deref().and_then(|s| s.parse::<f64>().ok());
    // Cover art in an MP3 or M4A is a "video" stream too: skip it.
    let picture = |s: &RawStream| s.disposition.get("attached_pic") == Some(&1);
    let video = raw
        .streams
        .iter()
        .find(|s| s.codec_type == "video" && !picture(s));
    let audio = raw.streams.iter().find(|s| s.codec_type == "audio");
    let stream_duration = video.or(audio).and_then(|s| seconds(&s.duration));
    Ok(Summary {
        format: raw.format.format_name.clone(),
        duration: seconds(&raw.format.duration)
            .or(stream_duration)
            .unwrap_or(0.0),
        video: video.map(|s| Video {
            codec: s.codec_name.clone(),
            width: s.width,
            height: s.height,
            pix_fmt: s.pix_fmt.clone(),
            fps: rate(&s.avg_frame_rate),
            r_fps: rate(&s.r_frame_rate),
            interlaced: matches!(s.field_order.as_str(), "tt" | "bb" | "tb" | "bt"),
            rotation: s
                .side_data_list
                .iter()
                .find_map(|d| d.rotation)
                .map(|r| ((-r.round() as i32 % 360) + 360) % 360)
                .unwrap_or(0),
        }),
        audio: audio.map(|s| Audio {
            codec: s.codec_name.clone(),
            channels: s.channels,
            sample_rate: s
                .sample_rate
                .as_deref()
                .and_then(|r| r.parse().ok())
                .unwrap_or(0),
        }),
    })
}

pub fn probe(ffprobe: &Path, file: &Path) -> Result<Summary, String> {
    let out = command(ffprobe)
        .args(["-v", "error", "-hide_banner", "-print_format", "json"])
        .args(["-show_format", "-show_streams", "-show_error"])
        .arg(file)
        .output()
        .map_err(|e| spawn_error(ffprobe, e))?;
    summarize(&out.stdout).map_err(|e| format!("{}: {e}", file.display()))
}

// ---- proxies --------------------------------------------------------------------

/// An H.264 encoder and the settings that make an edit-friendly proxy with
/// it: a keyframe every 15 frames and no B-frames, so a seek decodes at most
/// half a second. All of these were trial-run on the dev machine except
/// where noted in ADR-013.
struct Encoder {
    name: &'static str,
    pix_fmt: &'static str,
    /// Command-line arguments, space-separated as in the ffmpeg docs.
    args: &'static str,
}

const NVENC: Encoder = Encoder {
    name: "h264_nvenc",
    pix_fmt: "yuv420p",
    args: "-preset p4 -tune hq -rc vbr -cq 19 -b:v 0 -g 15 -bf 0 -profile:v high",
};
const QSV: Encoder = Encoder {
    name: "h264_qsv",
    pix_fmt: "nv12",
    args: "-preset veryfast -global_quality 21 -g 15 -bf 0",
};
const AMF: Encoder = Encoder {
    name: "h264_amf",
    pix_fmt: "yuv420p",
    args: "-quality speed -rc cqp -qp_i 18 -qp_p 20 -g 15 -bf 0",
};
const MEDIA_FOUNDATION: Encoder = Encoder {
    name: "h264_mf",
    pix_fmt: "nv12",
    args: "-hw_encoding 1 -rate_control quality -quality 75 -g 15 -bf 0",
};
const VIDEOTOOLBOX: Encoder = Encoder {
    name: "h264_videotoolbox",
    pix_fmt: "nv12",
    args: "-q:v 65 -g 15 -bf 0",
};
/// The software encoder in LGPL builds (BSD-licensed, Cisco's codec).
const OPENH264: Encoder = Encoder {
    name: "libopenh264",
    pix_fmt: "yuv420p",
    args: "-b:v 20M -g 15",
};
/// GPL: present in the dev machine's FFmpeg, absent from the LGPL build we
/// ship (ADR-013). Last resort, so release behavior never depends on it.
const X264: Encoder = Encoder {
    name: "libx264",
    pix_fmt: "yuv420p",
    args: "-preset veryfast -crf 18 -g 15 -keyint_min 15 -sc_threshold 0 -bf 0",
};

/// Hardware first: fast, and the OS or GPU vendor carries the H.264 patent
/// license. ponytail: Linux VAAPI needs a device and `hwupload`; add it when
/// a Linux user without NVIDIA needs fast proxies.
fn candidates() -> Vec<&'static Encoder> {
    let mut v: Vec<&'static Encoder> = Vec::new();
    if cfg!(windows) {
        v.extend([&NVENC, &QSV, &AMF, &MEDIA_FOUNDATION]);
    } else if cfg!(target_os = "macos") {
        v.push(&VIDEOTOOLBOX);
    } else {
        v.push(&NVENC);
    }
    v.extend([&OPENH264, &X264]);
    v
}

/// The proxy command line. Full resolution (capped at 4096): export reads
/// the proxy too, so a 720p proxy would make every export 720p.
fn proxy_args(enc: Option<&Encoder>, input: &Path, info: &Summary, output: &Path) -> Vec<OsString> {
    // -y: never stop at "Overwrite? [y/N]"; progress as key=value on stdout.
    let mut a: Vec<OsString> =
        "-hide_banner -nostdin -y -loglevel error -nostats -progress pipe:1 -i"
            .split_whitespace()
            .map(OsString::from)
            .collect();
    a.push(input.into());
    let mut push = |args: &[&str]| a.extend(args.iter().map(OsString::from));
    match (enc, &info.video) {
        (Some(enc), Some(v)) => {
            // ffmpeg applies the display matrix itself, so proxy pixels come
            // out upright and the proxy carries no rotation.
            let deinterlace = if v.interlaced {
                "bwdif=mode=send_frame:deint=interlaced,"
            } else {
                ""
            };
            let filter = format!(
                "{deinterlace}scale=w='min(iw,4096)':h='min(ih,4096)':force_original_aspect_ratio=decrease:force_divisible_by=2,format={}",
                enc.pix_fmt
            );
            // Passthrough keeps the source timestamps (VFR stays VFR), so
            // proxy time equals source time.
            push(&["-map", "0:v:0", "-fps_mode", "passthrough", "-vf", &filter]);
            push(&["-c:v", enc.name]);
            push(&enc.args.split_whitespace().collect::<Vec<_>>());
        }
        _ => push(&["-vn"]),
    }
    if info.audio.is_some() {
        push(&[
            "-map", "0:a:0", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        ]);
    } else {
        push(&["-an"]);
    }
    push(&["-movflags", "+faststart", "-f", "mp4"]);
    a.push(output.into());
    a
}

/// Playback copies stay separate from the full-resolution decode fallback.
#[derive(Clone, Copy, Deserialize, Serialize, Debug)]
#[serde(rename_all = "lowercase")]
pub enum PlaybackSize {
    Half,
    Quarter,
    #[serde(rename = "720p")]
    P720,
}
impl PlaybackSize {
    fn label(self) -> &'static str {
        match self {
            Self::Half => "half",
            Self::Quarter => "quarter",
            Self::P720 => "720p",
        }
    }
    fn scale(self) -> &'static str {
        match self {
            Self::Half => "scale=trunc(iw/4)*2:trunc(ih/4)*2",
            Self::Quarter => "scale=trunc(iw/8)*2:trunc(ih/8)*2",
            Self::P720 => "scale=w='if(lte(iw,ih),720,-2)':h='if(lte(iw,ih),-2,720)'",
        }
    }
}
fn playback_name(fingerprint: &str, size: PlaybackSize) -> String {
    format!("playback-{fingerprint}-{}.mp4", size.label())
}
fn playback_args(input: &Path, info: &Summary, output: &Path, size: PlaybackSize) -> Vec<OsString> {
    let mut a: Vec<OsString> =
        "-hide_banner -nostdin -y -loglevel error -nostats -progress pipe:1 -i"
            .split_whitespace()
            .map(OsString::from)
            .collect();
    a.push(input.into());
    let filter = format!("{},format=yuv420p", size.scale());
    let mut push = |args: &[&str]| a.extend(args.iter().map(OsString::from));
    // ponytail: CRF 23 uses libx264, absent from the planned LGPL bundle.
    // Add LGPL encoder-specific quality settings before bundling this feature.
    // Keep source timestamps. FFmpeg applies the display matrix before scaling,
    // as the decode fallback does: phone footage stays upright, without a tag
    // that a transcode/filter chain can drop.
    push(&[
        "-map",
        "0:v:0",
        "-map_metadata",
        "0",
        "-fps_mode",
        "passthrough",
        "-vf",
        &filter,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-g",
        "12",
        "-keyint_min",
        "12",
        "-sc_threshold",
        "0",
        "-pix_fmt",
        "yuv420p",
    ]);
    if let Some(audio) = &info.audio {
        push(&[
            "-map",
            "0:a:0",
            "-c:a",
            if audio.codec == "aac" { "copy" } else { "aac" },
        ]);
    } else {
        push(&["-an"]);
    }
    push(&["-movflags", "+faststart", "-f", "mp4"]);
    a.push(output.into());
    a
}

#[derive(Serialize)]
pub struct PlaybackProxy {
    src: PathBuf,
    width: u32,
    height: u32,
    size: PlaybackSize,
    fingerprint: String,
}
#[derive(Serialize)]
pub struct PlaybackInfo {
    #[serde(skip_serializing_if = "Option::is_none")]
    fingerprint: Option<String>,
    exists: bool,
}

#[tauri::command]
pub async fn ffmpeg_playback_proxy_info(
    path: PathBuf,
    proxy: Option<PathBuf>,
) -> Result<PlaybackInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(PlaybackInfo {
            fingerprint: cache_key(&path).ok(),
            exists: proxy.is_some_and(|p| p.is_file()),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ffmpeg_delete_playback_proxy(
    app: tauri::AppHandle,
    path: PathBuf,
) -> Result<(), String> {
    // A document may name any source; deletion is limited to our playback cache.
    if !path.exists() {
        return Ok(());
    }
    let dir = proxy_dir(&app)?.canonicalize().map_err(|e| e.to_string())?;
    let resolved = path.canonicalize().map_err(|e| e.to_string())?;
    if resolved.parent() != Some(dir.as_path())
        || !resolved
            .file_name()
            .is_some_and(|n| n.to_string_lossy().starts_with("playback-"))
        || resolved.extension().is_none_or(|e| e != "mp4")
    {
        return Err("Only cached playback proxies can be deleted.".into());
    }
    std::fs::remove_file(resolved).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ffmpeg_playback_proxy(
    app: tauri::AppHandle,
    path: PathBuf,
    job: String,
    size: PlaybackSize,
    on_progress: Channel<Progress>,
) -> Result<PlaybackProxy, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ffmpeg = tool(&app, "ffmpeg");
        let ffprobe = tool(&app, "ffprobe");
        let fingerprint = cache_key(&path)?;
        let info = probe(&ffprobe, &path)?;
        if info.video.is_none() {
            return Err("Playback proxies need video media.".into());
        }
        let dir = proxy_dir(&app)?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let out = dir.join(playback_name(&fingerprint, size));
        if !out.is_file() {
            // Unique partials prevent overlapping requests from sharing a write.
            let safe_job: String = job
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
                .take(64)
                .collect();
            let part = dir.join(format!(
                "playback-{fingerprint}-{}-{safe_job}.part",
                size.label()
            ));
            let send = |fraction| {
                let _ = on_progress.send(Progress { fraction });
            };
            let args = playback_args(&path, &info, &part, size);
            let result = app
                .state::<Ffmpeg>()
                .run(&job, &ffmpeg, &args, info.duration, &send);
            if let Err(failure) = result {
                let _ = std::fs::remove_file(&part);
                return Err(match failure {
                    Failure::Canceled => "canceled".into(),
                    Failure::Failed(e) => e,
                });
            }
            if cache_key(&path)? != fingerprint {
                let _ = std::fs::remove_file(&part);
                return Err("The original changed while making its playback proxy.".into());
            }
            files::replace(&part, &out).map_err(|e| e.to_string())?;
        }
        let v = probe(&ffprobe, &out)?
            .video
            .ok_or("The playback proxy has no video.")?;
        let (width, height) = if v.rotation == 90 || v.rotation == 270 {
            (v.height, v.width)
        } else {
            (v.width, v.height)
        };
        let _ = on_progress.send(Progress { fraction: 1.0 });
        Ok(PlaybackProxy {
            src: out,
            width,
            height,
            size,
            fingerprint,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A stable name for a source's proxy: the same file, unchanged, maps to the
/// same proxy, so reimporting it is instant. FNV-1a, which (unlike std's
/// hasher) never changes between Rust releases.
pub(crate) fn cache_key(src: &Path) -> Result<String, String> {
    let meta = std::fs::metadata(src).map_err(|e| format!("{}: {e}", src.display()))?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_nanos());
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let text = format!("{}|{}|{modified}", src.display(), meta.len());
    for b in text.bytes() {
        h = (h ^ b as u64).wrapping_mul(0x0000_0100_0000_01b3);
    }
    let stem: String = src
        .file_stem()
        .map(|s| {
            s.to_string_lossy()
                .chars()
                .filter(|c| c.is_alphanumeric())
                .take(40)
                .collect()
        })
        .unwrap_or_default();
    Ok(format!("{stem}-{h:016x}"))
}

struct Running {
    child: Mutex<Child>,
    canceled: AtomicBool,
}

enum Failure {
    Canceled,
    Failed(String),
}

#[derive(Default)]
pub struct Ffmpeg {
    running: Mutex<HashMap<String, Arc<Running>>>,
    /// Encoders that passed or failed a trial encode, this session.
    trials: Mutex<HashMap<&'static str, bool>>,
    #[cfg(windows)]
    job: job::KillOnClose,
}

#[derive(Serialize, Clone)]
pub struct Progress {
    fraction: f64,
}

impl Ffmpeg {
    /// `ffmpeg -encoders` lists what was compiled in, not what works (it
    /// lists AMF on a machine without an AMD GPU), so each encoder proves
    /// itself once on 256x256 black: NVENC rejects smaller frames.
    fn usable(&self, ffmpeg: &Path, enc: &Encoder) -> bool {
        if let Some(&ok) = self.trials.lock().unwrap().get(enc.name) {
            return ok;
        }
        let ok = command(ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-f", "lavfi"])
            .args(["-i", "color=black:s=256x256:r=30:d=0.2"])
            .args(["-vf", &format!("format={}", enc.pix_fmt), "-c:v", enc.name])
            .args(enc.args.split_whitespace())
            .args(["-f", "null", "-"])
            .output()
            .is_ok_and(|o| o.status.success());
        self.trials.lock().unwrap().insert(enc.name, ok);
        ok
    }

    fn run(
        &self,
        job: &str,
        ffmpeg: &Path,
        args: &[OsString],
        duration: f64,
        progress: &dyn Fn(f64),
    ) -> Result<(), Failure> {
        let mut child = command(ffmpeg)
            .args(args)
            .spawn()
            .map_err(|e| Failure::Failed(spawn_error(ffmpeg, e)))?;
        #[cfg(windows)]
        self.job.assign(&child);
        let stdout = child.stdout.take().expect("piped");
        let stderr = child.stderr.take().expect("piped");
        // Drained on its own thread, or a chatty ffmpeg fills the pipe and
        // deadlocks. The last lines become the error message.
        let errors = std::thread::spawn(move || {
            let lines: Vec<String> = BufReader::new(stderr)
                .lines()
                .map_while(Result::ok)
                .collect();
            lines[lines.len().saturating_sub(6)..].join("\n")
        });
        let running = Arc::new(Running {
            child: Mutex::new(child),
            canceled: AtomicBool::new(false),
        });
        self.running
            .lock()
            .unwrap()
            .insert(job.to_string(), running.clone());
        // `-progress pipe:1`: key=value lines, each block ending `progress=`.
        let mut out_us = 0u64;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            match line.split_once('=') {
                Some(("out_time_us", v)) => out_us = v.trim().parse().unwrap_or(out_us),
                Some(("progress", _)) if duration > 0.0 => {
                    progress((out_us as f64 / (duration * 1e6)).clamp(0.0, 1.0))
                }
                _ => {}
            }
        }
        let status = running.child.lock().unwrap().wait();
        self.running.lock().unwrap().remove(job);
        let errors = errors.join().unwrap_or_default();
        if running.canceled.load(Ordering::SeqCst) {
            return Err(Failure::Canceled);
        }
        match status {
            Ok(s) if s.success() => Ok(()),
            Ok(s) => Err(Failure::Failed(format!("ffmpeg exited with {s}: {errors}"))),
            Err(e) => Err(Failure::Failed(e.to_string())),
        }
    }

    /// Make (or reuse) the proxy for `src` in `dir`; answers its path.
    pub fn make_proxy(
        &self,
        tools: (&Path, &Path),
        dir: &Path,
        src: &Path,
        job: &str,
        progress: &dyn Fn(f64),
    ) -> Result<PathBuf, String> {
        let (ffmpeg, ffprobe) = tools;
        let info = probe(ffprobe, src)?;
        if info.video.is_none() && info.audio.is_none() {
            return Err(format!("{}: no audio or video found", src.display()));
        }
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        let key = cache_key(src)?;
        let out = dir.join(format!("{key}.mp4"));
        if out.is_file() {
            progress(1.0);
            return Ok(out);
        }
        let part = dir.join(format!("{key}.part"));
        let encoders: Vec<Option<&Encoder>> = if info.video.is_some() {
            candidates()
                .into_iter()
                .filter(|e| self.usable(ffmpeg, e))
                .map(Some)
                .collect()
        } else {
            vec![None]
        };
        let mut last = "no H.264 encoder works with this FFmpeg".to_string();
        // An encoder can pass the trial and still refuse a file (a size past
        // its limits): fall through to the next one.
        for enc in encoders {
            let args = proxy_args(enc, src, &info, &part);
            match self.run(job, ffmpeg, &args, info.duration, progress) {
                Ok(()) => {
                    files::replace(&part, &out).map_err(|e| format!("{}: {e}", out.display()))?;
                    progress(1.0);
                    return Ok(out);
                }
                Err(Failure::Canceled) => {
                    let _ = std::fs::remove_file(&part);
                    return Err("canceled".into());
                }
                Err(Failure::Failed(e)) => {
                    let _ = std::fs::remove_file(&part);
                    last = e;
                }
            }
        }
        Err(format!("Couldn't convert {}: {last}", src.display()))
    }

    pub fn cancel(&self, job: &str) {
        if let Some(r) = self.running.lock().unwrap().get(job) {
            r.canceled.store(true, Ordering::SeqCst);
            let _ = r.child.lock().unwrap().kill();
        }
    }

    /// On a clean exit. A crash is covered by the Job Object on Windows.
    /// ponytail: Linux could add PR_SET_PDEATHSIG and macOS a watchdog, so a
    /// crashed app never leaves ffmpeg running there either.
    pub fn kill_all(&self) {
        for job in self
            .running
            .lock()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>()
        {
            self.cancel(&job);
        }
    }
}

fn proxy_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Never app_cache_dir() itself: on Windows it is the local data folder,
    // which also holds the WebView2 profile, so clearing it must stop at cache/.
    let base = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    Ok(base.join("cache").join("proxies"))
}

/// ffprobe's view of a file.
#[tauri::command]
pub async fn ffmpeg_probe(app: tauri::AppHandle, path: PathBuf) -> Result<Summary, String> {
    tauri::async_runtime::spawn_blocking(move || probe(&tool(&app, "ffprobe"), &path))
        .await
        .map_err(|e| e.to_string())?
}

/// Make an edit-friendly copy of `path`; progress (0..1) streams over
/// `on_progress`, and `ffmpeg_cancel(job)` stops it. Answers the proxy path.
#[tauri::command]
pub async fn ffmpeg_proxy(
    app: tauri::AppHandle,
    path: PathBuf,
    job: String,
    on_progress: Channel<Progress>,
) -> Result<PathBuf, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let tools = (tool(&app, "ffmpeg"), tool(&app, "ffprobe"));
        let send = |fraction: f64| {
            let _ = on_progress.send(Progress { fraction });
        };
        app.state::<Ffmpeg>().make_proxy(
            (&tools.0, &tools.1),
            &proxy_dir(&app)?,
            &path,
            &job,
            &send,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ffmpeg_cancel(job: String, ffmpeg: tauri::State<'_, Ffmpeg>) -> Result<(), String> {
    ffmpeg.cancel(&job);
    Ok(())
}

/// Windows: every ffmpeg goes into one Job Object that kills its members
/// when its last handle closes, which happens when this process ends, crash
/// included. Without it a crashed app leaves ffmpeg.exe burning the GPU.
#[cfg(windows)]
pub(crate) mod job {
    use std::{os::windows::io::AsRawHandle, process::Child};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, HANDLE},
        System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
    };

    pub struct KillOnClose(HANDLE);

    // The handle is a kernel object id, usable from any thread.
    unsafe impl Send for KillOnClose {}
    unsafe impl Sync for KillOnClose {}

    impl Default for KillOnClose {
        fn default() -> Self {
            // SAFETY: plain Win32 calls on a handle this struct owns; the
            // info struct is zeroed (valid for this POD) and sized correctly.
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if !job.is_null() {
                    let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                    SetInformationJobObject(
                        job,
                        JobObjectExtendedLimitInformation,
                        &info as *const _ as *const _,
                        std::mem::size_of_val(&info) as u32,
                    );
                }
                KillOnClose(job)
            }
        }
    }

    impl KillOnClose {
        /// Best effort: a child outside the job is still killed on a clean exit.
        pub fn assign(&self, child: &Child) {
            if !self.0.is_null() {
                // SAFETY: both handles are live for the duration of the call.
                unsafe { AssignProcessToJobObject(self.0, child.as_raw_handle() as HANDLE) };
            }
        }
    }

    impl Drop for KillOnClose {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: the handle is owned and closed exactly once.
                unsafe { CloseHandle(self.0) };
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn closing_the_job_kills_its_children() {
            let job = KillOnClose::default();
            let mut child = std::process::Command::new("ping")
                .args(["-n", "30", "127.0.0.1"])
                .stdout(std::process::Stdio::null())
                .spawn()
                .unwrap();
            job.assign(&child);
            assert!(child.try_wait().unwrap().is_none(), "still running");
            drop(job); // what process exit does, crash included
            std::thread::sleep(std::time::Duration::from_millis(500));
            assert!(child.try_wait().unwrap().is_some(), "killed with the job");
        }
    }
}

#[cfg(test)]
pub(crate) fn test_tools() -> Option<(PathBuf, PathBuf)> {
    let exe = |name: &str| format!("{name}{}", std::env::consts::EXE_SUFFIX);
    let mut candidates = Vec::new();
    if let Some(path) =
        std::env::var_os("OPENFRAME_FFMPEG").or_else(|| std::env::var_os("VIDEO_EDITOR_FFMPEG"))
    {
        let path = PathBuf::from(path);
        candidates.push(if path.is_dir() {
            path.join(exe("ffmpeg"))
        } else {
            path
        });
    }
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    candidates.extend([
        manifest.join("resources/ffmpeg").join(exe("ffmpeg")),
        manifest.join("ffmpeg").join(exe("ffmpeg")),
    ]);
    if let Ok(current) = std::env::current_exe() {
        if let Some(dir) = current.parent() {
            candidates.extend([
                dir.join(exe("ffmpeg")),
                dir.join("ffmpeg").join(exe("ffmpeg")),
            ]);
        }
    }
    candidates.push(exe("ffmpeg").into());
    candidates.into_iter().find_map(|ffmpeg| {
        let ffprobe = ffmpeg.with_file_name(exe("ffprobe"));
        [&ffmpeg, &ffprobe]
            .iter()
            .all(|tool| {
                command(tool)
                    .arg("-version")
                    .output()
                    .is_ok_and(|out| out.status.success())
            })
            .then_some((ffmpeg, ffprobe))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRORES: &str = r#"{"streams":[
        {"index":0,"codec_name":"prores","codec_type":"video","width":1920,"height":1080,
         "pix_fmt":"yuv422p10le","field_order":"progressive","r_frame_rate":"24/1",
         "avg_frame_rate":"24/1","duration":"3.000000","nb_frames":"72",
         "disposition":{"default":1,"attached_pic":0}},
        {"index":1,"codec_name":"pcm_s16le","codec_type":"audio","sample_rate":"48000",
         "channels":1,"duration":"3.000000","disposition":{"default":1}}],
      "format":{"format_name":"mov,mp4,m4a,3gp,3g2,mj2","duration":"3.000000","size":"18142156"}}"#;

    #[test]
    fn summarizes_ffprobe_json() {
        let s = summarize(PRORES.as_bytes()).unwrap();
        assert_eq!(s.duration, 3.0);
        assert_eq!(s.format, "mov,mp4,m4a,3gp,3g2,mj2");
        let v = s.video.unwrap();
        assert_eq!(
            (v.codec.as_str(), v.width, v.height),
            ("prores", 1920, 1080)
        );
        assert_eq!((v.fps, v.interlaced, v.rotation), (Some(24.0), false, 0));
        assert_eq!(v.r_fps, Some(24.0));
        let a = s.audio.unwrap();
        assert_eq!((a.channels, a.sample_rate), (1, 48000));
    }

    #[test]
    fn stream_rate_preserves_average_and_rejects_invalid_rates() {
        for (raw, expected) in [
            ("30/1", Some(30.0)),
            ("0/0", None),
            ("NaN/1", None),
            ("inf/1", None),
            ("1/0", None),
            ("-30/1", None),
            ("1/inf", None),
            ("bad", None),
        ] {
            let json = serde_json::json!({"streams":[{"codec_type":"video",
                "avg_frame_rate":"93/5", "r_frame_rate":raw}]});
            let v = summarize(&serde_json::to_vec(&json).unwrap())
                .unwrap()
                .video
                .unwrap();
            assert_eq!(v.fps, Some(18.6));
            assert_eq!(v.r_fps, expected, "{raw}");
        }
        let v = summarize(br#"{"streams":[{"codec_type":"video"}]}"#)
            .unwrap()
            .video
            .unwrap();
        assert_eq!((v.fps, v.r_fps), (None, None));
    }

    #[test]
    fn reads_rotation_interlacing_and_cover_art() {
        let json = r#"{"streams":[
            {"codec_type":"video","codec_name":"mjpeg","disposition":{"attached_pic":1}},
            {"codec_type":"video","codec_name":"h264","field_order":"tt",
             "avg_frame_rate":"30000/1001","side_data_list":[{"side_data_type":"Display Matrix","rotation":-90}]}],
          "format":{"format_name":"mov"}}"#;
        let v = summarize(json.as_bytes()).unwrap().video.unwrap();
        assert_eq!(v.codec, "h264", "cover art is not the video");
        assert!(v.interlaced);
        assert_eq!(
            v.rotation, 90,
            "a -90 display matrix means turn 90 clockwise"
        );
        assert!((v.fps.unwrap() - 29.97).abs() < 0.01);
    }

    #[test]
    fn reports_ffprobe_errors() {
        let json =
            r#"{"error":{"code":-1094995529,"string":"Invalid data found when processing input"}}"#;
        assert_eq!(
            summarize(json.as_bytes()).unwrap_err(),
            "Invalid data found when processing input"
        );
    }

    #[test]
    fn proxy_command_lines() {
        let info = summarize(PRORES.as_bytes()).unwrap();
        let args = |enc| {
            proxy_args(enc, Path::new("in.mov"), &info, Path::new("out.part"))
                .iter()
                .map(|a| a.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join(" ")
        };
        let nvenc = args(Some(&NVENC));
        assert!(nvenc.contains("-c:v h264_nvenc"));
        assert!(
            nvenc.contains("-g 15") && nvenc.contains("-bf 0"),
            "short GOP, no B-frames"
        );
        assert!(nvenc.contains("format=yuv420p"));
        assert!(nvenc.contains("-map 0:a:0 -c:a aac"));
        assert!(nvenc.ends_with("-f mp4 out.part"));
        assert!(!nvenc.contains("bwdif"));
        assert!(args(Some(&QSV)).contains("format=nv12"));
        let audio_only = Summary {
            video: None,
            ..summarize(PRORES.as_bytes()).unwrap()
        };
        let a = proxy_args(None, Path::new("in.wma"), &audio_only, Path::new("o"));
        assert!(a.iter().any(|x| x == "-vn"));
    }

    #[test]
    fn playback_command_lines_keep_timing_rotation_and_short_gops() {
        let mut info = summarize(PRORES.as_bytes()).unwrap();
        info.video.as_mut().unwrap().rotation = 90;
        for (size, scale) in [
            (PlaybackSize::Half, "scale=trunc(iw/4)*2:trunc(ih/4)*2"),
            (PlaybackSize::Quarter, "scale=trunc(iw/8)*2:trunc(ih/8)*2"),
            (
                PlaybackSize::P720,
                "scale=w='if(lte(iw,ih),720,-2)':h='if(lte(iw,ih),-2,720)'",
            ),
        ] {
            let args = playback_args(Path::new("phone.mov"), &info, Path::new("o.part"), size)
                .iter()
                .map(|a| a.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join(" ");
            assert!(args.contains(scale), "{args}");
            assert!(args.contains("-i phone.mov") && !args.contains("-noautorotate"));
            assert!(args.contains("-map_metadata 0 -fps_mode passthrough"));
            assert!(!args.contains("transpose") && !args.contains("-r "));
            assert!(args.contains(
                "-preset veryfast -crf 23 -g 12 -keyint_min 12 -sc_threshold 0 -pix_fmt yuv420p"
            ));
            assert!(args.contains("-c:v libx264"));
            assert!(args.contains("-map 0:a:0 -c:a aac"));
            assert!(args.ends_with("-movflags +faststart -f mp4 o.part"));
        }
        info.audio.as_mut().unwrap().codec = "aac".into();
        let args = playback_args(Path::new("in"), &info, Path::new("out"), PlaybackSize::Half);
        assert!(args.windows(2).any(|w| w == ["-c:a", "copy"]));
        info.audio = None;
        assert!(
            playback_args(Path::new("in"), &info, Path::new("out"), PlaybackSize::Half)
                .iter()
                .any(|a| a == "-an")
        );
    }

    #[test]
    fn playback_proxy_keeps_phone_rotation_and_frame_rate() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/media/h264-1080p30.mp4");
        if !src.is_file() || Command::new("ffmpeg").arg("-version").output().is_err() {
            eprintln!("skipped: needs ffmpeg and fixtures");
            return;
        }
        // Keep this lane's generated media inside its worktree.
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../scratch/playback-proxy-test");
        std::fs::create_dir_all(&dir).unwrap();
        let phone = dir.join("phone.mov");
        let status = command(Path::new("ffmpeg"))
            .args([
                "-y",
                "-v",
                "error",
                "-noautorotate",
                "-display_rotation:v:0",
                "90",
                "-i",
            ])
            .arg(&src)
            .args(["-t", "0.5", "-c", "copy"])
            .arg(&phone)
            .status()
            .unwrap();
        assert!(status.success());
        let info = probe(Path::new("ffprobe"), &phone).unwrap();
        let rotation = info.video.as_ref().unwrap().rotation;
        assert!(rotation == 90 || rotation == 270);
        let ff = Ffmpeg::default();
        for (size, expected) in [
            (PlaybackSize::Half, (540, 960)),
            (PlaybackSize::Quarter, (270, 480)),
            (PlaybackSize::P720, (720, 1280)),
        ] {
            let out = dir.join(playback_name(&cache_key(&phone).unwrap(), size));
            let args = playback_args(&phone, &info, &out, size);
            assert!(ff
                .run(
                    size.label(),
                    Path::new("ffmpeg"),
                    &args,
                    info.duration,
                    &|_| {}
                )
                .is_ok());
            let made = probe(Path::new("ffprobe"), &out).unwrap();
            let video = made.video.unwrap();
            assert_eq!((video.width, video.height), expected);
            assert_eq!(
                video.rotation, 0,
                "phone rotation is baked into upright pixels"
            );
            assert_eq!(video.fps, info.video.as_ref().unwrap().fps);
            assert_eq!(video.codec, "h264");
        }
    }

    #[test]
    fn playback_cache_names_include_original_fingerprint_and_size() {
        let half = playback_name("clip-123", PlaybackSize::Half);
        assert_eq!(half, "playback-clip-123-half.mp4");
        assert_ne!(half, playback_name("clip-456", PlaybackSize::Half));
        assert_ne!(half, playback_name("clip-123", PlaybackSize::Quarter));
        assert_ne!(half, playback_name("clip-123", PlaybackSize::P720));
    }

    #[test]
    fn cache_keys_follow_the_file() {
        let dir = std::env::temp_dir().join(format!("ve-ffmpeg-key-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("My Clip (1).mov");
        std::fs::write(&f, b"one").unwrap();
        let k1 = cache_key(&f).unwrap();
        assert_eq!(cache_key(&f).unwrap(), k1, "stable");
        assert!(k1.starts_with("MyClip1-"));
        std::fs::write(&f, b"three").unwrap();
        assert_ne!(
            cache_key(&f).unwrap(),
            k1,
            "a changed file gets a new proxy"
        );
    }

    /// The whole pipeline against the real ProRes fixture, when ffmpeg is on
    /// PATH and fixtures exist (`node scripts/make-fixtures.mjs`).
    #[test]
    fn proxies_the_prores_fixture() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/media/prores-422.mov");
        let found = Command::new("ffmpeg").arg("-version").output().is_ok();
        if !src.is_file() || !found {
            eprintln!("skipped: needs ffmpeg on PATH and the fixtures");
            return;
        }
        let dir = std::env::temp_dir().join(format!("ve-ffmpeg-proxy-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let ff = Ffmpeg::default();
        let seen = Mutex::new(Vec::new());
        let tools = (Path::new("ffmpeg"), Path::new("ffprobe"));
        let out = ff
            .make_proxy(tools, &dir, &src, "t", &|f| seen.lock().unwrap().push(f))
            .unwrap();
        let p = probe(Path::new("ffprobe"), &out).unwrap();
        let v = p.video.unwrap();
        assert_eq!((v.codec.as_str(), v.width, v.height), ("h264", 1920, 1080));
        assert_eq!(p.audio.unwrap().codec, "aac");
        assert!((p.duration - 3.0).abs() < 0.1, "{}", p.duration);
        assert_eq!(seen.lock().unwrap().last(), Some(&1.0));
        assert!(!dir
            .read_dir()
            .unwrap()
            .flatten()
            .any(|e| e.path().extension() == Some("part".as_ref())));
        // The same unchanged source reuses its proxy.
        assert_eq!(
            ff.make_proxy(tools, &dir, &src, "t2", &|_| {}).unwrap(),
            out
        );
    }

    /// Cancel kills ffmpeg, removes the partial file and reports "canceled".
    #[test]
    fn cancel_stops_the_job() {
        let found = Command::new("ffmpeg").arg("-version").output().is_ok();
        if !found {
            return;
        }
        let dir = std::env::temp_dir().join(format!("ve-ffmpeg-cancel-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // Ten minutes of black: a tiny file that takes seconds to convert, so
        // the job is still running when it is canceled.
        let src = dir.join("long.mp4");
        let made = Command::new("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i"])
            .args([
                "color=black:s=640x360:r=30:d=600",
                "-c:v",
                "mpeg4",
                "-q:v",
                "31",
            ])
            .arg(&src)
            .status()
            .unwrap();
        assert!(made.success());
        let ff = Arc::new(Ffmpeg::default());
        let canceler = {
            let ff = ff.clone();
            std::thread::spawn(move || {
                for _ in 0..100 {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    if ff.running.lock().unwrap().contains_key("long") {
                        std::thread::sleep(std::time::Duration::from_millis(300));
                        ff.cancel("long");
                        return;
                    }
                }
            })
        };
        let out = dir.join("proxies");
        let res = ff.make_proxy(
            (Path::new("ffmpeg"), Path::new("ffprobe")),
            &out,
            &src,
            "long",
            &|_| {},
        );
        canceler.join().unwrap();
        assert_eq!(res.unwrap_err(), "canceled");
        assert_eq!(
            std::fs::read_dir(&out).unwrap().count(),
            0,
            "no partial file left"
        );
    }
}
