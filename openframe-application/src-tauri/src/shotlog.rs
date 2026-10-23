//! Source measurements, sampled pictures, and atomic shot-log storage.
use crate::{ffmpeg, files};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdout, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, Manager};

const W: usize = 64;
const H: usize = 36;
const PIXELS: usize = W * H;
const STEP: f64 = 0.5;
const AUDIO_STEP: f64 = 0.1;
#[derive(Serialize, Debug)]
pub struct Measures {
    duration: f64,
    width: u32,
    height: u32,
    frame_rate: f64,
    scene: Vec<f32>,
    step: f64,
    luma: Vec<f32>,
    motion: Vec<f32>,
    dx: Vec<f32>,
    dy: Vec<f32>,
    rgb: Vec<[u8; 3]>,
    audio_step: f64,
    audio_db: Vec<f32>,
}
#[derive(Default)]
struct Running {
    children: Mutex<Vec<Arc<Mutex<Child>>>>,
    canceled: AtomicBool,
}
impl Running {
    fn cancel(&self) {
        self.canceled.store(true, Ordering::SeqCst);
        self.kill();
    }
    fn kill(&self) {
        for child in self.children.lock().unwrap().iter() {
            let _ = child.lock().unwrap().kill();
        }
    }
    fn check(&self) -> Result<(), String> {
        if self.canceled.load(Ordering::SeqCst) {
            Err("canceled".into())
        } else {
            Ok(())
        }
    }
}
#[derive(Default)]
pub struct Shotlog {
    running: Mutex<HashMap<String, Arc<Running>>>,
    saves: Mutex<()>,
    frame_jobs: Mutex<()>,
    #[cfg(windows)]
    job: ffmpeg::job::KillOnClose,
}
// A pipe has one reader, while cancellation retains access to the process handle.
struct Process {
    child: Arc<Mutex<Child>>,
    stdout: ChildStdout,
    errors: Option<std::thread::JoinHandle<String>>,
}
impl Process {
    fn finish(&mut self, running: &Running) -> Result<(), String> {
        let status = loop {
            running.check()?;
            if let Some(s) = self
                .child
                .lock()
                .unwrap()
                .try_wait()
                .map_err(|e| e.to_string())?
            {
                break s;
            }
            std::thread::sleep(Duration::from_millis(20));
        };
        let errors = self
            .errors
            .take()
            .map(|t| t.join().unwrap_or_default())
            .unwrap_or_default();
        running.check()?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("ffmpeg exited with {status}: {errors}"))
        }
    }
}
impl Drop for Process {
    fn drop(&mut self) {
        let mut child = self.child.lock().unwrap();
        let _ = child.kill();
        let _ = child.wait();
        drop(child);
        if let Some(errors) = self.errors.take() {
            let _ = errors.join();
        }
    }
}
impl Shotlog {
    pub fn kill_all(&self) {
        for running in self.running.lock().unwrap().values() {
            running.cancel();
        }
    }
    fn spawn(
        &self,
        exe: &Path,
        args: &[&str],
        path: &Path,
        output_args: &[&str],
        running: &Running,
    ) -> Result<Process, String> {
        running.check()?;
        // Register under the same lock cancellation uses, so cancel cannot miss a new child.
        let mut children = running.children.lock().unwrap();
        running.check()?;
        let mut child = ffmpeg::command(exe)
            .args(args)
            .arg(path)
            .args(output_args)
            .spawn()
            .map_err(|e| format!("Could not start ffmpeg: {e}"))?;
        #[cfg(windows)]
        self.job.assign(&child);
        let stdout = child.stdout.take().ok_or("Missing ffmpeg output pipe")?;
        let mut stderr = child.stderr.take().ok_or("Missing ffmpeg error pipe")?;
        let errors = std::thread::spawn(move || {
            // Drain continuously, retaining only the final error text.
            let mut tail = Vec::new();
            let mut buf = [0; 4096];
            while let Ok(n) = stderr.read(&mut buf) {
                if n == 0 {
                    break;
                }
                tail.extend_from_slice(&buf[..n]);
                if tail.len() > 8192 {
                    tail.drain(..tail.len() - 8192);
                }
            }
            String::from_utf8_lossy(&tail).into_owned()
        });
        let child = Arc::new(Mutex::new(child));
        children.push(child.clone());
        Ok(Process {
            child,
            stdout,
            errors: Some(errors),
        })
    }
    fn measure(
        &self,
        tools: (&Path, &Path),
        path: &Path,
        job: &str,
        progress: &dyn Fn(f64),
    ) -> Result<Measures, String> {
        let running = Arc::new(Running::default());
        {
            let mut jobs = self.running.lock().unwrap();
            if jobs.contains_key(job) {
                return Err(format!("Shot-log job {job} is already running"));
            }
            jobs.insert(job.into(), running.clone());
        }
        let result = (|| {
            let info = ffmpeg::probe(tools.1, path)?;
            running.check()?;
            let video = info.video.ok_or("The file has no video stream")?;
            let fps = video
                .fps
                .filter(|f| f.is_finite() && *f > 0.0)
                .unwrap_or(30.0)
                .min(30.0);
            std::thread::scope(|scope| {
                let audio = info
                    .audio
                    .map(|_| scope.spawn(|| self.audio(tools.0, path, &running)));
                let timing = (fps, info.duration);
                let mut result = self.video(tools.0, path, &running, timing, progress, true);
                // Hardware decoders fail on some codecs (FFV1 lost the Vulkan
                // device on the lead's machine): decode once more in software.
                if result.is_err() && !running.canceled.load(Ordering::SeqCst) {
                    result = self.video(tools.0, path, &running, timing, progress, false);
                }
                if result.is_err() {
                    running.kill();
                }
                let audio_db = audio
                    .map(|t| {
                        t.join()
                            .unwrap_or_else(|_| Err("Audio measurement failed".into()))
                    })
                    .unwrap_or_else(|| Ok(Vec::new()));
                // Audio and video failures both tear down the entire job.
                let mut measured = result?;
                measured.audio_db = audio_db?;
                measured.width = video.width;
                measured.height = video.height;
                running.check()?;
                progress(1.0);
                Ok(measured)
            })
        })();
        running.kill();
        // Every Process reaps its child before the job leaves the map.
        self.running.lock().unwrap().remove(job);
        if running.canceled.load(Ordering::SeqCst) {
            Err("canceled".into())
        } else {
            result
        }
    }
    fn audio(&self, exe: &Path, path: &Path, running: &Running) -> Result<Vec<f32>, String> {
        let mut process = self.spawn(
            exe,
            &["-hide_banner", "-nostdin", "-v", "error", "-i"],
            path,
            &[
                "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-",
            ],
            running,
        )?;
        let mut buf = [0u8; 3200];
        let mut values = Vec::new();
        loop {
            running.check()?;
            let n = read_block(&mut process.stdout, &mut buf)?;
            if n == 0 {
                break;
            }
            if n % 2 != 0 {
                return Err("Truncated audio sample".into());
            }
            values.push(rms_db(&buf[..n]));
            if n < buf.len() {
                break;
            }
        }
        process.finish(running)?;
        Ok(values)
    }
    fn video(
        &self,
        exe: &Path,
        path: &Path,
        running: &Running,
        timing: (f64, f64),
        progress: &dyn Fn(f64),
        hardware: bool,
    ) -> Result<Measures, String> {
        let (fps, duration) = timing;
        let filter = format!("fps={fps},scale=64:36:flags=area,format=rgb24");
        let mut input = vec!["-hide_banner", "-nostdin", "-v", "error"];
        if hardware {
            input.extend(["-hwaccel", "auto"]);
        }
        input.push("-i");
        let mut process = self.spawn(
            exe,
            &input,
            path,
            &[
                "-map", "0:v:0", "-an", "-vf", &filter, "-f", "rawvideo", "-",
            ],
            running,
        )?;
        let mut result = Measures {
            duration,
            width: 0,
            height: 0,
            frame_rate: fps,
            scene: Vec::new(),
            step: STEP,
            luma: Vec::new(),
            motion: Vec::new(),
            dx: Vec::new(),
            dy: Vec::new(),
            rgb: Vec::new(),
            audio_step: AUDIO_STEP,
            audio_db: Vec::new(),
        };
        let mut bytes = [0; PIXELS * 3];
        let mut previous: Option<Picture> = None;
        let mut bin = Bin::default();
        let mut bin_index = 0usize;
        let mut last_progress = Instant::now();
        progress(0.0);
        loop {
            running.check()?;
            let n = read_block(&mut process.stdout, &mut bytes)?;
            if n == 0 {
                break;
            }
            if n != bytes.len() {
                return Err("Truncated video frame".into());
            }
            let picture = Picture::new(&bytes);
            let frame = result.scene.len();
            let index = ((frame as f64 / fps) / STEP).floor() as usize;
            if index != bin_index {
                bin.flush(&mut result, fps);
                fill_steps(&mut result, index);
                bin_index = index;
            }
            let delta = previous
                .as_ref()
                .map(|p| difference(p, &picture))
                .unwrap_or_default();
            result.scene.push(delta.scene);
            bin.add(&picture, delta);
            previous = Some(picture);
            if last_progress.elapsed() >= Duration::from_millis(100) {
                progress(if duration > 0.0 {
                    (result.scene.len() as f64 / (duration * fps)).clamp(0.0, 0.999)
                } else {
                    0.0
                });
                last_progress = Instant::now();
            }
        }
        bin.flush(&mut result, fps);
        let steps = (result.scene.len() as f64 / fps / STEP).ceil() as usize;
        fill_steps(&mut result, steps);
        process.finish(running)?;
        if result.scene.is_empty() {
            return Err("The file decoded no video frames".into());
        }
        Ok(result)
    }
}
// Low-frame-rate footage can have no decoded picture in a half-second bin.
// Hold the previous picture's level/color at those times; there was no new motion.
fn fill_steps(result: &mut Measures, steps: usize) {
    while result.luma.len() < steps {
        result.luma.push(result.luma.last().copied().unwrap_or(0.0));
        result
            .rgb
            .push(result.rgb.last().copied().unwrap_or([0; 3]));
        result.motion.push(0.0);
        result.dx.push(0.0);
        result.dy.push(0.0);
    }
}
fn read_block(reader: &mut impl Read, buf: &mut [u8]) -> Result<usize, String> {
    let mut n = 0;
    while n < buf.len() {
        match reader.read(&mut buf[n..]) {
            Ok(0) => break,
            Ok(count) => n += count,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(n)
}
struct Picture {
    luma: [f32; PIXELS],
    histogram: [f32; 16],
    mean: f32,
    rgb: [f32; 3],
}
impl Picture {
    fn new(bytes: &[u8]) -> Self {
        let mut p = Self {
            luma: [0.0; PIXELS],
            histogram: [0.0; 16],
            mean: 0.0,
            rgb: [0.0; 3],
        };
        for (i, pixel) in bytes.as_chunks::<3>().0.iter().enumerate() {
            let y =
                (0.2126 * pixel[0] as f32 + 0.7152 * pixel[1] as f32 + 0.0722 * pixel[2] as f32)
                    / 255.0;
            p.luma[i] = y;
            p.mean += y / PIXELS as f32;
            p.histogram[((y * 16.0) as usize).min(15)] += 1.0 / PIXELS as f32;
            for (c, &value) in pixel.iter().enumerate() {
                p.rgb[c] += value as f32 / PIXELS as f32;
            }
        }
        p
    }
}
#[derive(Default, Clone, Copy)]
struct Difference {
    scene: f32,
    motion: f32,
    dx: f32,
    dy: f32,
}
fn difference(previous: &Picture, current: &Picture) -> Difference {
    let motion = previous
        .luma
        .iter()
        .zip(current.luma.iter())
        .map(|(a, b)| (a - b).abs())
        .sum::<f32>()
        / PIXELS as f32;
    let hist = previous
        .histogram
        .iter()
        .zip(current.histogram.iter())
        .map(|(a, b)| (a - b).abs())
        .sum::<f32>()
        / 2.0;
    // Fixed inner rectangle makes all candidate shifts comparable. Start at zero
    // and require improvement, so a flat picture never invents camera movement.
    let score = |dx: i32, dy: i32| {
        let mut sum = 0.0;
        for y in 3..H - 3 {
            for x in 3..W - 3 {
                sum += (previous.luma[y * W + x]
                    - current.luma[(y as i32 + dy) as usize * W + (x as i32 + dx) as usize])
                    .abs();
            }
        }
        sum / ((W - 6) * (H - 6)) as f32
    };
    let mut best = (0, 0);
    let mut error = score(0, 0);
    for dy in -3..=3 {
        for dx in -3..=3 {
            let candidate = score(dx, dy);
            if candidate + 0.0001 < error {
                error = candidate;
                best = (dx, dy);
            }
        }
    }
    // Motion-compensated luma distinguishes a pan from a cut; the histogram
    // catches a change in composition even when average brightness is similar.
    let scene = (hist + (1.0 - hist) * (error * 3.0).min(1.0)).clamp(0.0, 1.0);
    // A cut has no meaningful camera displacement.
    let (dx, dy) = if scene > 0.5 { (0, 0) } else { best };
    Difference {
        scene,
        motion,
        dx: dx as f32,
        dy: dy as f32,
    }
}
#[derive(Default)]
struct Bin {
    count: usize,
    luma: f32,
    motion: f32,
    dx: f32,
    dy: f32,
    rgb: [f32; 3],
}
impl Bin {
    fn add(&mut self, picture: &Picture, delta: Difference) {
        self.count += 1;
        self.luma += picture.mean;
        self.motion += delta.motion;
        self.dx += delta.dx;
        self.dy += delta.dy;
        for c in 0..3 {
            self.rgb[c] += picture.rgb[c];
        }
    }
    fn flush(&mut self, result: &mut Measures, fps: f64) {
        if self.count == 0 {
            return;
        }
        let count = self.count as f32;
        result.luma.push((self.luma / count).clamp(0.0, 1.0));
        result.motion.push((self.motion / count).clamp(0.0, 1.0));
        // Divide by the actual represented sample time, including partial final bins.
        let seconds = self.count as f32 / fps as f32;
        result.dx.push(self.dx / W as f32 / seconds);
        result.dy.push(self.dy / H as f32 / seconds);
        result.rgb.push(
            self.rgb
                .map(|c| (c / count).round().clamp(0.0, 255.0) as u8),
        );
        *self = Self::default();
    }
}
fn rms_db(bytes: &[u8]) -> f32 {
    if bytes.is_empty() {
        return -90.0;
    }
    let sum = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|b| {
            let v = i16::from_le_bytes([b[0], b[1]]) as f64 / 32768.0;
            v * v
        })
        .sum::<f64>();
    (10.0 * (sum / (bytes.len() / 2) as f64).log10()).max(-90.0) as f32
}
// JPEG output is encoded directly, avoiding an additional dependency for IPC.
pub(crate) fn base64(bytes: &[u8]) -> String {
    const ABC: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for b in bytes.chunks(3) {
        let n = ((b[0] as u32) << 16)
            | ((b.get(1).copied().unwrap_or(0) as u32) << 8)
            | b.get(2).copied().unwrap_or(0) as u32;
        out.push(ABC[(n >> 18) as usize] as char);
        out.push(ABC[((n >> 12) & 63) as usize] as char);
        out.push(if b.len() > 1 {
            ABC[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if b.len() > 2 {
            ABC[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}
fn frames(
    state: &Shotlog,
    tools: (&Path, &Path),
    path: &Path,
    times: Vec<f64>,
    width: u32,
) -> Result<Vec<String>, String> {
    let _frames = state.frame_jobs.lock().unwrap();
    if !(2..=8192).contains(&width) {
        return Err("Frame width must be between 2 and 8192 pixels".into());
    }
    if times.iter().any(|t| !t.is_finite()) {
        return Err("Frame times must be finite seconds".into());
    }
    let info = ffmpeg::probe(tools.1, path)?;
    let fps = info
        .video
        .ok_or("The file has no video stream")?
        .fps
        .filter(|f| f.is_finite() && *f > 0.0)
        .unwrap_or(30.0);
    let last = (info.duration - 1.0 / fps).max(0.0);
    // Batches cap subprocesses at three and preserve input order.
    let mut result = Vec::with_capacity(times.len());
    for batch in times.chunks(3) {
        let answers = std::thread::scope(|scope| {
            let handles: Vec<_> = batch
                .iter()
                .map(|&t| {
                    scope.spawn(move || {
                        let child = ffmpeg::command(tools.0)
                            .args(["-v", "error", "-ss", &t.clamp(0.0, last).to_string(), "-i"])
                            .arg(path)
                            .args([
                                "-frames:v",
                                "1",
                                "-vf",
                                &format!("scale={width}:-2"),
                                "-q:v",
                                "4",
                                "-f",
                                "image2pipe",
                                "-c:v",
                                "mjpeg",
                                "-",
                            ])
                            .stdin(Stdio::null())
                            .spawn()
                            .map_err(|e| e.to_string())?;
                        #[cfg(windows)]
                        state.job.assign(&child);
                        #[cfg(not(windows))]
                        let _ = state;
                        let out = child.wait_with_output().map_err(|e| e.to_string())?;
                        if !out.status.success() || out.stdout.is_empty() {
                            return Err(format!(
                                "Could not extract frame at {t}: {}",
                                String::from_utf8_lossy(&out.stderr)
                            ));
                        }
                        Ok(base64(&out.stdout))
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|h| {
                    h.join()
                        .unwrap_or_else(|_| Err("Frame extraction failed".into()))
                })
                .collect::<Vec<Result<String, String>>>()
        });
        result.extend(answers.into_iter().collect::<Result<Vec<_>, _>>()?);
    }
    Ok(result)
}
fn log_path(app: &tauri::AppHandle, path: &str) -> Result<PathBuf, String> {
    let key = ffmpeg::cache_key(Path::new(path))?;
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("shotlogs");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{key}.json")))
}
fn save(path: &Path, json: &str) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    let result = (|| {
        let mut file = File::create(&tmp)?;
        file.write_all(json.as_bytes())?;
        file.sync_all()?;
        drop(file);
        files::replace(&tmp, path)
    })()
    .map_err(|e: std::io::Error| e.to_string());
    if result.is_err() {
        let _ = fs::remove_file(tmp);
    }
    result
}
#[tauri::command(rename_all = "snake_case")]
pub async fn shotlog_measure(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Shotlog>>,
    path: String,
    job: String,
    on_progress: Channel<f64>,
) -> Result<Measures, String> {
    let state = state.inner().clone();
    let ffmpeg = ffmpeg::tool(&app, "ffmpeg");
    let ffprobe = ffmpeg::tool(&app, "ffprobe");
    tauri::async_runtime::spawn_blocking(move || {
        state.measure((&ffmpeg, &ffprobe), Path::new(&path), &job, &|f| {
            let _ = on_progress.send(f);
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn shotlog_cancel(state: tauri::State<'_, Arc<Shotlog>>, job: String) {
    if let Some(running) = state.running.lock().unwrap().get(&job) {
        running.cancel();
    }
}
#[tauri::command]
pub async fn shotlog_frames(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Shotlog>>,
    path: String,
    times: Vec<f64>,
    width: u32,
) -> Result<Vec<String>, String> {
    let state = state.inner().clone();
    let ffmpeg = ffmpeg::tool(&app, "ffmpeg");
    let ffprobe = ffmpeg::tool(&app, "ffprobe");
    tauri::async_runtime::spawn_blocking(move || {
        frames(&state, (&ffmpeg, &ffprobe), Path::new(&path), times, width)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn shotlog_load(app: tauri::AppHandle, path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || match fs::read_to_string(log_path(&app, &path)?) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn shotlog_save(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Shotlog>>,
    path: String,
    json: String,
) -> Result<(), String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = state.saves.lock().unwrap();
        save(&log_path(&app, &path)?, &json)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn texture() -> Vec<u8> {
        (0..PIXELS)
            .flat_map(|i| {
                let v = ((i * 73 + i * i * 13 + (i / W) * 37) % 256) as u8;
                [v, v, v]
            })
            .collect()
    }
    #[test]
    fn identical_pictures_are_still_and_flat_hard_cuts_are_large() {
        let black = Picture::new(&[0; PIXELS * 3]);
        let white = Picture::new(&[255; PIXELS * 3]);
        let same = difference(&black, &black);
        assert_eq!(same.scene, 0.0);
        assert_eq!(same.dx, 0.0);
        assert_eq!(same.dy, 0.0);
        assert_eq!(same.motion, 0.0);
        assert!(difference(&black, &white).scene > 0.99);
        let dark = Picture::new(&[40; PIXELS * 3]);
        let gray = Picture::new(&[180; PIXELS * 3]);
        assert!(difference(&dark, &gray).scene > 0.95);
        let red = Picture::new(&[255, 0, 0].repeat(PIXELS));
        let blue = Picture::new(&[0, 0, 255].repeat(PIXELS));
        assert!(difference(&red, &blue).scene > 0.99);
    }
    #[test]
    fn pan_has_small_scene_score_and_positive_two_pixel_displacement() {
        let bytes = texture();
        let mut shifted = vec![0; bytes.len()];
        for y in 0..H {
            for x in 2..W {
                for c in 0..3 {
                    shifted[(y * W + x) * 3 + c] = bytes[(y * W + x - 2) * 3 + c];
                }
            }
        }
        let a = Picture::new(&bytes);
        let b = Picture::new(&shifted);
        let delta = difference(&a, &b);
        assert!(delta.scene < 0.08, "{}", delta.scene);
        assert_eq!(delta.dx, 2.0);
        assert_eq!(delta.dy, 0.0);
        let mut bin = Bin::default();
        for _ in 0..15 {
            bin.add(&b, delta);
        }
        let mut m = Measures {
            duration: 0.5,
            width: 64,
            height: 36,
            frame_rate: 30.0,
            scene: vec![],
            step: STEP,
            luma: vec![],
            motion: vec![],
            dx: vec![],
            dy: vec![],
            rgb: vec![],
            audio_step: AUDIO_STEP,
            audio_db: vec![],
        };
        bin.flush(&mut m, 30.0);
        assert!((m.dx[0] - 0.9375).abs() < 0.0001);
        assert_eq!(m.dy[0], 0.0);
        assert_eq!(difference(&b, &a).dx, -2.0);
    }
    #[test]
    fn sine_rms_and_silence_have_known_dbfs() {
        assert_eq!(rms_db(&[0; 3200]), -90.0);
        let bytes: Vec<_> = (0..1600)
            .flat_map(|i| {
                ((0.5 * (std::f64::consts::TAU * 1000.0 * i as f64 / 16000.0).sin() * 32768.0)
                    .round() as i16)
                    .to_le_bytes()
            })
            .collect();
        assert!(
            (rms_db(&bytes) + 9.0309).abs() < 0.002,
            "{}",
            rms_db(&bytes)
        );
    }
    #[test]
    fn base64_padding_and_binary_bytes() {
        for (input, expected) in [
            (b"".as_slice(), ""),
            (b"f", "Zg=="),
            (b"fo", "Zm8="),
            (b"foo", "Zm9v"),
            (&[255, 0, 254], "/wD+"),
        ] {
            assert_eq!(base64(input), expected);
        }
    }
    #[test]
    fn atomic_log_replaces_complete_document() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../scratch/shotlog-tests");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("atomic.json");
        save(&path, "{\"one\":1}").unwrap();
        save(&path, "{\"two\":2}").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "{\"two\":2}");
        assert!(!path.with_extension("json.tmp").exists());
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn reads_a_final_partial_audio_block() {
        let mut input = b"abc".as_slice();
        let mut out = [0; 10];
        assert_eq!(read_block(&mut input, &mut out).unwrap(), 3);
        assert_eq!(&out[..3], b"abc");
    }
    #[test]
    fn empty_half_second_bins_hold_the_picture_without_motion() {
        let mut m = Measures {
            duration: 2.0,
            width: 64,
            height: 36,
            frame_rate: 1.0,
            scene: vec![],
            step: STEP,
            luma: vec![0.5],
            motion: vec![0.2],
            dx: vec![0.1],
            dy: vec![0.0],
            rgb: vec![[1, 2, 3]],
            audio_step: AUDIO_STEP,
            audio_db: vec![],
        };
        fill_steps(&mut m, 4);
        assert_eq!(m.luma, vec![0.5; 4]);
        assert_eq!(m.rgb, vec![[1, 2, 3]; 4]);
        assert_eq!(m.motion, vec![0.2, 0.0, 0.0, 0.0]);
        assert_eq!(m.dx, vec![0.1, 0.0, 0.0, 0.0]);
    }
    #[test]
    fn canceled_job_cannot_launch_a_decoder() {
        let running = Running::default();
        running.cancel();
        let state = Shotlog::default();
        let result = state.spawn(
            Path::new("not-an-executable"),
            &[],
            Path::new("unused"),
            &[],
            &running,
        );
        assert_eq!(result.err().unwrap(), "canceled");
        assert!(running.children.lock().unwrap().is_empty());
    }
    #[test]
    fn cancellation_kills_both_decoders_and_reaps_them() {
        if ffmpeg::command(Path::new("ffmpeg"))
            .arg("-version")
            .output()
            .is_err()
        {
            return;
        }
        let state = Shotlog::default();
        let running = Running::default();
        let before = ["-v", "error", "-re", "-f", "lavfi", "-i"];
        let mut video = state
            .spawn(
                Path::new("ffmpeg"),
                &before,
                Path::new("testsrc=size=64x36:rate=30:duration=30"),
                &["-f", "rawvideo", "-"],
                &running,
            )
            .unwrap();
        let mut audio = state
            .spawn(
                Path::new("ffmpeg"),
                &before,
                Path::new("sine=frequency=1000:duration=30"),
                &["-f", "s16le", "-"],
                &running,
            )
            .unwrap();
        assert_eq!(running.children.lock().unwrap().len(), 2);
        running.cancel();
        assert_eq!(video.finish(&running).unwrap_err(), "canceled");
        assert_eq!(audio.finish(&running).unwrap_err(), "canceled");
        drop(video);
        drop(audio);
        for child in running.children.lock().unwrap().iter() {
            assert!(child.lock().unwrap().try_wait().unwrap().is_some());
        }
    }
    #[test]
    #[ignore = "requires OPENFRAME_TEST_VIDEO and ffmpeg/ffprobe on PATH"]
    fn measures_real_video() {
        let path =
            PathBuf::from(std::env::var_os("OPENFRAME_TEST_VIDEO").expect("OPENFRAME_TEST_VIDEO"));
        let started = Instant::now();
        let state = Shotlog::default();
        let m = state
            .measure(
                (Path::new("ffmpeg"), Path::new("ffprobe")),
                &path,
                "integration",
                &|_| {},
            )
            .unwrap();
        println!(
            "duration={} frames={} cuts_above_0.5={} elapsed={:?}",
            m.duration,
            m.scene.len(),
            m.scene.iter().filter(|&&s| s > 0.5).count(),
            started.elapsed()
        );
        assert!(!m.scene.is_empty());
        assert_eq!(m.scene[0], 0.0);
        assert!(m.frame_rate <= 30.0);
        assert!(m.scene.iter().all(|v| (0.0..=1.0).contains(v)));
        assert!(m.luma.iter().all(|v| (0.0..=1.0).contains(v)));
        assert!(m.motion.iter().all(|v| (0.0..=1.0).contains(v)));
        assert!(m.audio_db.iter().all(|v| (-90.0..=0.0).contains(v)));
        assert_eq!(
            m.luma.len(),
            (m.scene.len() as f64 / m.frame_rate / STEP).ceil() as usize
        );
        assert_eq!(m.luma.len(), m.motion.len());
        assert_eq!(m.luma.len(), m.dx.len());
        assert_eq!(m.luma.len(), m.rgb.len());
        let pictures = frames(
            &state,
            (Path::new("ffmpeg"), Path::new("ffprobe")),
            &path,
            vec![-1.0, m.duration / 2.0, m.duration + 1.0],
            320,
        )
        .unwrap();
        assert_eq!(pictures.len(), 3);
        assert!(pictures.iter().all(|p| p.starts_with("/9j/")));
    }
}
