//! Requests to the local model servers Copilot uses (Ollama on 11434, LM
//! Studio on 1234). The release webview's origin is http://tauri.localhost,
//! which Ollama's CORS rules refuse, so the page cannot fetch them itself;
//! Rust can. Only those two loopback ports are reachable this way.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

const PORTS: [u16; 2] = [11434, 1234];

/// The port and path of an allowed URL, or why it is refused.
pub fn target(url: &str) -> Result<(u16, String), String> {
    let rest = url
        .strip_prefix("http://127.0.0.1:")
        .or_else(|| url.strip_prefix("http://localhost:"))
        .ok_or("only the local model servers can be reached")?;
    let (port, path) = rest.split_at(rest.find('/').unwrap_or(rest.len()));
    let port: u16 = port.parse().map_err(|_| "bad port")?;
    if !PORTS.contains(&port) {
        return Err(format!("port {port} is not a model server this app uses"));
    }
    Ok((
        port,
        if path.is_empty() {
            "/".into()
        } else {
            path.into()
        },
    ))
}

/// HTTP/1.0, so the server answers with a plain body and closes: no
/// chunked encoding to undo.
fn request(port: u16, method: &str, path: &str, body: &str) -> Result<(u16, String), String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut s =
        TcpStream::connect_timeout(&addr, Duration::from_secs(3)).map_err(|e| e.to_string())?;
    // A local model can think for minutes on a long timeline.
    s.set_read_timeout(Some(Duration::from_secs(600))).ok();
    let req = format!(
        "{method} {path} HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    s.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let mut raw = Vec::new();
    s.read_to_end(&mut raw).map_err(|e| e.to_string())?;
    let raw = String::from_utf8_lossy(&raw);
    let status = raw
        .split_whitespace()
        .nth(1)
        .and_then(|c| c.parse().ok())
        .ok_or("no HTTP status")?;
    let body = raw
        .split_once("\r\n\r\n")
        .map(|(_, b)| b.to_string())
        .unwrap_or_default();
    Ok((status, body))
}

/// `fetch` for the local model servers: returns the status and body text.
#[tauri::command]
pub async fn model_request(
    url: String,
    method: Option<String>,
    body: Option<String>,
) -> Result<(u16, String), String> {
    let (port, path) = target(&url)?;
    let method = method.unwrap_or_else(|| "GET".into());
    tauri::async_runtime::spawn_blocking(move || {
        request(port, &method, &path, body.as_deref().unwrap_or(""))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reaches_only_the_model_ports_on_loopback() {
        assert_eq!(
            target("http://127.0.0.1:11434/api/chat").unwrap(),
            (11434, "/api/chat".into())
        );
        assert_eq!(
            target("http://localhost:1234/v1/models").unwrap(),
            (1234, "/v1/models".into())
        );
        assert!(target("http://127.0.0.1:8080/").is_err());
        assert!(target("http://example.com:11434/api/tags").is_err());
        assert!(target("http://127.0.0.1:11434@evil.example/").is_err());
    }
}
