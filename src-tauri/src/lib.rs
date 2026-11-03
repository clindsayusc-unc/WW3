//! Native shell for World War 3 (D-083). The game itself is the web build in `../dist`; this
//! crate adds what a browser cannot: save files in the app data folder, a fullscreen toggle and
//! an unattended "autoplay" mode used to verify a packaged build (launch, play N turns, report).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow};

/// Save names become file names: keep them short and free of path tricks.
fn sanitize(name: &str) -> Result<String, String> {
    let clean: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '.' | '_' | '-'))
        .take(64)
        .collect();
    let clean = clean.trim().trim_start_matches('.').to_string();
    if clean.is_empty() {
        return Err("Save name must contain letters or digits.".into());
    }
    Ok(clean)
}

fn saves_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No app data folder: {e}"))?
        .join("saves");
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Writes through a temporary file and a rename, so a crash never leaves half a save.
fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
    f.write_all(contents.as_bytes()).map_err(|e| e.to_string())?;
    f.sync_all().map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Stores a save: `data` is the full save JSON, `meta` a small JSON summary for the load list.
#[tauri::command]
fn save_write(app: AppHandle, name: String, data: String, meta: String) -> Result<(), String> {
    let dir = saves_dir(&app)?;
    let name = sanitize(&name)?;
    write_atomic(&dir.join(format!("{name}.save.json")), &data)?;
    write_atomic(&dir.join(format!("{name}.meta.json")), &meta)
}

#[tauri::command]
fn save_read(app: AppHandle, name: String) -> Result<Option<String>, String> {
    let path = saves_dir(&app)?.join(format!("{}.save.json", sanitize(&name)?));
    match fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Every save's summary (the `meta` JSON written with it), unparsed.
#[tauri::command]
fn save_list(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = saves_dir(&app)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        let is_meta = path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.ends_with(".meta.json"));
        if is_meta {
            if let Ok(s) = fs::read_to_string(&path) {
                out.push(s);
            }
        }
    }
    Ok(out)
}

#[tauri::command]
fn save_delete(app: AppHandle, name: String) -> Result<(), String> {
    let dir = saves_dir(&app)?;
    let name = sanitize(&name)?;
    for ext in ["save.json", "meta.json"] {
        let _ = fs::remove_file(dir.join(format!("{name}.{ext}")));
    }
    Ok(())
}

/// The folder saves live in, shown in Settings so players can back them up.
#[tauri::command]
fn saves_path(app: AppHandle) -> Result<String, String> {
    Ok(saves_dir(&app)?.display().to_string())
}

#[tauri::command]
fn toggle_fullscreen(window: WebviewWindow) -> Result<bool, String> {
    let next = !window.is_fullscreen().map_err(|e| e.to_string())?;
    window.set_fullscreen(next).map_err(|e| e.to_string())?;
    Ok(next)
}

#[derive(Serialize)]
struct Autoplay {
    turns: u32,
    nation: String,
}

/// `WW3_AUTOPLAY=<turns>` (and optionally `WW3_AUTOPLAY_NATION`) starts a game and ends that
/// many turns unattended; used by `scripts/native-verify.sh` to check a packaged build.
#[tauri::command]
fn autoplay_config() -> Option<Autoplay> {
    let turns = std::env::var("WW3_AUTOPLAY").ok()?.parse::<u32>().ok()?;
    let nation = std::env::var("WW3_AUTOPLAY_NATION").unwrap_or_else(|_| "USA".into());
    Some(Autoplay { turns, nation })
}

/// Writes the autoplay report to `WW3_AUTOPLAY_REPORT` (or the app data folder) and quits.
#[tauri::command]
fn autoplay_done(app: AppHandle, report: String) -> Result<(), String> {
    let path = match std::env::var("WW3_AUTOPLAY_REPORT") {
        Ok(p) => PathBuf::from(p),
        Err(_) => saves_dir(&app)?.join("autoplay-report.json"),
    };
    write_atomic(&path, &report)?;
    app.exit(0);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            save_write,
            save_read,
            save_list,
            save_delete,
            saves_path,
            toggle_fullscreen,
            autoplay_config,
            autoplay_done
        ])
        .run(tauri::generate_context!())
        .expect("error while running World War 3");
}

#[cfg(test)]
mod tests {
    use super::sanitize;

    #[test]
    fn sanitize_strips_paths_and_dots() {
        assert_eq!(sanitize("../../etc/passwd").unwrap(), "....etcpasswd".trim_start_matches('.'));
        assert_eq!(sanitize("My save 1").unwrap(), "My save 1");
        assert!(sanitize("///").is_err());
        assert!(sanitize("...").is_err());
    }
}
