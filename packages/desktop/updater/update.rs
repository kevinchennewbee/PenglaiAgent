//! Tauri updater commands for the Penglai 0.4 desktop.
//!
//! This module is included into `src-tauri/src/lib.rs` via
//! `#[path = "../../updater/update.rs"] mod update;` so the updater logic lives
//! next to its manifest generator (`generate-latest-json.mjs`) and template
//! (`latest.json.template`) in `packages/desktop/updater/`.
//!
//! `tauri-plugin-updater` performs the real cryptographic verification of the
//! downloaded bundle against the minisign `signature` in `latest.json` (signed
//! at build time with `TAURI_SIGNING_PRIVATE_KEY`). `check_app_update` reports
//! availability; `install_app_update` downloads, verifies, installs, and
//! restarts. Release-time signature/key validation belongs in CI; the desktop
//! does not expose a shape-only signature diagnostic that could be mistaken
//! for cryptographic verification.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

#[derive(serde::Deserialize, serde::Serialize)]
pub struct UpdateInfo {
    pub has_update: bool,
    pub version: String,
    pub body: String,
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateJournal {
    schema_version: u32,
    state: String,
    current_version: String,
    target_version: String,
    backup_path: Option<String>,
    error: Option<String>,
    updated_at_unix_ms: u128,
}

fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn atomic_json(path: &Path, value: &impl serde::Serialize) -> Result<(), String> {
    let temporary = path.with_extension("tmp");
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("serialize update journal: {}", error))?;
    let mut file = fs::File::create(&temporary)
        .map_err(|error| format!("create {}: {}", temporary.display(), error))?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("write {}: {}", temporary.display(), error))?;
    if let Err(first_error) = fs::rename(&temporary, path) {
        if !path.exists() {
            return Err(format!("commit {}: {}", path.display(), first_error));
        }
        fs::remove_file(path).map_err(|error| format!("replace {}: {}", path.display(), error))?;
        fs::rename(&temporary, path)
            .map_err(|error| format!("commit {}: {}", path.display(), error))?;
    }
    Ok(())
}

fn write_journal(
    data_dir: &Path,
    state: &str,
    current_version: &str,
    target_version: &str,
    backup_path: Option<&Path>,
    error: Option<String>,
) -> Result<(), String> {
    fs::create_dir_all(data_dir)
        .map_err(|cause| format!("create data directory {}: {}", data_dir.display(), cause))?;
    atomic_json(
        &data_dir.join("update-journal.json"),
        &UpdateJournal {
            schema_version: 1,
            state: state.to_string(),
            current_version: current_version.to_string(),
            target_version: target_version.to_string(),
            backup_path: backup_path.map(|path| path.to_string_lossy().into_owned()),
            error,
            updated_at_unix_ms: unix_millis(),
        },
    )
}

fn backup_product_database(
    data_dir: &Path,
    current_version: &str,
    target_version: &str,
) -> Result<PathBuf, String> {
    let backup_dir = data_dir.join("update-backups").join(format!(
        "{}-to-{}-{}",
        current_version,
        target_version,
        unix_millis()
    ));
    fs::create_dir_all(&backup_dir)
        .map_err(|error| format!("create backup {}: {}", backup_dir.display(), error))?;

    for filename in ["product.db", "product.db-wal", "product.db-shm"] {
        let source = data_dir.join(filename);
        if source.exists() {
            fs::copy(&source, backup_dir.join(filename))
                .map_err(|error| format!("back up {}: {}", source.display(), error))?;
        }
    }
    let copied_files = ["product.db", "product.db-wal", "product.db-shm"]
        .into_iter()
        .filter(|filename| backup_dir.join(filename).exists())
        .collect::<Vec<_>>();
    atomic_json(
        &backup_dir.join("backup.json"),
        &serde_json::json!({
            "schemaVersion": 1,
            "currentVersion": current_version,
            "targetVersion": target_version,
            "createdAtUnixMs": unix_millis(),
            "files": copied_files,
        }),
    )?;
    Ok(backup_dir)
}

fn recover_old_host(app: &AppHandle, message: String) -> String {
    match crate::restart_packaged_host(app) {
        Ok(()) => message,
        Err(restart_error) => format!("{}; old Host restart failed: {}", message, restart_error),
    }
}

/// Reconcile an interrupted update after the new/old application completes its
/// Host compatibility handshake. Backups are retained until a later explicit
/// cleanup policy removes them.
pub fn reconcile_update_journal(app: &AppHandle, host_compatible: bool) {
    if !host_compatible {
        return;
    }
    let Ok(data_dir) = crate::host_data_dir(app) else {
        return;
    };
    let journal_path = data_dir.join("update-journal.json");
    let Ok(bytes) = fs::read(&journal_path) else {
        return;
    };
    let Ok(journal) = serde_json::from_slice::<UpdateJournal>(&bytes) else {
        eprintln!(
            "[penglai-updater] invalid update journal: {}",
            journal_path.display()
        );
        return;
    };
    let running_version = app.package_info().version.to_string();
    let backup_path = journal.backup_path.as_deref().map(Path::new);
    let next_state = if running_version == journal.target_version {
        Some(("committed", None))
    } else if running_version == journal.current_version
        && matches!(
            journal.state.as_str(),
            "prepared" | "install_failed" | "installed_restart_pending"
        )
    {
        Some((
            "previous_version_active",
            Some("new application did not become active; previous version is running".to_string()),
        ))
    } else {
        None
    };
    if let Some((state, error)) = next_state {
        if let Err(cause) = write_journal(
            &data_dir,
            state,
            &journal.current_version,
            &journal.target_version,
            backup_path,
            error,
        ) {
            eprintln!("[penglai-updater] reconcile journal failed: {}", cause);
        }
    }
}

/// Check the configured updater endpoints for a newer desktop bundle.
///
/// Returns `{ has_update, version, body }`. When `has_update` is false the
/// other fields are empty strings.
#[tauri::command]
pub async fn check_app_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let updater = app
        .updater()
        .map_err(|e| format!("updater init failed: {}", e))?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("update check failed: {}", e))?;
    match update {
        Some(u) => Ok(UpdateInfo {
            has_update: true,
            version: u.version.clone(),
            body: u.body.clone().unwrap_or_default(),
        }),
        None => Ok(UpdateInfo {
            has_update: false,
            version: String::new(),
            body: String::new(),
        }),
    }
}

/// Download and cryptographically verify before touching the running product.
/// Then stop Host, back up the closed SQLite database, journal the transition,
/// install, and restart. Preparation/install failures restart the old Host.
#[tauri::command]
pub async fn install_app_update(app: AppHandle) -> Result<(), String> {
    crate::ensure_owned_host_for_update()?;
    let updater = app
        .updater()
        .map_err(|e| format!("updater init failed: {}", e))?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("update check failed: {}", e))?
        .ok_or_else(|| "no pending update".to_string())?;
    let target_version = update.version.clone();
    let current_version = app.package_info().version.to_string();
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|e| format!("download/signature verification failed: {}", e))?;

    let data_dir = crate::host_data_dir(&app)?;
    if let Err(error) = crate::stop_owned_host_for_update() {
        return Err(recover_old_host(&app, error));
    }
    let backup_dir = match backup_product_database(&data_dir, &current_version, &target_version) {
        Ok(path) => path,
        Err(error) => return Err(recover_old_host(&app, error)),
    };
    if let Err(error) = write_journal(
        &data_dir,
        "prepared",
        &current_version,
        &target_version,
        Some(&backup_dir),
        None,
    ) {
        return Err(recover_old_host(&app, error));
    }

    if let Err(error) = update.install(&bytes) {
        let message = format!("install failed: {}", error);
        let _ = write_journal(
            &data_dir,
            "install_failed",
            &current_version,
            &target_version,
            Some(&backup_dir),
            Some(message.clone()),
        );
        return Err(recover_old_host(&app, message));
    }
    let _ = write_journal(
        &data_dir,
        "installed_restart_pending",
        &current_version,
        &target_version,
        Some(&backup_dir),
        None,
    );
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::{backup_product_database, write_journal};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_directory() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "penglai-updater-test-{}-{}",
            std::process::id(),
            suffix
        ));
        fs::create_dir_all(&directory).unwrap();
        directory
    }

    #[test]
    fn backs_up_sqlite_companions_and_replaces_the_journal() {
        let data_dir = temporary_directory();
        fs::write(data_dir.join("product.db"), b"db").unwrap();
        fs::write(data_dir.join("product.db-wal"), b"wal").unwrap();

        let backup = backup_product_database(&data_dir, "0.4.0", "0.4.1").unwrap();
        assert_eq!(fs::read(backup.join("product.db")).unwrap(), b"db");
        assert_eq!(fs::read(backup.join("product.db-wal")).unwrap(), b"wal");
        assert!(!backup.join("product.db-shm").exists());

        write_journal(&data_dir, "prepared", "0.4.0", "0.4.1", Some(&backup), None).unwrap();
        write_journal(
            &data_dir,
            "install_failed",
            "0.4.0",
            "0.4.1",
            Some(&backup),
            Some("test failure".to_string()),
        )
        .unwrap();
        let journal: serde_json::Value =
            serde_json::from_slice(&fs::read(data_dir.join("update-journal.json")).unwrap())
                .unwrap();
        assert_eq!(journal["state"], "install_failed");
        assert_eq!(journal["error"], "test failure");

        fs::remove_dir_all(data_dir).unwrap();
    }

    #[test]
    fn refuses_update_without_a_desktop_owned_host() {
        let error = crate::ensure_owned_host_for_update().unwrap_err();
        assert!(error.contains("not owned by this Desktop"));
    }
}
