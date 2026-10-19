//! File moves that survive Windows. Shared by project saves, finished
//! exports and finished proxies, which all write a temporary file and move
//! it into place so a crash never leaves a truncated file under the real
//! name.

use std::{io, path::Path, thread, time::Duration};

/// Move `from` over `to`, replacing it. `std::fs::rename` replaces on every
/// OS, but on Windows antivirus scanners, the Search indexer and OneDrive
/// briefly open fresh files, and the move fails with os error 32 (sharing
/// violation) or 5 (access denied) until they let go. Retry for about two
/// seconds before giving up.
pub fn replace(from: &Path, to: &Path) -> io::Result<()> {
    const ATTEMPTS: u32 = 20;
    let mut attempt = 0;
    loop {
        match std::fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) if attempt + 1 < ATTEMPTS && transient(&e) => {
                attempt += 1;
                thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(e),
        }
    }
}

fn transient(e: &io::Error) -> bool {
    cfg!(windows) && matches!(e.raw_os_error(), Some(5 | 32))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_the_target() {
        let dir = std::env::temp_dir().join(format!("ve-files-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (from, to) = (dir.join("new.tmp"), dir.join("real.json"));
        std::fs::write(&to, "old").unwrap();
        std::fs::write(&from, "new").unwrap();
        replace(&from, &to).unwrap();
        assert_eq!(std::fs::read_to_string(&to).unwrap(), "new");
        assert!(!from.exists());
    }

    /// The case the retry exists for: another process holds the target open
    /// without FILE_SHARE_DELETE (what a virus scanner does) for a moment.
    #[cfg(windows)]
    #[test]
    fn waits_out_a_sharing_violation() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = std::env::temp_dir().join(format!("ve-files-lock-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (from, to) = (dir.join("new.tmp"), dir.join("held.json"));
        std::fs::write(&to, "old").unwrap();
        std::fs::write(&from, "new").unwrap();
        const FILE_SHARE_READ: u32 = 1;
        let held = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(&to)
            .unwrap();
        // Measured: a held *target* fails the move with 5 (access denied),
        // a held *source* (a scanner reading our fresh temp file) with 32.
        assert_eq!(
            std::fs::rename(&from, &to).unwrap_err().raw_os_error(),
            Some(5),
            "a held target should block a plain rename"
        );
        let source = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(&from)
            .unwrap();
        assert_eq!(
            std::fs::rename(&from, dir.join("elsewhere"))
                .unwrap_err()
                .raw_os_error(),
            Some(32),
            "a held source should block a plain rename"
        );
        drop(source);
        let release = thread::spawn(move || {
            thread::sleep(Duration::from_millis(300));
            drop(held);
        });
        replace(&from, &to).unwrap();
        release.join().unwrap();
        assert_eq!(std::fs::read_to_string(&to).unwrap(), "new");
    }
}
