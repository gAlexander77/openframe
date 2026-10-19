//! The desktop MCP transport (ADR-009): a minimal HTTP server on 127.0.0.1
//! that forwards each JSON-RPC message to the webview, where
//! `window.videoEditor.mcp` handles it (ADR-008), and returns the reply.
//! Rust never interprets MCP itself. Off until the user turns on "Allow AI
//! agents"; every request needs the install's bearer token, and browser
//! origins other than localhost are refused (DNS-rebinding protection, as
//! the MCP spec requires for local servers).
//!
//! Also the `--mcp-stdio` bridge: the same exe run by an MCP client as a
//! process, piping stdin/stdout lines to the running app's server. A
//! client lists the tools once, when it connects; every answer names the
//! tool set it came from (`result._meta["openframe/tools"]`, src/lib/mcp.ts),
//! and the bridge sends `notifications/tools/list_changed` when that changes
//! (the app rebuilt with new tools while the client stayed connected), so
//! the client lists them again. Over HTTP a client reconnects instead.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

/// Fixed so a client's configuration keeps working across launches.
pub const PORT: u16 = 47280;
const MAX_BODY: usize = 8 * 1024 * 1024;

#[derive(Default)]
pub struct Mcp {
    running: Arc<AtomicBool>,
    pending: Arc<Mutex<HashMap<u64, mpsc::Sender<Option<String>>>>>,
    next: Arc<AtomicU64>,
}

#[derive(Serialize, Clone)]
pub struct McpInfo {
    pub url: String,
    pub token: String,
    pub stdio: String,
    /// This exe's path, for clients configured with a command and its
    /// arguments apart (Codex's config.toml).
    pub exe: String,
}

#[derive(Serialize, Clone)]
struct McpRequest {
    id: u64,
    body: String,
}

/// A random hex token from the OS-seeded hasher std already has.
// ponytail: RandomState is seeded from OS randomness; a dedicated CSPRNG
// crate is the upgrade if the token ever guards more than local editing.
fn random_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    (0..2)
        .map(|_| {
            let mut h = RandomState::new().build_hasher();
            h.write_u64(std::process::id() as u64);
            format!("{:016x}", h.finish())
        })
        .collect()
}

fn token_path(dir: &std::path::Path) -> PathBuf {
    dir.join("mcp-token.txt")
}

/// The install's token, created on first use.
fn token(dir: &std::path::Path) -> Result<String, String> {
    let p = token_path(dir);
    if let Ok(t) = std::fs::read_to_string(&p) {
        if t.trim().len() >= 16 {
            return Ok(t.trim().to_string());
        }
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let t = random_token();
    std::fs::write(&p, &t).map_err(|e| e.to_string())?;
    Ok(t)
}

/// What a request looked like, enough to route and authorize it.
#[derive(Debug, PartialEq)]
pub struct Parsed {
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

/// Read one HTTP/1.1 request. Minimal on purpose: MCP clients send small
/// JSON bodies with Content-Length.
pub fn read_request<R: Read>(stream: R) -> Result<Parsed, String> {
    let mut r = BufReader::new(stream);
    let mut line = String::new();
    r.read_line(&mut line).map_err(|e| e.to_string())?;
    let mut parts = line.split_whitespace();
    let method = parts.next().ok_or("empty request")?.to_string();
    let path = parts.next().ok_or("no path")?.to_string();
    let mut headers = HashMap::new();
    loop {
        let mut h = String::new();
        r.read_line(&mut h).map_err(|e| e.to_string())?;
        let h = h.trim_end();
        if h.is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    let len: usize = headers
        .get("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    if len > MAX_BODY {
        return Err("request too large".into());
    }
    let mut body = vec![0; len];
    r.read_exact(&mut body).map_err(|e| e.to_string())?;
    Ok(Parsed {
        method,
        path,
        headers,
        body,
    })
}

/// Browsers send Origin; a page on another site must not reach this server.
pub fn origin_allowed(origin: Option<&String>) -> bool {
    match origin {
        None => true,
        Some(o) => {
            let host = o
                .split("://")
                .nth(1)
                .unwrap_or("")
                .split(['/', ':'])
                .next()
                .unwrap_or("");
            matches!(host, "localhost" | "127.0.0.1" | "tauri.localhost")
        }
    }
}

fn respond(mut s: TcpStream, status: &str, content_type: &str, body: &str, extra: &str) {
    let msg = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n{body}",
        body.len()
    );
    let _ = s.write_all(msg.as_bytes());
}

fn handle(
    app: &AppHandle,
    s: TcpStream,
    token: &str,
    pending: &Mutex<HashMap<u64, mpsc::Sender<Option<String>>>>,
    next: &AtomicU64,
) {
    let _ = s.set_read_timeout(Some(Duration::from_secs(30)));
    let req = match read_request(&s) {
        Ok(r) => r,
        Err(e) => return respond(s, "400 Bad Request", "text/plain", &e, ""),
    };
    if req.path != "/mcp" {
        return respond(s, "404 Not Found", "text/plain", "not found", "");
    }
    if req.method != "POST" {
        // No server-initiated stream: every reply rides its POST.
        return respond(
            s,
            "405 Method Not Allowed",
            "text/plain",
            "POST only",
            "Allow: POST\r\n",
        );
    }
    if !origin_allowed(req.headers.get("origin")) {
        return respond(s, "403 Forbidden", "text/plain", "origin not allowed", "");
    }
    if req
        .headers
        .get("authorization")
        .map(|a| a.trim_start_matches("Bearer ").trim())
        != Some(token)
    {
        return respond(
            s,
            "401 Unauthorized",
            "text/plain",
            "missing or wrong token",
            "WWW-Authenticate: Bearer\r\n",
        );
    }
    let body = String::from_utf8_lossy(&req.body).to_string();
    let id = next.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel();
    pending.lock().unwrap().insert(id, tx);
    if app
        .emit_to("main", "mcp-request", McpRequest { id, body })
        .is_err()
    {
        pending.lock().unwrap().remove(&id);
        return respond(
            s,
            "503 Service Unavailable",
            "text/plain",
            "editor window not ready",
            "",
        );
    }
    match rx.recv_timeout(Duration::from_secs(300)) {
        Ok(Some(reply)) => respond(s, "200 OK", "application/json", &reply, ""),
        // A notification has no reply: 202 Accepted, per the transport spec.
        Ok(None) => respond(s, "202 Accepted", "text/plain", "", ""),
        Err(_) => {
            pending.lock().unwrap().remove(&id);
            respond(
                s,
                "504 Gateway Timeout",
                "text/plain",
                "the editor did not answer",
                "",
            )
        }
    }
}

/// Turn the server on or off; returns how clients connect when on.
#[tauri::command]
pub fn mcp_enable(
    app: AppHandle,
    state: State<'_, Mcp>,
    on: bool,
) -> Result<Option<McpInfo>, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    if !on {
        state.running.store(false, Ordering::SeqCst);
        // Wake the accept loop so it sees the flag.
        let _ = TcpStream::connect(("127.0.0.1", PORT));
        return Ok(None);
    }
    let token = token(&dir)?;
    let exe = std::env::current_exe()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    let info = McpInfo {
        url: format!("http://127.0.0.1:{PORT}/mcp"),
        token: token.clone(),
        stdio: format!("\"{exe}\" --mcp-stdio"),
        exe,
    };
    if state.running.swap(true, Ordering::SeqCst) {
        return Ok(Some(info));
    }
    let listener = TcpListener::bind(("127.0.0.1", PORT)).map_err(|e| {
        state.running.store(false, Ordering::SeqCst);
        format!("port {PORT} is in use ({e}); is another copy of the app serving agents?")
    })?;
    let running = state.running.clone();
    let pending = state.pending.clone();
    let next = state.next.clone();
    std::thread::spawn(move || {
        for conn in listener.incoming() {
            if !running.load(Ordering::SeqCst) {
                break;
            }
            let Ok(s) = conn else { continue };
            let (app, token, pending, next) =
                (app.clone(), token.clone(), pending.clone(), next.clone());
            std::thread::spawn(move || handle(&app, s, &token, &pending, &next));
        }
    });
    Ok(Some(info))
}

/// The webview's answer to an mcp-request event.
#[tauri::command]
pub fn mcp_reply(state: State<'_, Mcp>, id: u64, response: Option<String>) {
    if let Some(tx) = state.pending.lock().unwrap().remove(&id) {
        let _ = tx.send(response);
    }
}

// ---- stdio bridge ------------------------------------------------------------

/// The app's config dir without a running Tauri app: the same place
/// `app_config_dir()` resolves to for this identifier.
fn config_dir_for_bridge() -> Option<PathBuf> {
    // The identifier outlived the rename to OpenFrame: it names the folder
    // every user's projects live in (docs/Renaming.md section 1).
    let id = "com.alex.video-editor";
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(target_os = "macos")]
    let base =
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"));
    #[cfg(all(unix, not(target_os = "macos")))]
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")));
    base.map(|b| b.join(id))
}

fn post(token: &str, body: &str) -> Result<(u16, String), String> {
    let mut s = TcpStream::connect(("127.0.0.1", PORT)).map_err(|_| "not running".to_string())?;
    let req = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nContent-Type: application/json\r\nAccept: application/json\r\nAuthorization: Bearer {token}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    s.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let mut raw = String::new();
    s.read_to_string(&mut raw).map_err(|e| e.to_string())?;
    let status = raw
        .split_whitespace()
        .nth(1)
        .and_then(|c| c.parse().ok())
        .unwrap_or(0);
    let body = raw
        .split_once("\r\n\r\n")
        .map(|(_, b)| b.to_string())
        .unwrap_or_default();
    Ok((status, body))
}

/// Where an answer names the tool set it came from (src/lib/mcp.ts TOOLS_META).
const TOOLS_META: &str = "openframe/tools";

/// What a client is told when the tool set changed.
const LIST_CHANGED: &str = r#"{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}"#;

/// Whether this answer comes from another tool set than the last answer
/// that named one; remembers this one. The first answer only sets it.
pub fn tools_changed(last: &mut Option<String>, reply: &str) -> bool {
    let mark = serde_json::from_str::<serde_json::Value>(reply)
        .ok()
        .and_then(|v| {
            v.get("result")?
                .get("_meta")?
                .get(TOOLS_META)?
                .as_str()
                .map(str::to_string)
        });
    let Some(mark) = mark else { return false };
    let changed = last.as_ref().is_some_and(|l| *l != mark);
    *last = Some(mark);
    changed
}

/// `openframe --mcp-stdio`: one JSON-RPC message per line in, one out.
pub fn run_stdio_bridge() {
    let token = config_dir_for_bridge()
        .and_then(|d| std::fs::read_to_string(token_path(&d)).ok())
        .unwrap_or_default();
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    let mut tools: Option<String> = None;
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let id = serde_json::from_str::<serde_json::Value>(&line)
            .ok()
            .and_then(|v| v.get("id").cloned());
        let reply = match post(token.trim(), &line) {
            Ok((200, body)) => Some(body),
            Ok((202, _)) => None,
            Ok((code, body)) => id.clone().map(|id| error(id, &format!("the editor refused the request ({code}): {}", body.trim()))),
            Err(_) => id.clone().map(|id| {
                error(id, "OpenFrame is not running, or 'Allow AI agents' is off. Open the app and turn it on in the AI assistant panel.")
            }),
        };
        if let Some(r) = reply {
            let _ = writeln!(out, "{}", r.trim());
            if tools_changed(&mut tools, &r) {
                let _ = writeln!(out, "{LIST_CHANGED}");
            }
            let _ = out.flush();
        }
    }
}

fn error(id: serde_json::Value, message: &str) -> String {
    serde_json::json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32000, "message": message } }).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_post_with_body() {
        let raw = b"POST /mcp HTTP/1.1\r\nHost: x\r\nContent-Length: 7\r\nAuthorization: Bearer abc\r\n\r\n{\"a\":1}";
        let p = read_request(&raw[..]).unwrap();
        assert_eq!(p.method, "POST");
        assert_eq!(p.path, "/mcp");
        assert_eq!(p.headers.get("authorization").unwrap(), "Bearer abc");
        assert_eq!(p.body, b"{\"a\":1}");
    }

    #[test]
    fn refuses_foreign_origins() {
        assert!(origin_allowed(None));
        assert!(origin_allowed(Some(&"http://localhost:1420".to_string())));
        assert!(origin_allowed(Some(&"http://127.0.0.1".to_string())));
        assert!(!origin_allowed(Some(&"https://evil.example".to_string())));
        assert!(!origin_allowed(Some(
            &"http://localhost.evil.example".to_string()
        )));
    }

    #[test]
    fn says_when_the_tool_set_changes() {
        let answer = |mark: &str| {
            format!(
                r#"{{"jsonrpc":"2.0","id":1,"result":{{"content":[],"_meta":{{"openframe/tools":"{mark}"}}}}}}"#
            )
        };
        let mut last = None;
        // The first answer only sets it; the same set again is no change.
        assert!(!tools_changed(&mut last, &answer("aa-1")));
        assert!(!tools_changed(&mut last, &answer("aa-1")));
        // An answer without a mark (an error, a refusal) changes nothing.
        assert!(!tools_changed(
            &mut last,
            r#"{"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"x"}}"#
        ));
        assert!(tools_changed(&mut last, &answer("bb-2")));
        assert!(!tools_changed(&mut last, &answer("bb-2")));
        let note: serde_json::Value = serde_json::from_str(LIST_CHANGED).unwrap();
        assert_eq!(note["method"], "notifications/tools/list_changed");
        assert!(note.get("id").is_none());
    }

    #[test]
    fn tokens_are_long_and_differ() {
        let (a, b) = (random_token(), random_token());
        assert_eq!(a.len(), 32);
        assert_ne!(a, b);
    }
}
