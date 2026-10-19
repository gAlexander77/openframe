//! Help > About's links (src/lib/about.ts). The webview names a page and
//! this opens that page's fixed address in the default browser, as
//! `agent_cli_install_page` does: it never hands the shell a URL of its own.

const REPOSITORY: &str = "https://github.com/gAlexander77/openframe";

/// The address of an About page by name.
pub fn url(page: &str) -> Option<String> {
    Some(match page {
        "repository" => REPOSITORY.to_string(),
        "guide" => format!("{REPOSITORY}/blob/main/docs/User%20guide.md"),
        "license" => "https://www.gnu.org/licenses/gpl-3.0.html".to_string(),
        "credits" => format!("{REPOSITORY}/blob/main/docs/Third-party%20licenses.md"),
        "lame" => "https://lame.sourceforge.io/".to_string(),
        _ => return None,
    })
}

/// Open an About page (repository, guide, license, credits, lame).
#[tauri::command]
pub fn about_open(page: String) -> Result<(), String> {
    let url = url(&page).ok_or_else(|| format!("no About page named {page:?}"))?;
    crate::agent_cli::open_url(&url).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_only_its_own_pages() {
        assert_eq!(url("repository").as_deref(), Some(REPOSITORY));
        assert!(url("license").unwrap().starts_with("https://www.gnu.org/"));
        assert!(url("guide").unwrap().ends_with("User%20guide.md"));
        assert_eq!(url("https://example.com"), None);
        assert_eq!(url(""), None);
    }
}
