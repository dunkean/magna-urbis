use std::process::{Command, Stdio};

#[tauri::command]
pub fn desktop_release_info(app: tauri::AppHandle) -> serde_json::Value {
    serde_json::json!({
        "version": app.package_info().version.to_string(),
        "platform": format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
    })
}

fn valid_download(url: &str) -> bool {
    url.starts_with("https://github.com/dunkean/magna-urbis/releases/download/desktop-v")
        && !url.chars().any(|c| c.is_control() || matches!(c, '"' | '\'' | '\\' | ' '))
        && [".exe", ".deb", ".AppImage"].iter().any(|extension| url.ends_with(extension))
}

/// Open only our release installers in the system browser, without a shell.
#[tauri::command]
pub fn desktop_open_download(url: String) -> Result<(), String> {
    if !valid_download(&url) { return Err("Invalid desktop download URL".into()); }
    #[cfg(windows)]
    let mut command = {
        let mut command = Command::new("explorer.exe");
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = Command::new("xdg-open");
    command.arg(url).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
        .spawn().map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::valid_download;

    #[test]
    fn only_release_installers_can_be_opened() {
        let base = "https://github.com/dunkean/magna-urbis/releases/download/desktop-v0.3.0/";
        for name in ["Magna%20Urbis%20V2_0.3.0_x64-setup.exe", "magna-urbis_0.3.0_amd64.deb", "magna-urbis_0.3.0_amd64.AppImage"] {
            assert!(valid_download(&format!("{base}{name}")));
        }
        for url in ["file:///tmp/setup.exe", "https://example.com/setup.exe", "https://github.com.evil.test/setup.exe",
            "https://github.com/dunkean/other/releases/download/desktop-v1/setup.exe"] {
            assert!(!valid_download(url));
        }
        for name in ["portable.zip", "setup.exe?x=1", "setup\".exe", "setup\n.exe"] {
            assert!(!valid_download(&format!("{base}{name}")));
        }
    }
}
