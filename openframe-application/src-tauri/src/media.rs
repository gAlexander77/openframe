//! The `media:` protocol: byte ranges of the user's files, served to the
//! webview's media engine (ADR-010).
//!
//! The webview never names a file in a URL. It registers a path once
//! (`media_register`, called with paths from the open dialog, an OS drop or a
//! project the user opened) and gets back an opaque id; the protocol only
//! serves registered ids, so a stray `<img src>` cannot read arbitrary files.
//! Handles stay open and are read positionally, so concurrent requests never
//! fight over a cursor, and Rust's `File::open` shares read, write and delete
//! on Windows, so the app never locks the user's media.

use std::{
    collections::HashMap,
    fs::File,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
    time::SystemTime,
};
use tauri::http::{header, response::Builder, Method, Request, Response};

/// Tauri buffers a protocol response body whole (custom protocols do not
/// stream), so one response is capped; the client asks again for the rest.
/// 8 MiB matches mediabunny's largest prefetch (research §1.3).
pub const MAX_RESPONSE: u64 = 8 << 20;

struct MediaFile {
    file: File,
    len: u64,
    modified: Option<SystemTime>,
    mime: &'static str,
}

#[derive(Default)]
pub struct Media {
    inner: RwLock<Registry>,
}

#[derive(Default)]
struct Registry {
    next: u64,
    by_id: HashMap<String, Arc<MediaFile>>,
    by_path: HashMap<PathBuf, String>,
}

#[derive(serde::Serialize, Debug, Clone, PartialEq)]
pub struct Registered {
    pub id: String,
    pub size: u64,
}

impl Media {
    /// Open a file for serving and return its id. Registering the same
    /// unchanged file again returns the same id, so every `sourceFor` of a
    /// clip shares one handle; a file that changed on disk gets a new id.
    pub fn register(&self, path: &Path) -> Result<Registered, String> {
        let shown = || path.display().to_string();
        let meta = std::fs::metadata(path).map_err(|e| format!("{}: {e}", shown()))?;
        if !meta.is_file() {
            return Err(format!("{} is not a file", shown()));
        }
        let modified = meta.modified().ok();
        {
            let reg = self.inner.read().unwrap();
            if let Some(id) = reg.by_path.get(path) {
                let m = &reg.by_id[id];
                if m.len == meta.len() && m.modified == modified {
                    return Ok(Registered {
                        id: id.clone(),
                        size: m.len,
                    });
                }
            }
        }
        let file = File::open(path).map_err(|e| format!("{}: {e}", shown()))?;
        let entry = Arc::new(MediaFile {
            file,
            len: meta.len(),
            modified,
            mime: mime_for(path),
        });
        let mut reg = self.inner.write().unwrap();
        reg.next += 1;
        let id = format!("m{}", reg.next);
        if let Some(old) = reg.by_path.insert(path.to_path_buf(), id.clone()) {
            // Drop the stale handle so the old version can be replaced.
            reg.by_id.remove(&old);
        }
        reg.by_id.insert(id.clone(), entry);
        Ok(Registered {
            id,
            size: meta.len(),
        })
    }

    fn get(&self, id: &str) -> Option<Arc<MediaFile>> {
        self.inner.read().unwrap().by_id.get(id).cloned()
    }
}

/// Register a file for the protocol; answers `{ id, size }`.
#[tauri::command]
pub async fn media_register(
    path: PathBuf,
    media: tauri::State<'_, Arc<Media>>,
) -> Result<Registered, String> {
    media.register(&path)
}

/// The type matters for `Blob`s: `createImageBitmap` needs `image/svg+xml`
/// to decode an SVG; everything else is sniffed from the bytes.
fn mime_for(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "mp4" | "m4v" => "video/mp4",
        "m4a" => "audio/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "aac" => "audio/aac",
        "flac" => "audio/flac",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

fn cors() -> Builder {
    Response::builder()
        .header("Access-Control-Allow-Origin", "*")
        .header(
            "Access-Control-Expose-Headers",
            "Content-Range, Content-Length, Accept-Ranges",
        )
        // Lets the page load media even under COEP (research §8.3).
        .header("Cross-Origin-Resource-Policy", "cross-origin")
}

fn empty(b: Builder, status: u16) -> Response<Vec<u8>> {
    b.status(status).body(Vec::new()).unwrap()
}

fn failed(e: std::io::Error) -> Response<Vec<u8>> {
    cors().status(500).body(e.to_string().into_bytes()).unwrap()
}

/// Answer one protocol request. Runs on a blocking thread (see `lib.rs`).
pub fn respond(req: &Request<Vec<u8>>, media: &Media) -> Response<Vec<u8>> {
    if req.method() == Method::OPTIONS {
        // Preflight: browsers send one for non-"simple" ranges like `bytes=-500`.
        return empty(
            cors()
                .header("Access-Control-Allow-Methods", "GET, HEAD")
                .header("Access-Control-Allow-Headers", "Range")
                .header("Access-Control-Max-Age", "600"),
            204,
        );
    }
    let id = req.uri().path().trim_start_matches('/');
    let Some(m) = media.get(id) else {
        return empty(cors(), 404);
    };
    let ok = cors()
        .header(header::CONTENT_TYPE, m.mime)
        .header(header::ACCEPT_RANGES, "bytes");
    let unsatisfiable = || {
        empty(
            cors().header(header::CONTENT_RANGE, format!("bytes */{}", m.len)),
            416,
        )
    };
    let Some(range) = req
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
    else {
        if req.method() == Method::HEAD {
            return empty(ok.header(header::CONTENT_LENGTH, m.len), 200);
        }
        if m.len > MAX_RESPONSE {
            // A whole-file GET of a video would sit in RAM twice; make the
            // client ask for ranges instead.
            return unsatisfiable();
        }
        return match read(&m.file, 0, m.len) {
            Ok(buf) => ok
                .status(200)
                .header(header::CONTENT_LENGTH, buf.len())
                .body(buf)
                .unwrap(),
            Err(e) => failed(e),
        };
    };
    let Some((start, end)) = parse_range(range, m.len) else {
        return unsatisfiable();
    };
    let end = end.min(start + MAX_RESPONSE - 1); // a short 206: the client asks again
    match read(&m.file, start, end + 1 - start) {
        Ok(buf) => ok
            .status(206)
            .header(
                header::CONTENT_RANGE,
                format!("bytes {start}-{end}/{}", m.len),
            )
            .header(header::CONTENT_LENGTH, buf.len())
            .body(buf)
            .unwrap(),
        Err(e) => failed(e),
    }
}

/// One range, inclusive, from `bytes=a-b`, `bytes=a-` or `bytes=-n`. A
/// multi-range or an unsatisfiable one is `None` (answered with 416).
pub fn parse_range(h: &str, len: u64) -> Option<(u64, u64)> {
    let spec = h.trim().strip_prefix("bytes=")?.trim();
    if spec.contains(',') || len == 0 {
        return None;
    }
    let (a, b) = spec.split_once('-')?;
    let (a, b) = (a.trim(), b.trim());
    let (start, end) = if a.is_empty() {
        let n: u64 = b.parse().ok()?;
        (len.checked_sub(n.min(len))?, len - 1)
    } else {
        let s: u64 = a.parse().ok()?;
        let e = if b.is_empty() {
            len - 1
        } else {
            b.parse::<u64>().ok()?.min(len - 1)
        };
        (s, e)
    };
    (start <= end && start < len).then_some((start, end))
}

/// Read `count` bytes at `offset` without moving a shared cursor.
pub fn read(file: &File, offset: u64, count: u64) -> std::io::Result<Vec<u8>> {
    let mut buf = vec![0; count as usize];
    let (mut done, mut off) = (0, offset);
    while done < buf.len() {
        #[cfg(windows)]
        let n = std::os::windows::fs::FileExt::seek_read(file, &mut buf[done..], off)?;
        #[cfg(unix)]
        let n = std::os::unix::fs::FileExt::read_at(file, &mut buf[done..], off)?;
        if n == 0 {
            return Err(std::io::ErrorKind::UnexpectedEof.into());
        }
        done += n;
        off += n as u64;
    }
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=0-", 1000), Some((0, 999)));
        assert_eq!(parse_range("bytes=990-5000", 1000), Some((990, 999)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=-5000", 1000), Some((0, 999)));
        assert_eq!(parse_range(" bytes= 10 - 20 ", 1000), Some((10, 20)));
        assert_eq!(parse_range("bytes=999-999", 1000), Some((999, 999)));
    }

    #[test]
    fn unsatisfiable_ranges() {
        assert_eq!(parse_range("bytes=1000-", 1000), None); // past the end
        assert_eq!(parse_range("bytes=20-10", 1000), None); // backwards
        assert_eq!(parse_range("bytes=-0", 1000), None); // empty suffix
        assert_eq!(parse_range("bytes=0-1,4-5", 1000), None); // multi-range
        assert_eq!(parse_range("bytes=0-10", 0), None); // empty file
        assert_eq!(parse_range("items=0-10", 1000), None);
        assert_eq!(parse_range("bytes=a-b", 1000), None);
        assert_eq!(parse_range("bytes=5", 1000), None);
    }

    fn temp_file(name: &str, bytes: &[u8]) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ve-media-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join(name);
        std::fs::write(&p, bytes).unwrap();
        p
    }

    fn get(media: &Media, id: &str, range: Option<&str>) -> Response<Vec<u8>> {
        let mut b = Request::builder().uri(format!("http://media.localhost/{id}"));
        if let Some(r) = range {
            b = b.header(header::RANGE, r);
        }
        respond(&b.body(Vec::new()).unwrap(), media)
    }

    #[test]
    fn serves_registered_ranges() {
        let bytes: Vec<u8> = (0..=255).collect();
        let path = temp_file("ranges.bin", &bytes);
        let media = Media::default();
        let r = media.register(&path).unwrap();
        assert_eq!(r.size, 256);
        assert_eq!(media.register(&path).unwrap(), r, "same file, same id");

        let res = get(&media, &r.id, Some("bytes=10-19"));
        assert_eq!(res.status(), 206);
        assert_eq!(res.headers()[header::CONTENT_RANGE], "bytes 10-19/256");
        assert_eq!(res.body(), &bytes[10..20]);
        assert_eq!(res.headers()["Access-Control-Allow-Origin"], "*");

        let res = get(&media, &r.id, Some("bytes=-6"));
        assert_eq!(res.body(), &bytes[250..]);

        let res = get(&media, &r.id, None);
        assert_eq!(res.status(), 200);
        assert_eq!(res.body(), &bytes);

        assert_eq!(get(&media, &r.id, Some("bytes=300-")).status(), 416);
        assert_eq!(get(&media, "m999", Some("bytes=0-1")).status(), 404);
    }

    #[test]
    fn a_changed_file_gets_a_new_id() {
        let path = temp_file("changes.bin", b"one");
        let media = Media::default();
        let first = media.register(&path).unwrap();
        std::fs::write(&path, b"three").unwrap();
        let second = media.register(&path).unwrap();
        assert_ne!(first.id, second.id);
        assert_eq!(second.size, 5);
        assert_eq!(get(&media, &first.id, None).status(), 404);
    }

    #[test]
    fn refuses_folders() {
        let media = Media::default();
        assert!(media.register(&std::env::temp_dir()).is_err());
    }
}
