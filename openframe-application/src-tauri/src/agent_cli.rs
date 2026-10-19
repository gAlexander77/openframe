//! "Add to Codex" and "Add to Claude Code" (ADR-065): run that CLI's own
//! `mcp add` for the stdio bridge, so each agent's config is written by its
//! owner, in its own format, and never by us. Only when the CLI is on PATH;
//! never over an existing entry: Codex's `mcp add` replaces one silently, so
//! `codex mcp get` asks first, and Claude Code's refuses a duplicate itself.
//! The command line is built here from this exe's own path, so the webview
//! can only ask for "codex" or "claude", never name a command to register.

use std::ffi::OsStr;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

/// The server's name in each agent's config (src/lib/agentSetup.ts).
pub const SERVER: &str = "openframe";
const LIMIT: Duration = Duration::from_secs(60);

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Cli {
    Codex,
    Claude,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Outcome {
    /// "added", "exists", "missing" or "failed".
    pub status: &'static str,
    /// The CLI's own words, trimmed.
    pub detail: String,
}

fn outcome(status: &'static str, detail: &str) -> Outcome {
    // The last lines say what happened; a stack trace above them does not.
    let detail = detail.trim();
    let start = detail
        .char_indices()
        .rev()
        .nth(399)
        .map(|(i, _)| i)
        .unwrap_or(0);
    Outcome {
        status,
        detail: detail[start..].to_string(),
    }
}

impl Cli {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "codex" => Ok(Cli::Codex),
            "claude" => Ok(Cli::Claude),
            _ => Err(format!("unknown agent CLI: {s}")),
        }
    }

    fn program(self) -> &'static str {
        match self {
            Cli::Codex => "codex",
            Cli::Claude => "claude",
        }
    }

    pub fn install_page(self) -> &'static str {
        match self {
            Cli::Codex => "https://developers.openai.com/codex/cli",
            Cli::Claude => "https://code.claude.com/docs/en/setup",
        }
    }

    /// `codex mcp add openframe -- <exe> --mcp-stdio`, or Claude Code's
    /// same with `--scope user`: the editor is not one project's tool.
    pub fn add_args(self, exe: &str) -> Vec<String> {
        let head: &[&str] = match self {
            Cli::Codex => &["mcp", "add", SERVER],
            Cli::Claude => &[
                "mcp",
                "add",
                "--scope",
                "user",
                "--transport",
                "stdio",
                SERVER,
            ],
        };
        head.iter()
            .copied()
            .chain(["--", exe, "--mcp-stdio"])
            .map(String::from)
            .collect()
    }
}

/// The first `name` on `path`. On Windows the npm installs are `.cmd`
/// shims and the native ones `.exe`; a bare `codex` there is a shell script
/// Windows cannot start, so only these extensions count.
// ponytail: a macOS app opened from Finder gets launchd's short PATH, not
// the login shell's, so a Homebrew or npm CLI can read as missing there;
// the copy rows still work.
pub fn find_on_path(name: &str, path: &OsStr) -> Option<PathBuf> {
    let exts: &[&str] = if cfg!(windows) {
        &[".exe", ".cmd", ".bat"]
    } else {
        &[""]
    };
    std::env::split_paths(path)
        .flat_map(|dir| exts.iter().map(move |e| dir.join(format!("{name}{e}"))))
        .find(|p| runnable(p))
}

fn runnable(p: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        p.metadata()
            .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    p.is_file()
}

/// Run a CLI to the end (or `LIMIT`) with no window and no input; returns
/// whether it succeeded and what it printed. Rust quotes each argument for
/// a `.cmd` shim's cmd.exe and refuses one it cannot pass safely.
fn run(program: &Path, args: &[String]) -> Result<(bool, String), String> {
    let mut c = Command::new(program);
    c.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = c
        .spawn()
        .map_err(|e| format!("{}: {e}", program.display()))?;
    fn drain(r: Option<impl Read + Send + 'static>) -> std::thread::JoinHandle<String> {
        std::thread::spawn(move || {
            let mut s = String::new();
            if let Some(mut r) = r {
                let _ = r.read_to_string(&mut s);
            }
            s
        })
    }
    let (out, err) = (drain(child.stdout.take()), drain(child.stderr.take()));
    let start = Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
            break s;
        }
        if start.elapsed() > LIMIT {
            // ponytail: a .cmd shim's node child outlives killing cmd.exe.
            let _ = child.kill();
            return Err(format!(
                "{} did not finish within {} s",
                program.display(),
                LIMIT.as_secs()
            ));
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let text = format!(
        "{}\n{}",
        out.join().unwrap_or_default(),
        err.join().unwrap_or_default()
    );
    Ok((status.success(), text.trim().to_string()))
}

/// What `codex mcp get openframe` means: present, absent, or an error to
/// stop on (an older Codex without `get`, a broken config) rather than risk
/// `add` replacing something.
pub fn after_get(ok: bool, text: &str) -> Option<Outcome> {
    if ok {
        Some(outcome("exists", text))
    } else if text.contains("No MCP server named") {
        None
    } else {
        Some(outcome("failed", text))
    }
}

/// What `mcp add` meant.
pub fn after_add(ok: bool, text: &str) -> Outcome {
    if ok {
        outcome("added", text)
    } else if text.contains("already exists") {
        outcome("exists", text)
    } else {
        outcome("failed", text)
    }
}

pub fn add(cli: Cli, exe: &str, path: &OsStr) -> Outcome {
    let Some(program) = find_on_path(cli.program(), path) else {
        return outcome("missing", "");
    };
    if cli == Cli::Codex {
        let get = ["mcp", "get", SERVER].map(String::from);
        match run(&program, &get) {
            Ok((ok, text)) => {
                if let Some(stop) = after_get(ok, &text) {
                    return stop;
                }
            }
            Err(e) => return outcome("failed", &e),
        }
    }
    match run(&program, &cli.add_args(exe)) {
        Ok((ok, text)) => after_add(ok, &text),
        Err(e) => outcome("failed", &e),
    }
}

/// Add this app's stdio bridge to Codex or Claude Code.
#[tauri::command]
pub async fn agent_cli_add(cli: String) -> Result<Outcome, String> {
    let cli = Cli::parse(&cli)?;
    let exe = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .display()
        .to_string();
    let path = std::env::var_os("PATH").unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || add(cli, &exe, &path))
        .await
        .map_err(|e| e.to_string())
}

/// Open the CLI's install guide in the default browser. Only these two
/// fixed pages: the webview names a CLI, not a URL.
#[tauri::command]
pub fn agent_cli_install_page(cli: String) -> Result<(), String> {
    open_url(Cli::parse(&cli)?.install_page()).map_err(|e| e.to_string())
}

/// Open a fixed address in the default browser (Help > About's links too).
pub(crate) fn open_url(url: &str) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        // ShellExecute's "open", what the shell does for a clicked link:
        // the default browser, no console.
        use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
        let wide = |s: &str| s.encode_utf16().chain([0]).collect::<Vec<u16>>();
        let (verb, file) = (wide("open"), wide(url));
        let r = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                verb.as_ptr(),
                file.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            )
        };
        // Values above 32 mean success.
        if r as isize <= 32 {
            return Err(std::io::Error::other(format!(
                "could not open {url} ({})",
                r as isize
            )));
        }
    }
    #[cfg(target_os = "macos")]
    Command::new("open").arg(url).spawn()?;
    #[cfg(all(unix, not(target_os = "macos")))]
    Command::new("xdg-open").arg(url).spawn()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_each_clis_own_add_line() {
        let exe = r"C:\Program Files\OpenFrame\openframe.exe";
        assert_eq!(
            Cli::Codex.add_args(exe),
            ["mcp", "add", "openframe", "--", exe, "--mcp-stdio"]
        );
        assert_eq!(
            Cli::Claude.add_args(exe),
            [
                "mcp",
                "add",
                "--scope",
                "user",
                "--transport",
                "stdio",
                "openframe",
                "--",
                exe,
                "--mcp-stdio"
            ]
        );
        assert!(Cli::parse("bash").is_err());
    }

    #[test]
    fn never_adds_over_an_existing_entry() {
        assert_eq!(
            after_get(true, "openframe\n  enabled: true")
                .unwrap()
                .status,
            "exists"
        );
        assert!(after_get(false, "Error: No MCP server named 'openframe' found.").is_none());
        // An older Codex without `get`: stop, do not risk `add` replacing.
        assert_eq!(
            after_get(false, "error: unrecognized subcommand 'get'")
                .unwrap()
                .status,
            "failed"
        );
        assert_eq!(
            after_add(true, "Added global MCP server 'openframe'.").status,
            "added"
        );
        assert_eq!(
            after_add(false, "MCP server openframe already exists in user config").status,
            "exists"
        );
        assert_eq!(after_add(false, "boom").status, "failed");
    }

    #[test]
    fn keeps_the_end_of_long_output() {
        let long = format!("{}tail", "x".repeat(1000));
        let o = outcome("failed", &long);
        assert_eq!(o.detail.chars().count(), 400);
        assert!(o.detail.ends_with("tail"));
        assert_eq!(outcome("added", "  ok \n").detail, "ok");
    }

    #[test]
    fn finds_a_cli_on_path_and_reports_a_missing_one() {
        let dir = std::env::temp_dir().join(format!("openframe-agent-cli-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let name = if cfg!(windows) { "codex.cmd" } else { "codex" };
        let file = dir.join(name);
        std::fs::write(&file, "").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let path = std::env::join_paths([dir.join("nowhere"), dir.clone()]).unwrap();
        assert_eq!(find_on_path("codex", &path), Some(file));
        assert_eq!(find_on_path("claude", &path), None);
        // Missing before anything runs.
        assert_eq!(add(Cli::Claude, "x", &path).status, "missing");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// The real CLIs, each with every config location moved into the
    /// worktree's scratch/, so the user's own agent configs are never read
    /// or written: added the first time, "exists" the second, the entry
    /// written by the CLI itself. Needs codex and claude on PATH:
    /// `cargo test real_clis -- --ignored`.
    #[test]
    #[ignore]
    fn real_clis_add_once_then_report_exists() {
        let home = Path::new(env!("CARGO_MANIFEST_DIR")).join("../scratch/agent-cli-home");
        let _ = std::fs::remove_dir_all(&home);
        for d in ["codex", "claude", "AppData/Roaming", "AppData/Local"] {
            std::fs::create_dir_all(home.join(d)).unwrap();
        }
        // Children inherit these; this test runs alone (--ignored).
        std::env::set_var("CODEX_HOME", home.join("codex"));
        std::env::set_var("CLAUDE_CONFIG_DIR", home.join("claude"));
        for k in ["USERPROFILE", "HOME"] {
            std::env::set_var(k, &home);
        }
        std::env::set_var("APPDATA", home.join("AppData/Roaming"));
        std::env::set_var("LOCALAPPDATA", home.join("AppData/Local"));
        let path = std::env::var_os("PATH").unwrap();
        let exe = r"C:\Program Files\OpenFrame\openframe.exe";
        for cli in [Cli::Codex, Cli::Claude] {
            let first = add(cli, exe, &path);
            assert_eq!(first.status, "added", "{cli:?}: {}", first.detail);
            let again = add(cli, exe, &path);
            assert_eq!(again.status, "exists", "{cli:?}: {}", again.detail);
        }
        let toml = std::fs::read_to_string(home.join("codex/config.toml")).unwrap();
        assert!(toml.contains("[mcp_servers.openframe]"), "{toml}");
        assert!(toml.contains("--mcp-stdio"), "{toml}");
        let claude = std::fs::read_to_string(home.join("claude/.claude.json")).unwrap();
        assert!(claude.contains("\"openframe\""), "{claude}");
        eprintln!("codex wrote:\n{toml}");
    }
}
