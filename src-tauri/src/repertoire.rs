use std::{fs, io::Write, path::Path, sync::Mutex};

static MERGE_LOCK: Mutex<()> = Mutex::new(());

/// Compare before replacing, keep a backup, and atomically publish the new PGN.
#[tauri::command]
#[specta::specta]
pub fn save_repertoire_merge(
    file_path: String,
    expected: String,
    updated: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<String, String> {
    let _guard = MERGE_LOCK.lock().map_err(|e| e.to_string())?;
    let backup =
        save_merge(Path::new(&file_path), &expected, &updated).map_err(|e| e.to_string())?;
    state.pgn_offsets.remove(&file_path);
    Ok(backup)
}

fn save_merge(
    path: &Path,
    expected: &str,
    updated: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    if path.extension().and_then(|s| s.to_str()) != Some("pgn") {
        return Err("Choose a PGN repertoire.".into());
    }
    let metadata: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(path.with_extension("info"))?)?;
    if metadata["type"] != "repertoire" {
        return Err("This file is no longer a repertoire.".into());
    }
    if fs::read_to_string(path)? != expected {
        return Err(
            "The repertoire changed while this window was open. Close this window and try again."
                .into(),
        );
    }
    if updated.trim().is_empty() {
        return Err("Cannot save an empty repertoire.".into());
    }
    let directory = path.parent().ok_or("Missing repertoire directory")?;
    let mut replacement = tempfile::NamedTempFile::new_in(directory)?;
    replacement.write_all(updated.as_bytes())?;
    replacement
        .as_file()
        .set_permissions(fs::metadata(path)?.permissions())?;
    replacement.as_file().sync_all()?;
    let prefix = format!(
        ".{}.before-add-",
        path.file_name()
            .ok_or("Missing filename")?
            .to_string_lossy()
    );
    let mut backup = tempfile::Builder::new()
        .prefix(&prefix)
        .suffix(".bak")
        .tempfile_in(directory)?;
    backup.write_all(expected.as_bytes())?;
    backup
        .as_file()
        .set_permissions(fs::metadata(path)?.permissions())?;
    backup.as_file().sync_all()?;
    // Recheck after preparing files, before the atomic replacement.
    if fs::read_to_string(path)? != expected {
        return Err("The repertoire changed while saving. Close this window and try again.".into());
    }
    let (_, backup_path) = backup.keep()?;
    replacement.persist(path)?;
    Ok(backup_path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saves_with_exact_backup_and_preserves_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Scotch.pgn");
        let before = "1. e4 *";
        fs::write(&path, before).unwrap();
        fs::write(
            path.with_extension("info"),
            r#"{"type":"repertoire","tags":["keep"]}"#,
        )
        .unwrap();
        let backup = save_merge(&path, before, "1. e4 e5 *").unwrap();
        assert_eq!(fs::read_to_string(backup).unwrap(), before);
        assert_eq!(fs::read_to_string(&path).unwrap(), "1. e4 e5 *");
        assert_eq!(
            fs::read_to_string(path.with_extension("info")).unwrap(),
            r#"{"type":"repertoire","tags":["keep"]}"#
        );
    }
    #[test]
    fn refuses_stale_or_non_repertoire_writes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Scotch.pgn");
        fs::write(&path, "1. d4 *").unwrap();
        fs::write(path.with_extension("info"), r#"{"type":"repertoire"}"#).unwrap();
        assert!(save_merge(&path, "1. e4 *", "1. e4 e5 *").is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "1. d4 *");
        fs::write(path.with_extension("info"), r#"{"type":"game"}"#).unwrap();
        assert!(save_merge(&path, "1. d4 *", "1. d4 d5 *").is_err());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
    }
}
