//! Penglai 0.4 desktop shell (Tauri 2).
//!
//! This is the 0.4 successor to frontends/desktop/src-tauri (the 0.3 Python
//! bridge shell). Instead of spawning `python desktop_bridge.py` on :14168, the
//! 0.4 shell spawns the TypeScript Host:
//!
//!   node packages/host/src/cli.ts serve --port 14169        (dev, via tsx)
//!   node <resource>/host-runtime/src/cli.js serve --port 14169  (packaged)
//!
//! The React workbench remains the only desktop UI and connects to the Host
//! after a versioned compatibility handshake. A system tray provides show/quit
//! and check-update; tauri-plugin-updater drives signed in-app updates.

use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::{Emitter, Manager};

// Updater commands live next to the manifest generator + template in
// packages/desktop/updater/. Included here so the logic is co-located with
// the rest of the auto-update machinery (Task 3).
#[path = "../../updater/update.rs"]
mod update;

const HOST_PORT: u16 = 14169;
const HOST_BASE: &str = "http://127.0.0.1:14169";
// Single source of truth: packages/protocol via scripts/sync-schema-versions.mjs
include!("schema_versions.rs");

/// The spawned TS Host process. Killed on app exit so the loopback server does
/// not outlive the desktop shell.
static HOST_PROCESS: Mutex<Option<Child>> = Mutex::new(None);
static HOST_START_ERROR: Mutex<Option<String>> = Mutex::new(None);

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeManifestFile {
    path: String,
    sha256: String,
    size: u64,
}

#[derive(serde::Deserialize)]
struct RuntimeNode {
    path: String,
    sha256: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeManifest {
    schema_version: u64,
    product_version: String,
    runtime_version: String,
    target: String,
    protocol_schema_version: u64,
    database_schema_version: u64,
    minimum_desktop_version: String,
    entry: String,
    node: RuntimeNode,
    file_count: usize,
    total_size: u64,
    files: Vec<RuntimeManifestFile>,
}

struct RuntimeLaunch {
    root: PathBuf,
    node: PathBuf,
    entry: PathBuf,
    development: bool,
}

pub(crate) fn host_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Unify with CLI/host: default ~/.penglai (or PENGLAI_DATA_DIR).
    // Never use platform app_data_dir as the product root — that split caused
    // desktop vs CLI dual tokens and RuntimeGate/401 failures.
    let _ = app;
    if let Ok(configured) = std::env::var("PENGLAI_DATA_DIR") {
        if !configured.trim().is_empty() {
            return Ok(PathBuf::from(configured));
        }
    }
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|error| format!("resolve home directory: {}", error))?;
    Ok(PathBuf::from(home).join(".penglai"))
}

fn safe_runtime_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(relative);
    if relative.trim().is_empty()
        || relative.contains('\\')
        || candidate.is_absolute()
        || candidate.components().any(|part| {
            matches!(
                part,
                Component::CurDir
                    | Component::ParentDir
                    | Component::RootDir
                    | Component::Prefix(_)
            )
        })
    {
        return Err(format!("unsafe runtime manifest path: {}", relative));
    }
    Ok(root.join(candidate))
}

fn collect_runtime_files(
    root: &Path,
    directory: &Path,
    output: &mut HashSet<String>,
) -> Result<(), String> {
    for entry in std::fs::read_dir(directory)
        .map_err(|error| format!("read runtime directory {}: {}", directory.display(), error))?
    {
        let entry = entry.map_err(|error| format!("read runtime directory entry: {}", error))?;
        let path = entry.path();
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|error| format!("inspect runtime payload {}: {}", path.display(), error))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "runtime payload must not contain symlinks: {}",
                path.display()
            ));
        }
        if metadata.is_dir() {
            collect_runtime_files(root, &path, output)?;
            continue;
        }
        if !metadata.is_file() {
            return Err(format!(
                "runtime payload has unsupported file type: {}",
                path.display()
            ));
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|_| format!("runtime payload escaped root: {}", path.display()))?
            .to_str()
            .ok_or_else(|| format!("runtime payload path is not UTF-8: {}", path.display()))?
            .replace('\\', "/");
        if relative != "manifest.json" && !output.insert(relative.clone()) {
            return Err(format!("duplicate runtime payload path: {}", relative));
        }
    }
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path)
        .map_err(|error| format!("read runtime payload {}: {}", path.display(), error))?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

fn verify_packaged_runtime(root: PathBuf) -> Result<RuntimeLaunch, String> {
    let manifest_path = root.join("manifest.json");
    let root_metadata = std::fs::symlink_metadata(&root)
        .map_err(|error| format!("inspect runtime root {}: {}", root.display(), error))?;
    if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
        return Err("packaged runtime root must be a real directory".to_string());
    }
    let manifest_metadata = std::fs::symlink_metadata(&manifest_path)
        .map_err(|error| format!("inspect {}: {}", manifest_path.display(), error))?;
    if manifest_metadata.file_type().is_symlink() || !manifest_metadata.is_file() {
        return Err("runtime manifest must be a real file".to_string());
    }
    let manifest_text = std::fs::read_to_string(&manifest_path)
        .map_err(|error| format!("read {}: {}", manifest_path.display(), error))?;
    let manifest: RuntimeManifest = serde_json::from_str(&manifest_text)
        .map_err(|error| format!("parse runtime manifest: {}", error))?;
    if manifest.schema_version != 2 {
        return Err(format!(
            "unsupported runtime manifest schema {}",
            manifest.schema_version
        ));
    }
    if manifest.protocol_schema_version != PROTOCOL_SCHEMA_VERSION
        || manifest.database_schema_version != DATABASE_SCHEMA_VERSION
    {
        return Err("packaged runtime protocol/database schema is incompatible".to_string());
    }
    if env!("CARGO_PKG_VERSION") != PRODUCT_VERSION {
        return Err("Desktop Cargo version and protocol product version disagree".to_string());
    }
    if manifest.product_version != PRODUCT_VERSION || manifest.runtime_version != PRODUCT_VERSION {
        return Err(format!(
            "runtime version mismatch: Desktop {}, product {}, Host {}",
            PRODUCT_VERSION, manifest.product_version, manifest.runtime_version
        ));
    }
    if manifest.target != env!("TAURI_ENV_TARGET_TRIPLE") {
        return Err(format!(
            "runtime target mismatch: Desktop {}, runtime {}",
            env!("TAURI_ENV_TARGET_TRIPLE"),
            manifest.target
        ));
    }
    let desktop_version = semver::Version::parse(PRODUCT_VERSION)
        .map_err(|error| format!("invalid Desktop version: {}", error))?;
    let minimum_desktop = semver::Version::parse(&manifest.minimum_desktop_version)
        .map_err(|error| format!("invalid runtime minimum Desktop version: {}", error))?;
    if desktop_version < minimum_desktop {
        return Err(format!(
            "Desktop {} is older than runtime minimum {}",
            desktop_version, minimum_desktop
        ));
    }
    if manifest.files.len() != manifest.file_count {
        return Err("runtime manifest file count is inconsistent".to_string());
    }

    let mut expected_files = HashSet::new();
    let mut total_size = 0_u64;
    for file in &manifest.files {
        if !expected_files.insert(file.path.clone()) {
            return Err(format!("duplicate runtime manifest path: {}", file.path));
        }
        let path = safe_runtime_path(&root, &file.path)?;
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|error| format!("runtime payload missing {}: {}", file.path, error))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "runtime payload must not be a symlink: {}",
                file.path
            ));
        }
        if !metadata.is_file() || metadata.len() != file.size {
            return Err(format!("runtime payload size mismatch: {}", file.path));
        }
        total_size += metadata.len();
        if sha256_file(&path)? != file.sha256 {
            return Err(format!("runtime payload hash mismatch: {}", file.path));
        }
    }
    if total_size != manifest.total_size {
        return Err("runtime manifest total size is inconsistent".to_string());
    }
    let mut actual_files = HashSet::new();
    collect_runtime_files(&root, &root, &mut actual_files)?;
    if actual_files != expected_files {
        let mut unexpected = actual_files
            .difference(&expected_files)
            .cloned()
            .collect::<Vec<_>>();
        let mut missing = expected_files
            .difference(&actual_files)
            .cloned()
            .collect::<Vec<_>>();
        unexpected.sort();
        missing.sort();
        return Err(format!(
            "runtime payload set mismatch (unexpected: {}; missing: {})",
            unexpected
                .into_iter()
                .take(5)
                .collect::<Vec<_>>()
                .join(", "),
            missing.into_iter().take(5).collect::<Vec<_>>().join(", ")
        ));
    }

    let node = safe_runtime_path(&root, &manifest.node.path)?;
    if !expected_files.contains(&manifest.node.path) {
        return Err("bundled Node is not tracked by the runtime manifest".to_string());
    }
    if sha256_file(&node)? != manifest.node.sha256 {
        return Err("bundled Node hash does not match runtime metadata".to_string());
    }
    let entry = safe_runtime_path(&root, &manifest.entry)?;
    if !expected_files.contains(&manifest.entry) || !entry.is_file() {
        return Err("packaged Host entry is missing".to_string());
    }
    Ok(RuntimeLaunch {
        root,
        node,
        entry,
        development: false,
    })
}

fn resolve_runtime(app: &tauri::AppHandle, dev_mode: bool) -> Result<RuntimeLaunch, String> {
    if dev_mode || cfg!(debug_assertions) {
        let entry = std::env::var("PENGLAI_HOST_CLI")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                Path::new(env!("CARGO_MANIFEST_DIR")).join("../../host/src/cli.ts")
            });
        if !entry.is_file() {
            return Err(format!(
                "development Host entry is missing: {}",
                entry.display()
            ));
        }
        let node = std::env::var("PENGLAI_DEV_NODE")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("node"));
        return Ok(RuntimeLaunch {
            root: PathBuf::from(env!("CARGO_MANIFEST_DIR")),
            node,
            entry,
            development: true,
        });
    }

    let resource = match app.path().resource_dir() {
        Ok(resource) => resource,
        Err(primary_error) => {
            // A relocatable macOS bundle can be launched directly from a
            // freshly copied DMG target (including a temporary acceptance
            // directory). In that case tauri::path::resource_dir may report
            // `unknown path` even though current_exe is correctly inside
            // <App>.app/Contents/MacOS. Derive only that canonical bundle
            // layout as a fallback; the runtime manifest and every payload
            // hash are still verified below before anything is executed.
            #[cfg(target_os = "macos")]
            {
                let executable = std::env::current_exe()
                    .map_err(|error| format!("resolve packaged executable: {}", error))?;
                let macos_dir = executable.parent().ok_or_else(|| {
                    format!(
                        "packaged executable has no parent: {}",
                        executable.display()
                    )
                })?;
                let contents_dir = macos_dir.parent().ok_or_else(|| {
                    format!(
                        "packaged executable has no Contents parent: {}",
                        executable.display()
                    )
                })?;
                if macos_dir.file_name().and_then(|name| name.to_str()) != Some("MacOS")
                    || contents_dir.file_name().and_then(|name| name.to_str()) != Some("Contents")
                {
                    return Err(format!(
                        "resolve application resource directory: {}; executable is outside a macOS app bundle: {}",
                        primary_error,
                        executable.display()
                    ));
                }
                let fallback = contents_dir.join("Resources");
                if !fallback.is_dir() {
                    return Err(format!(
                        "resolve application resource directory: {}; fallback is missing: {}",
                        primary_error,
                        fallback.display()
                    ));
                }
                fallback
            }
            #[cfg(not(target_os = "macos"))]
            {
                return Err(format!(
                    "resolve application resource directory: {}",
                    primary_error
                ));
            }
        }
    };
    let candidates = [
        resource.join("host-runtime"),
        resource.join("resources").join("host-runtime"),
    ];
    for candidate in candidates {
        if candidate.join("manifest.json").is_file() {
            return verify_packaged_runtime(candidate);
        }
    }
    Err("self-contained Host runtime is missing from the application".to_string())
}

/// Spawn the verified Host with the bundled Node executable. System Node is
/// allowed only for an explicit/debug development run.
fn spawn_host(app: &tauri::AppHandle, dev_mode: bool) -> Result<(), String> {
    let launch = resolve_runtime(app, dev_mode)?;
    let data_dir = host_data_dir(app)?;
    let mut cmd = Command::new(&launch.node);
    if launch.development {
        cmd.arg("--import").arg("tsx");
    }
    cmd.current_dir(&launch.root)
        .env("PENGLAI_DATA_DIR", &data_dir)
        .arg(&launch.entry)
        .arg("serve")
        .arg("--port")
        .arg(HOST_PORT.to_string());

    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: do not flash a console for the spawned node process.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd.spawn().map_err(|error| {
        format!(
            "start Host with runtime {}: {}",
            launch.node.display(),
            error
        )
    })?;
    eprintln!(
        "[penglai-desktop-0.4] spawned verified Host runtime pid={}",
        child.id()
    );
    *HOST_PROCESS.lock().unwrap() = Some(child);
    Ok(())
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HostHandshake {
    ok: bool,
    product: String,
    product_version: String,
    runtime: String,
    runtime_version: String,
    protocol_schema_version: u64,
    database_schema_version: u64,
    minimum_desktop_version: String,
    instance_id: String,
}

#[derive(Clone)]
struct HostProbe {
    compatible: bool,
    error: Option<String>,
    handshake: Option<HostHandshake>,
}

fn incompatible(error: impl Into<String>) -> HostProbe {
    HostProbe {
        compatible: false,
        error: Some(error.into()),
        handshake: None,
    }
}

/// Perform the real Desktop/Host compatibility handshake.
///
/// An open TCP port is not readiness: another process, an old Host, or a Host
/// with an incompatible database/protocol must fail closed.
fn probe_host() -> HostProbe {
    let mut stream = match TcpStream::connect(("127.0.0.1", HOST_PORT)) {
        Ok(stream) => stream,
        Err(error) => return incompatible(format!("host unavailable: {}", error)),
    };
    let timeout = Some(Duration::from_secs(2));
    if let Err(error) = stream.set_read_timeout(timeout) {
        return incompatible(format!("set host read timeout failed: {}", error));
    }
    if let Err(error) = stream.set_write_timeout(timeout) {
        return incompatible(format!("set host write timeout failed: {}", error));
    }
    let request = format!(
        "GET /health HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        HOST_PORT
    );
    if let Err(error) = stream.write_all(request.as_bytes()) {
        return incompatible(format!("host handshake write failed: {}", error));
    }
    let mut response = String::new();
    if let Err(error) = stream.take(64 * 1024).read_to_string(&mut response) {
        return incompatible(format!("host handshake read failed: {}", error));
    }
    let (headers, body) = match response.split_once("\r\n\r\n") {
        Some(parts) => parts,
        None => return incompatible("host handshake returned malformed HTTP"),
    };
    if !headers.lines().next().unwrap_or_default().contains(" 200 ") {
        return incompatible("host handshake returned non-200 response");
    }
    let handshake: HostHandshake = match serde_json::from_str(body) {
        Ok(handshake) => handshake,
        Err(error) => return incompatible(format!("invalid host handshake JSON: {}", error)),
    };
    if !handshake.ok || handshake.product != "Penglai" || handshake.runtime != "host" {
        return incompatible("the service on the Penglai port is not a Penglai Host");
    }
    if handshake.protocol_schema_version != PROTOCOL_SCHEMA_VERSION {
        return incompatible(format!(
            "protocol schema mismatch: desktop {}, host {}",
            PROTOCOL_SCHEMA_VERSION, handshake.protocol_schema_version
        ));
    }
    if handshake.database_schema_version != DATABASE_SCHEMA_VERSION {
        return incompatible(format!(
            "database schema mismatch: desktop {}, host {}",
            DATABASE_SCHEMA_VERSION, handshake.database_schema_version
        ));
    }
    let desktop_version = match semver::Version::parse(env!("CARGO_PKG_VERSION")) {
        Ok(version) => version,
        Err(error) => return incompatible(format!("invalid desktop version: {}", error)),
    };
    let minimum_desktop = match semver::Version::parse(&handshake.minimum_desktop_version) {
        Ok(version) => version,
        Err(error) => {
            return incompatible(format!(
                "invalid minimum Desktop version from Host: {}",
                error
            ))
        }
    };
    if desktop_version < minimum_desktop {
        return incompatible(format!(
            "Desktop {} is older than Host minimum {}",
            desktop_version, minimum_desktop
        ));
    }
    HostProbe {
        compatible: true,
        error: None,
        handshake: Some(handshake),
    }
}

fn host_ready() -> bool {
    probe_host().compatible
}

/// Poll the Host port until it answers or the timeout elapses.
fn wait_for_host(timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if host_ready() {
            return true;
        }
        thread::sleep(Duration::from_millis(150));
    }
    false
}

/// Stop the spawned TS Host backend. `pub` so the updater module
/// (packages/desktop/updater/update.rs) can shut the Host down before
/// installing a desktop bundle update and restarting.
pub fn stop_host() {
    if let Ok(mut guard) = HOST_PROCESS.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Refuse an in-app update unless this Desktop process owns the Host it is
/// about to stop. A compatible external `penglai serve` may be reused for
/// normal UI work, but copying its live SQLite files would produce an
/// inconsistent backup and a false update journal.
pub(crate) fn ensure_owned_host_for_update() -> Result<(), String> {
    let mut guard = HOST_PROCESS
        .lock()
        .map_err(|_| "Host process ownership lock is poisoned".to_string())?;
    let Some(child) = guard.as_mut() else {
        return Err(
            "update refused: the active Host is not owned by this Desktop; stop the external penglai serve process and restart Desktop before updating"
                .to_string(),
        );
    };
    if child
        .try_wait()
        .map_err(|error| format!("inspect owned Host process: {}", error))?
        .is_some()
    {
        *guard = None;
        return Err("update refused: the Desktop-owned Host has already exited".to_string());
    }
    Ok(())
}

/// Stop and reap the exact child owned by this Desktop, then prove the Host
/// port is closed before any database backup begins.
pub(crate) fn stop_owned_host_for_update() -> Result<(), String> {
    let mut child = {
        let mut guard = HOST_PROCESS
            .lock()
            .map_err(|_| "Host process ownership lock is poisoned".to_string())?;
        guard.take().ok_or_else(|| {
            "update refused: the active Host is not owned by this Desktop".to_string()
        })?
    };
    child
        .kill()
        .map_err(|error| format!("stop Desktop-owned Host: {}", error))?;
    child
        .wait()
        .map_err(|error| format!("wait for Desktop-owned Host: {}", error))?;

    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if TcpStream::connect(("127.0.0.1", HOST_PORT)).is_err() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(50));
    }
    Err(format!(
        "update refused: Host port {} is still active after the Desktop-owned process exited",
        HOST_PORT
    ))
}

/// Restart the packaged Host after a prepared update fails. Successful updates
/// restart the whole application instead.
pub(crate) fn restart_packaged_host(app: &tauri::AppHandle) -> Result<(), String> {
    spawn_host(app, false)
}

// ── Tauri commands ──────────────────────────────────────────────

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HostStatus {
    ok: bool,
    port: u16,
    url: String,
    error: Option<String>,
    handshake: Option<HostHandshake>,
}

/// Probe the Host liveness from the renderer (e.g. to flip the loading screen
/// to the embedded UI once the backend is up).
#[tauri::command]
fn host_status() -> HostStatus {
    let mut probe = probe_host();
    if !probe.compatible {
        if let Ok(error) = HOST_START_ERROR.lock() {
            if let Some(error) = error.as_ref() {
                probe.error = Some(error.clone());
            }
        }
    }
    HostStatus {
        ok: probe.compatible,
        port: HOST_PORT,
        url: HOST_BASE.to_string(),
        error: probe.error,
        handshake: probe.handshake,
    }
}

/// The Penglai data directory (workspace anchor for the desktop's global
/// chat conversation — the assistant's own ground, same as the feishu one).
#[tauri::command]
fn penglai_home(app: tauri::AppHandle) -> Result<String, String> {
    let dir = host_data_dir(&app)?;
    Ok(dir.to_string_lossy().to_string())
}

/// Read the loopback credential from the data dir (shared by the RPC proxy
/// and the WS event bridge). The token never leaves the native shell.
fn read_host_token(data_dir: &Path) -> Result<String, String> {
    let token_path = data_dir.join("host.token");
    let metadata = std::fs::symlink_metadata(&token_path).map_err(|error| {
        format!(
            "inspect Host credential {}: {}",
            token_path.display(),
            error
        )
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!(
            "Host credential must be a regular file: {}",
            token_path.display()
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err(format!(
                "Host credential permissions must be 0600: {}",
                token_path.display()
            ));
        }
    }
    let token = std::fs::read_to_string(&token_path)
        .map_err(|error| format!("read Host credential {}: {}", token_path.display(), error))?;
    let token = token.trim().to_string();
    if token.len() < 32 {
        return Err("Host credential is empty or too short".to_string());
    }
    Ok(token)
}

/// Structured RPC failure so the renderer keeps the protocol error code
/// (budget_exceeded / needs_work_mode / conversation_busy …) for UI logic.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HostRpcError {
    message: String,
    code: Option<String>,
}

impl HostRpcError {
    fn transport(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            code: None,
        }
    }
    fn remote(message: impl Into<String>, code: Option<String>) -> Self {
        Self {
            message: message.into(),
            code,
        }
    }
}

impl From<HostRpcError> for String {
    fn from(error: HostRpcError) -> Self {
        error.message
    }
}

fn host_rpc_blocking(
    data_dir: PathBuf,
    method: String,
    params: serde_json::Value,
) -> Result<serde_json::Value, HostRpcError> {
    if method.trim().is_empty() {
        return Err(HostRpcError::transport("RPC method is required"));
    }
    if !params.is_object() {
        return Err(HostRpcError::transport("RPC params must be an object"));
    }
    // Renderer allowlist (defense-in-depth): the webview is a thin client, so
    // it only needs the surface below. An XSS in the renderer must never reach
    // the full product database — only methods this list names are forwarded
    // (config.createProfile / channel.setup / approval.approve ARE allowed
    // because the setup wizard / channel UI / approval cards genuinely need
    // them; anything else — distill internals, memory writes, migration,
    // scheduler mutation — stays blocked). Keep this list in sync with the
    // renderer via scripts/check-desktop-allowlist.mjs (CI-enforced).
    const ALLOWED_HOST_METHODS: &[&str] = &[
        "project.list",
        "project.create",
        "project.trust",
        "project.untrust",
        "task.list",
        "task.get",
        "task.start",
        "task.cancel",
        "task.pause",
        "task.steer",
        "artifact.resolve",
        "artifact.preview",
        "conversation.list",
        "conversation.get",
        "conversation.attachment.import",
        "conversation.create",
        "conversation.update",
        "conversation.compact",
        "conversation.prompt",
        "conversation.abort",
        "conversation.pin.add",
        "conversation.pin.remove",
        "conversation.todo.upsert",
        "conversation.todo.remove",
        "conversation.goal.set",
        "conversation.goal.clear",
        "conversation.workbench.get",
        "conversation.approval.list",
        "conversation.approval.approve",
        "conversation.approval.reject",
        "approval.list",
        "approval.approve",
        "approval.reject",
        "mode.proposeWork",
        "mode.confirmWork",
        "mode.exitWork",
        "workspace.open",
        "memory.sopList",
        "memory.sopShow",
        "skill.list",
        "skill.inspect",
        "skill.install",
        "skill.enable",
        "skill.remove",
        "usage.stats",
        "usage.get",
        "budget.set",
        "budget.status",
        "budget.lift",
        "config.listProfiles",
        "config.createProfile",
        "config.updateProfile",
        "config.listModels",
        "config.resolveProfile",
        "config.smokeTest",
        "channel.setup",
        "channel.allow",
        "channel.disable",
        "channel.list",
        "channel.feishu.qrStart",
        "channel.feishu.qrPoll",
        "channel.wechat.qrStart",
        "channel.wechat.qrPoll",
        "channel.wechat.clear",
        "mcp.list",
        "mcp.upsert",
        "mcp.remove",
        "mcp.connect",
        "mcp.disconnect",
        "catalog.status",
        "onboarding.status",
        "onboarding.birthIdentity",
        "doctor.run",
        "doctor.export",
        "voice.status",
        "voice.install",
        "voice.transcribe",
        "voice.synthesize",
        "companion.status",
        "companion.enable",
        "companion.disable",
        "companion.mode",
        "companion.trigger",
        "files.complete",
    ];
    if !ALLOWED_HOST_METHODS.contains(&method.as_str()) {
        return Err(HostRpcError::transport(
            "RPC method is not in the desktop renderer allowlist",
        ));
    }
    let token = read_host_token(&data_dir).map_err(HostRpcError::transport)?;
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    })
    .to_string();
    let request = format!(
        "POST /api HTTP/1.1\r\n\
         Host: 127.0.0.1:{HOST_PORT}\r\n\
         Content-Type: application/json\r\n\
         X-Penglai-Token: {token}\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\r\n{}",
        body.len(),
        body,
    );
    let mut stream = TcpStream::connect(("127.0.0.1", HOST_PORT))
        .map_err(|error| HostRpcError::transport(format!("connect to Host: {}", error)))?;
    // Chat episodes are bounded to 5 minutes host-side (POLICY_PROFILES.chat);
    // the RPC answering conversation.prompt must outlive one full episode.
    let timeout = Some(Duration::from_secs(10 * 60));
    stream
        .set_read_timeout(timeout)
        .map_err(|error| HostRpcError::transport(format!("set Host read timeout: {}", error)))?;
    stream
        .set_write_timeout(timeout)
        .map_err(|error| HostRpcError::transport(format!("set Host write timeout: {}", error)))?;
    stream
        .write_all(request.as_bytes())
        .map_err(|error| HostRpcError::transport(format!("write Host RPC: {}", error)))?;
    let mut response = String::new();
    stream
        .take(16 * 1024 * 1024)
        .read_to_string(&mut response)
        .map_err(|error| HostRpcError::transport(format!("read Host RPC: {}", error)))?;
    let (headers, payload) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| HostRpcError::transport("Host returned malformed HTTP"))?;
    if !headers.lines().next().unwrap_or_default().contains(" 200 ") {
        return Err(HostRpcError::transport(
            "Host returned a non-200 response".to_string(),
        ));
    }
    let envelope: serde_json::Value = serde_json::from_str(payload)
        .map_err(|error| HostRpcError::transport(format!("parse Host RPC: {}", error)))?;
    if let Some(error) = envelope.get("error") {
        let message = error
            .get("message")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("Host RPC failed");
        let code = error
            .get("data")
            .and_then(|data| data.get("code"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_string);
        return Err(HostRpcError::remote(message.to_string(), code));
    }
    envelope
        .get("result")
        .cloned()
        .ok_or_else(|| HostRpcError::transport("Host RPC response has no result"))
}

/// Keep the loopback credential inside the native shell. The React workbench
/// can call typed Host methods without ever receiving or persisting the token.
#[tauri::command]
async fn host_rpc(
    app: tauri::AppHandle,
    method: String,
    params: serde_json::Value,
) -> Result<serde_json::Value, HostRpcError> {
    let data_dir = host_data_dir(&app).map_err(HostRpcError::transport)?;
    tauri::async_runtime::spawn_blocking(move || host_rpc_blocking(data_dir, method, params))
        .await
        .map_err(|error| HostRpcError::transport(format!("Host RPC task failed: {}", error)))?
}

// ── Host event bridge (native WS → Tauri events) ────────────────
//
// The Host streams realtime events (conversation deltas, run state changes,
// approvals, budget warnings) over a token-gated WebSocket. Browsers cannot
// set headers on WS upgrades and the credential stays out of the renderer,
// so the native shell owns the socket: one forwarder thread per channel,
// each frame re-emitted as the `host-event` Tauri event.

/// Active forwarder cancel flags, keyed by channel id.
static WS_SUBSCRIPTIONS: Mutex<Option<HashMap<String, Arc<AtomicBool>>>> = Mutex::new(None);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HostEventFrame {
    channel_id: String,
    /// One JSON text frame from the Host; null on stream close.
    data: Option<String>,
    closed: bool,
    error: Option<String>,
}

enum WsFrame {
    Text(Vec<u8>),
    Ping(Vec<u8>),
    Pong,
    Close,
}

/// Minimal base64 (RFC 4648) for the Sec-WebSocket-Key nonce. The key is a
/// handshake nonce — not a credential — so a tiny local encoder suffices.
fn base64_encode(data: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[(n >> 18) as usize & 0x3f] as char);
        out.push(ALPHABET[(n >> 12) as usize & 0x3f] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(n >> 6) as usize & 0x3f] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[n as usize & 0x3f] as char
        } else {
            '='
        });
    }
    out
}

/// Percent-encode a query value (channel ids are normally alphanumeric with
/// underscores; this is belt-and-braces for anything else).
fn url_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{:02X}", byte)),
        }
    }
    out
}

/// Handshake a WS upgrade against the Host and return the connected stream.
fn ws_connect(token: &str, channel_id: &str) -> Result<TcpStream, String> {
    let mut stream = TcpStream::connect(("127.0.0.1", HOST_PORT))
        .map_err(|error| format!("connect to Host event channel: {}", error))?;
    // A 16-byte nonce from time/counter/pid — a handshake nonce, not a secret.
    static NONCE_COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let mut nonce = [0u8; 16];
    nonce[..8]
        .copy_from_slice(&(nanos ^ NONCE_COUNTER.fetch_add(1, Ordering::Relaxed)).to_be_bytes());
    nonce[8..].copy_from_slice(&(std::process::id() as u64 ^ nanos.rotate_left(32)).to_be_bytes());
    let key = base64_encode(&nonce);
    let request = format!(
        "GET /ws?channel={} HTTP/1.1\r\n\
         Host: 127.0.0.1:{HOST_PORT}\r\n\
         X-Penglai-Token: {token}\r\n\
         Upgrade: websocket\r\n\
         Connection: Upgrade\r\n\
         Sec-WebSocket-Key: {key}\r\n\
         Sec-WebSocket-Version: 13\r\n\r\n",
        url_encode(channel_id),
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("write Host event handshake: {}", error))?;
    // Read the upgrade response headers (bounded).
    let mut head = Vec::with_capacity(1024);
    let mut byte = [0u8; 1];
    while head.len() < 16 * 1024 {
        match stream.read(&mut byte) {
            Ok(0) => return Err("Host event handshake closed early".to_string()),
            Ok(_) => {
                head.push(byte[0]);
                if head.ends_with(b"\r\n\r\n") {
                    break;
                }
            }
            Err(error) => return Err(format!("read Host event handshake: {}", error)),
        }
    }
    let head_text = String::from_utf8_lossy(&head);
    let status_line = head_text.lines().next().unwrap_or_default();
    if !status_line.contains(" 101") {
        return Err(format!("Host event upgrade refused: {}", status_line));
    }
    Ok(stream)
}

/// Read one WS frame. Server frames are unmasked; continuation frames are
/// accumulated into the returned payload.
fn ws_read_frame(stream: &mut TcpStream) -> std::io::Result<WsFrame> {
    let mut payload: Vec<u8> = Vec::new();
    let mut message_opcode: Option<u8> = None;
    loop {
        let mut header = [0u8; 2];
        stream.read_exact(&mut header)?;
        let fin = header[0] & 0x80 != 0;
        let opcode = header[0] & 0x0f;
        let masked = header[1] & 0x80 != 0;
        let mut len = (header[1] & 0x7f) as u64;
        if len == 126 {
            let mut ext = [0u8; 2];
            stream.read_exact(&mut ext)?;
            len = u16::from_be_bytes(ext) as u64;
        } else if len == 127 {
            let mut ext = [0u8; 8];
            stream.read_exact(&mut ext)?;
            len = u64::from_be_bytes(ext);
        }
        if len > 16 * 1024 * 1024 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Host event frame too large",
            ));
        }
        let mask = if masked {
            let mut key = [0u8; 4];
            stream.read_exact(&mut key)?;
            Some(key)
        } else {
            None
        };
        let mut chunk = vec![0u8; len as usize];
        stream.read_exact(&mut chunk)?;
        if let Some(key) = mask {
            for (index, byte) in chunk.iter_mut().enumerate() {
                *byte ^= key[index % 4];
            }
        }
        match opcode {
            0x0 | 0x1 | 0x2 => {
                if opcode != 0x0 {
                    message_opcode = Some(opcode);
                }
                payload.extend_from_slice(&chunk);
                if fin {
                    return Ok(if message_opcode == Some(0x1) {
                        WsFrame::Text(payload)
                    } else {
                        // Binary frames are not used by the Host; skip them.
                        WsFrame::Pong
                    });
                }
            }
            0x8 => return Ok(WsFrame::Close),
            0x9 => return Ok(WsFrame::Ping(chunk)),
            0xA => return Ok(WsFrame::Pong),
            _ => {}
        }
    }
}

/// Send a masked client control frame (pong/close). RFC 6455 requires client
/// frames to be masked; the mask value itself carries no secrecy.
fn ws_send_control(stream: &mut TcpStream, opcode: u8, payload: &[u8]) -> std::io::Result<()> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u32)
        .unwrap_or(0);
    let mask = (nanos ^ std::process::id()).to_be_bytes();
    let mut frame = Vec::with_capacity(payload.len() + 8);
    frame.push(0x80 | opcode);
    // Control frames are at most 125 bytes by spec.
    frame.push(0x80 | (payload.len() as u8));
    frame.extend_from_slice(&mask);
    for (index, byte) in payload.iter().enumerate() {
        frame.push(byte ^ mask[index % 4]);
    }
    stream.write_all(&frame)
}

fn ws_forward_loop(
    app: &tauri::AppHandle,
    channel_id: &str,
    token: &str,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let mut stream = ws_connect(token, channel_id)?;
    stream
        .set_read_timeout(Some(Duration::from_millis(1000)))
        .map_err(|error| format!("set Host event read timeout: {}", error))?;
    loop {
        if cancel.load(Ordering::Relaxed) {
            let _ = ws_send_control(&mut stream, 0x8, &[]);
            return Ok(());
        }
        match ws_read_frame(&mut stream) {
            Ok(WsFrame::Text(bytes)) => {
                if let Ok(text) = String::from_utf8(bytes) {
                    let _ = app.emit(
                        "host-event",
                        HostEventFrame {
                            channel_id: channel_id.to_string(),
                            data: Some(text),
                            closed: false,
                            error: None,
                        },
                    );
                }
            }
            Ok(WsFrame::Ping(bytes)) => {
                ws_send_control(&mut stream, 0xA, &bytes)
                    .map_err(|error| format!("pong to Host event channel: {}", error))?;
            }
            Ok(WsFrame::Pong) => {}
            Ok(WsFrame::Close) => return Ok(()),
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.kind() == std::io::ErrorKind::TimedOut =>
            {
                // Idle poll tick: re-check the cancel flag once a second.
            }
            Err(error) => return Err(format!("Host event stream failed: {}", error)),
        }
    }
}

/// Subscribe the renderer to a Host event channel (conversation id, task id,
/// "budget", "voice"). Idempotent per channel; frames arrive as `host-event`.
#[tauri::command]
fn host_subscribe(app: tauri::AppHandle, channel_id: String) -> Result<(), String> {
    if channel_id.trim().is_empty() {
        return Err("channelId is required".to_string());
    }
    let data_dir = host_data_dir(&app)?;
    let token = read_host_token(&data_dir)?;
    {
        let mut guard = WS_SUBSCRIPTIONS.lock().unwrap();
        let subscriptions = guard.get_or_insert_with(HashMap::new);
        if subscriptions.contains_key(&channel_id) {
            return Ok(()); // already forwarding this channel
        }
        subscriptions.insert(channel_id.clone(), Arc::new(AtomicBool::new(false)));
    }
    let cancel = WS_SUBSCRIPTIONS
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|subscriptions| subscriptions.get(&channel_id).cloned())
        .ok_or_else(|| "event subscription registry lost".to_string())?;
    let app_handle = app.clone();
    let thread_channel = channel_id.clone();
    thread::spawn(move || {
        let outcome = ws_forward_loop(&app_handle, &thread_channel, &token, &cancel);
        let _ = app_handle.emit(
            "host-event",
            HostEventFrame {
                channel_id: thread_channel.clone(),
                data: None,
                closed: true,
                error: outcome.err(),
            },
        );
        if let Ok(mut guard) = WS_SUBSCRIPTIONS.lock() {
            if let Some(subscriptions) = guard.as_mut() {
                subscriptions.remove(&thread_channel);
            }
        }
    });
    Ok(())
}

/// Stop forwarding one Host event channel (the thread exits within ~1s).
#[tauri::command]
fn host_unsubscribe(channel_id: String) -> Result<(), String> {
    if let Ok(mut guard) = WS_SUBSCRIPTIONS.lock() {
        if let Some(subscriptions) = guard.as_mut() {
            if let Some(cancel) = subscriptions.remove(&channel_id) {
                cancel.store(true, Ordering::Relaxed);
            }
        }
    }
    Ok(())
}

// The updater commands (check_app_update / install_app_update)
// live in the `update` module (packages/desktop/updater/update.rs), registered
// below via update::*. They replace the inline stubs that used to live here.

// ── App entry point ─────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let no_autostart = std::env::args().any(|a| a == "--no-autostart");
    let dev_mode = std::env::args().any(|a| a == "--dev");

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            host_status,
            host_rpc,
            host_subscribe,
            host_unsubscribe,
            penglai_home,
            update::check_app_update,
            update::install_app_update,
        ])
        .setup(move |app| {
            // ---- Spawn the TS Host backend ----
            let mut spawned = false;
            if !no_autostart && !host_ready() {
                // If something already answers on 14169 but fails the handshake
                // (old Host / wrong schema / foreign process), do NOT silently
                // attempt spawn into EADDRINUSE — surface a clear recovery path.
                let occupied = TcpStream::connect(("127.0.0.1", HOST_PORT)).is_ok();
                if occupied {
                    let probe = probe_host();
                    let detail = probe
                        .error
                        .unwrap_or_else(|| "incompatible or non-Penglai service".into());
                    let message = format!(
                        "端口 {} 已被占用且握手失败（{}）。请先停止旧的 penglai serve / 其它占用进程后重开桌面：lsof -nP -iTCP:{} -sTCP:LISTEN",
                        HOST_PORT, detail, HOST_PORT
                    );
                    eprintln!("[penglai-desktop-0.4] {}", message);
                    if let Ok(mut error) = HOST_START_ERROR.lock() {
                        *error = Some(message);
                    }
                } else {
                    match spawn_host(app.handle(), dev_mode) {
                        Ok(()) => {
                            spawned = true;
                            if let Ok(mut error) = HOST_START_ERROR.lock() {
                                *error = None;
                            }
                        }
                        Err(message) => {
                            eprintln!("[penglai-desktop-0.4] {}", message);
                            if let Ok(mut error) = HOST_START_ERROR.lock() {
                                *error = Some(message);
                            }
                        }
                    }
                }
            }

            // ---- System tray ----
            let show_hide = tauri::menu::MenuItemBuilder::with_id("show_hide", "显示主窗口 / Show")
                .build(app)?;
            let check_update =
                tauri::menu::MenuItemBuilder::with_id("check_update", "检查更新 / Check for updates")
                    .build(app)?;
            let quit = tauri::menu::MenuItemBuilder::with_id("quit", "退出蓬莱 / Quit").build(app)?;
            let tray_menu = tauri::menu::MenuBuilder::new(app)
                .item(&show_hide)
                .item(&check_update)
                .separator()
                .item(&quit)
                .build()?;
            let _tray = tauri::tray::TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&tray_menu)
                .tooltip("蓬莱 · Penglai 0.4")
                .on_menu_event(move |app_handle, event| match event.id().as_ref() {
                    "show_hide" => {
                        if let Some(w) = app_handle.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                    "check_update" => {
                        if let Some(w) = app_handle.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                        let _ = app_handle.emit("menu-check-update", ());
                    }
                    "quit" => {
                        stop_host();
                        app_handle.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray_icon, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray_icon.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // ---- Wait for the Host while keeping React as the only UI owner ----
            let wait = if spawned { Duration::from_secs(20) } else { Duration::from_secs(2) };
            let ready = host_ready() || wait_for_host(wait);
            update::reconcile_update_journal(app.handle(), ready);
            if let Some(w) = app.get_webview_window("main") {
                if ready {
                    let _ = app.emit("host-ready", host_status());
                }
                if dev_mode {
                    w.open_devtools();
                }
                let _ = w.show();
                let _ = w.set_focus();
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    // Hide to tray instead of quitting (CI sets PENGLAI_NO_TRAY
                    // to allow a clean exit).
                    let no_tray = std::env::var("PENGLAI_NO_TRAY").is_ok();
                    if no_tray {
                        stop_host();
                        window.app_handle().exit(0);
                    } else {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) {
            // Covers Cmd+Q, OS shutdown, updater restart, tray Quit, and test
            // exits. stop_host is idempotent, so overlapping exit paths are
            // safe and the loopback Host can never be orphaned.
            stop_host();
        }
    });
}
