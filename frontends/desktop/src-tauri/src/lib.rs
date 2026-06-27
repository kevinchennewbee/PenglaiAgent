use std::process::{Command, Child, Stdio};
use std::sync::Mutex;
use std::collections::HashMap;
use std::net::TcpStream;
use std::io::{Read, Write, BufRead, BufReader};
use std::time::{Duration, Instant};
use std::thread;
use std::path::PathBuf;
use tauri::{Manager, Emitter};
use tauri_plugin_updater::UpdaterExt;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

static BRIDGE_PROCESS: Mutex<Option<Child>> = Mutex::new(None);
const PENGLAI_OWNER_REPO: &str = "kevinchennewbee/PenglaiAgent";
const PENGLAI_RELEASE_BRANCH: &str = "main";

#[derive(serde::Serialize, Clone)]
struct InstallProgress {
    step: String,
    line: String,
    done: bool,
    ok: bool,
}

#[derive(serde::Serialize)]
struct RuntimeInstallResult {
    python_path: String,
    project_dir: String,
    log: String,
}

#[derive(serde::Serialize)]
struct UpdateInfo {
    has_update: bool,
    old_version: String,
    new_version: String,
    detail: String,
}

/// Get project root (parent of frontends/)
fn project_root() -> PathBuf {
    std::env::current_exe()
        .expect("cannot get exe path")
        .parent().expect("cannot get exe dir")   // frontends/
        .parent().expect("cannot get project root") // project root
        .to_path_buf()
}

#[allow(dead_code)]
fn find_bridge_script() -> PathBuf {
    std::env::current_exe()
        .expect("cannot get exe path")
        .parent().expect("cannot get exe dir")
        .join("desktop_bridge.py")
}

#[allow(dead_code)]
fn find_python() -> String {
    let root = project_root();
    if let Some(py) = find_project_python(&root) {
        return py;
    }
    let portable_python_dir = root.join(".portable").join("uv-python");

    if portable_python_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&portable_python_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    #[cfg(windows)]
                    {
                        let py = path.join("python.exe");
                        if py.exists() {
                            return py.to_string_lossy().to_string();
                        }
                    }
                    #[cfg(not(windows))]
                    {
                        let py = path.join("bin").join("python3");
                        if py.exists() {
                            return py.to_string_lossy().to_string();
                        }
                    }
                }
            }
        }
    }

    #[cfg(windows)]
    { "python".to_string() }
    #[cfg(not(windows))]
    { "python3".to_string() }
}

fn find_project_python(root: &PathBuf) -> Option<String> {
    #[cfg(windows)]
    {
        let py = root.join(".venv").join("Scripts").join("python.exe");
        if py.exists() {
            return Some(py.to_string_lossy().to_string());
        }
    }
    #[cfg(not(windows))]
    {
        let py = root.join(".venv").join("bin").join("python");
        if py.exists() {
            return Some(py.to_string_lossy().to_string());
        }
    }
    None
}

/// Desktop runtime installs to ~/PenglaiAgentDesktop to avoid clashing with
/// a developer checkout at ~/PenglaiAgent. Real users never have ~/PenglaiAgent.
fn default_runtime_project_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("PenglaiAgentDesktop")
}

fn raw_github_url(path: &str) -> String {
    format!(
        "https://raw.githubusercontent.com/{}/refs/heads/{}/{}",
        PENGLAI_OWNER_REPO, PENGLAI_RELEASE_BRANCH, path
    )
}

/// Find project directory by searching upward from exe for agentmain.py
fn find_project_dir() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    let mut dir = exe.parent();
    for _ in 0..8 {
        match dir {
            Some(d) => {
                if d.join("agentmain.py").exists() {
                    return Some(d.to_string_lossy().to_string());
                }
                dir = d.parent();
            }
            None => break,
        }
    }
    None
}

fn settings_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".penglai_desktop_settings.json")
}

fn write_desktop_settings(python_path: &str, project_dir: &str) -> Result<(), String> {
    let path = settings_path();
    let obj = serde_json::json!({"python_path": python_path, "project_dir": project_dir});
    std::fs::write(&path, serde_json::to_string_pretty(&obj).unwrap())
        .map_err(|e| format!("Failed to write settings: {}", e))
}

fn legacy_settings_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".ga_desktop_settings.json")
}

pub fn get_or_discover_config() -> (String, String) {
    let path = settings_path();
    let legacy_path = legacy_settings_path();

    for read_path in [&path, &legacy_path] {
        if !read_path.exists() {
            continue;
        }
        if let Ok(content) = std::fs::read_to_string(read_path) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                let python = val.get("python_path")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let project = val.get("project_dir")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if !python.is_empty() && !project.is_empty() {
                    if read_path != &path {
                        let json = serde_json::json!({
                            "python_path": &python,
                            "project_dir": &project
                        });
                        let _ = std::fs::write(&path, serde_json::to_string_pretty(&json).unwrap());
                    }
                    return (python, project);
                }
            }
        }
    }

    let project = find_project_dir().unwrap_or_default();
    let python = if project.is_empty() {
        find_python()
    } else {
        find_project_python(&PathBuf::from(&project)).unwrap_or_else(find_python)
    };

    if !python.is_empty() && !project.is_empty() {
        let json = serde_json::json!({
            "python_path": &python,
            "project_dir": &project
        });
        let _ = std::fs::write(&path, serde_json::to_string_pretty(&json).unwrap());
    }

    (python, project)
}

fn is_bridge_port_open() -> bool {
    TcpStream::connect(("127.0.0.1", 14168)).is_ok()
}

fn is_bridge_running() -> bool {
    let mut stream = match TcpStream::connect(("127.0.0.1", 14168)) {
        Ok(stream) => stream,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(700)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(700)));
    let request = b"GET / HTTP/1.1\r\nHost: 127.0.0.1:14168\r\nConnection: close\r\n\r\n";
    if stream.write_all(request).is_err() {
        return false;
    }
    let mut buf = Vec::new();
    let _ = stream.read_to_end(&mut buf);
    let body = String::from_utf8_lossy(&buf);
    body.contains("window.__PENGLAI_BRIDGE_TOKEN__") && body.contains("penglai-web.js")
}

fn wait_for_bridge_ready(timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if is_bridge_running() {
            return true;
        }
        thread::sleep(Duration::from_millis(100));
    }
    false
}

// ============================================================
// Bridge HTTP helpers — Rust shell calls bridge endpoints instead
// of inlining Python source (Task 7).  All setup ops below go
// through these functions over 127.0.0.1:14168.
// ============================================================

/// Fetch the bridge token from the running bridge's index page HTML.
/// The bridge injects `window.__PENGLAI_BRIDGE_TOKEN__="..."` into /
fn fetch_bridge_token() -> Option<String> {
    let mut stream = TcpStream::connect(("127.0.0.1", 14168)).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(1500)));
    let request = b"GET / HTTP/1.1\r\nHost: 127.0.0.1:14168\r\nConnection: close\r\n\r\n";
    stream.write_all(request).ok()?;
    let mut buf = Vec::new();
    stream.read_to_end(&mut buf).ok()?;
    let body = String::from_utf8_lossy(&buf);
    let marker = "window.__PENGLAI_BRIDGE_TOKEN__=";
    let idx = body.find(marker)?;
    let rest = &body[idx + marker.len()..];
    let trimmed = rest.trim_start();
    if trimmed.starts_with('"') {
        let end = trimmed[1..].find('"')?;
        Some(trimmed[1..=end].to_string())
    } else if trimmed.starts_with('\'') {
        let end = trimmed[1..].find('\'')?;
        Some(trimmed[1..=end].to_string())
    } else {
        let end = trimmed.find(|c: char| c == ';' || c == '\n' || c == '<').unwrap_or(trimmed.len());
        Some(trimmed[..end].trim().to_string())
    }
}

/// Check whether the running bridge is in --bootstrap mode by looking for
/// the `window.__PENGLAI_BOOTSTRAP__=true` marker in the index page.
fn is_bridge_bootstrap() -> bool {
    let mut stream = match TcpStream::connect(("127.0.0.1", 14168)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1000)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(1000)));
    let request = b"GET / HTTP/1.1\r\nHost: 127.0.0.1:14168\r\nConnection: close\r\n\r\n";
    if stream.write_all(request).is_err() {
        return false;
    }
    let mut buf = Vec::new();
    let _ = stream.read_to_end(&mut buf);
    let body = String::from_utf8_lossy(&buf);
    body.contains("window.__PENGLAI_BOOTSTRAP__=true")
}

/// Decode an HTTP response body, handling chunked transfer encoding.
fn decode_http_body(headers: &str, body: &str) -> String {
    if headers.to_lowercase().contains("transfer-encoding: chunked") {
        let mut result = String::new();
        let mut pos = 0;
        while pos < body.len() {
            let nl = match body[pos..].find("\r\n") {
                Some(i) => i,
                None => break,
            };
            let size_str = body[pos..pos + nl].trim();
            let size_str = size_str.split(';').next().unwrap_or("0");
            let size = match usize::from_str_radix(size_str, 16) {
                Ok(s) => s,
                Err(_) => break,
            };
            pos += nl + 2;
            if size == 0 {
                break;
            }
            if pos + size <= body.len() {
                result.push_str(&body[pos..pos + size]);
            }
            pos += size + 2;
        }
        result
    } else {
        body.to_string()
    }
}

/// Make a synchronous HTTP request to the local bridge (127.0.0.1:14168).
/// `body` is None for GET, Some(json) for POST.
fn bridge_http(method: &str, path: &str, body: Option<&str>) -> Result<String, String> {
    let token = fetch_bridge_token()
        .ok_or_else(|| "bridge token unavailable (bridge not running on 127.0.0.1:14168)".to_string())?;
    let mut stream = TcpStream::connect(("127.0.0.1", 14168))
        .map_err(|e| format!("connect bridge failed: {}", e))?;
    stream.set_read_timeout(Some(Duration::from_secs(300))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(10))).ok();

    let mut request = format!(
        "{} {} HTTP/1.1\r\nHost: 127.0.0.1:14168\r\nConnection: close\r\nX-Penglai-Bridge-Token: {}\r\n",
        method, path, token
    );
    if let Some(b) = body {
        request.push_str(&format!("Content-Type: application/json\r\nContent-Length: {}\r\n", b.len()));
    }
    request.push_str("\r\n");
    if let Some(b) = body {
        request.push_str(b);
    }

    stream.write_all(request.as_bytes()).map_err(|e| format!("write failed: {}", e))?;
    let mut buf = Vec::new();
    stream.read_to_end(&mut buf).map_err(|e| format!("read failed: {}", e))?;
    let response = String::from_utf8_lossy(&buf).to_string();

    let sep = response.find("\r\n\r\n").ok_or("invalid HTTP response")?;
    let headers = &response[..sep];
    let raw_body = &response[sep + 4..];
    let status_line = headers.lines().next().unwrap_or("");
    if !status_line.contains(" 200 ") && !status_line.contains(" 201 ") {
        return Err(format!("bridge {} {}: {}", method, path, status_line));
    }
    Ok(decode_http_body(headers, raw_body))
}

fn bridge_get(path: &str) -> Result<String, String> {
    bridge_http("GET", path, None)
}

fn bridge_post(path: &str, body: &str) -> Result<String, String> {
    bridge_http("POST", path, Some(body))
}

#[allow(dead_code)]
fn start_bridge() {
    let script = find_bridge_script();
    if !script.exists() {
        eprintln!("[penglai-desktop] bridge script not found: {:?}", script);
        return;
    }

    let python = find_python();
    eprintln!("[penglai-desktop] using python: {}", python);

    #[cfg(windows)]
    let show_console = std::env::args().any(|a| a == "--console");

    let mut cmd = Command::new(&python);
    cmd.arg(&script)
       .current_dir(script.parent().unwrap());

    #[cfg(windows)]
    if !show_console {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    match cmd.spawn() {
        Ok(child) => {
            eprintln!("[penglai-desktop] started bridge PID={}", child.id());
            *BRIDGE_PROCESS.lock().unwrap() = Some(child);
        }
        Err(e) => {
            eprintln!("[penglai-desktop] failed to start bridge: {} (python={})", e, python);
            return;
        }
    }

    if !wait_for_bridge_ready(Duration::from_secs(15)) {
        eprintln!("[penglai-desktop] WARNING: bridge did not become ready within 15s");
    }
}

fn stop_bridge_process() {
    if let Ok(mut guard) = BRIDGE_PROCESS.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Spawn a command, stream its stdout/stderr line-by-line as install-progress
/// events, and return Ok(log) or Err(log) when it finishes.
fn run_streaming(
    app_handle: &tauri::AppHandle,
    mut command: Command,
    step: &str,
) -> Result<String, String> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let mut child = command.spawn().map_err(|e| {
        let msg = format!("启动失败: {}", e);
        let _ = app_handle.emit("install-progress", InstallProgress {
            step: step.to_string(),
            line: msg.clone(),
            done: true,
            ok: false,
        });
        msg
    })?;

    let stdout = child.stdout.take().expect("stdout pipe");
    let stderr = child.stderr.take().expect("stderr pipe");

    let step_clone = step.to_string();
    let app_clone = app_handle.clone();
    let stdout_thread = thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(text) = line {
                let _ = app_clone.emit("install-progress", InstallProgress {
                    step: step_clone.clone(),
                    line: text,
                    done: false,
                    ok: false,
                });
            }
        }
    });

    let step_clone2 = step.to_string();
    let app_clone2 = app_handle.clone();
    let stderr_thread = thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(text) = line {
                let _ = app_clone2.emit("install-progress", InstallProgress {
                    step: step_clone2.clone(),
                    line: text,
                    done: false,
                    ok: false,
                });
            }
        }
    });

    let status = child.wait().map_err(|e| format!("wait failed: {}", e))?;
    let _ = stdout_thread.join();
    let _ = stderr_thread.join();

    let ok = status.success();
    let _ = app_handle.emit("install-progress", InstallProgress {
        step: step.to_string(),
        line: if ok { "完成".to_string() } else { format!("退出码: {}", status.code().unwrap_or(-1)) },
        done: true,
        ok,
    });

    if ok {
        Ok(String::new())
    } else {
        Err(format!("{} 失败，退出码: {}", step, status.code().unwrap_or(-1)))
    }
}

/// Build the install.sh / install.ps1 command for the desktop runtime dir.
fn build_install_command(project_dir: &PathBuf) -> Command {
    let target = project_dir.to_string_lossy().to_string();

    #[cfg(windows)]
    {
        let script_url = raw_github_url("install.ps1");
        let ps = format!(
            "$ErrorActionPreference='Stop'; \
             $env:PENGLAI_BRANCH={branch}; \
             $env:PENGLAI_SKIP_SETUP='1'; \
             $env:PENGLAI_INSTALL_VERIFY='1'; \
             $env:PENGLAI_INSTALL_DEPS='1'; \
             $env:PENGLAI_DIR={dir}; \
             $env:PYTHONUTF8='1'; \
             $env:PYTHONIOENCODING='utf-8'; \
             Invoke-WebRequest -UseBasicParsing {script_url} | Invoke-Expression",
            branch = ps_single_quote(PENGLAI_RELEASE_BRANCH),
            dir = ps_single_quote(&target),
            script_url = ps_single_quote(&script_url),
        );
        let mut command = Command::new("powershell.exe");
        command.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &ps]);
        command
    }

    #[cfg(not(windows))]
    {
        let tmp_dir = std::env::temp_dir();
        let script_path = tmp_dir.join("penglai-install-desktop.sh");
        let script_path_str = script_path.to_string_lossy().to_string();
        let url = raw_github_url("install.sh");

        let download_ps = format!(
            "curl -fsSL -m 30 -o \"{dest}\" \"{url}\" 2>/dev/null || \
             curl -fsSL -m 30 -o \"{dest}\" \"https://gh-proxy.com/{url}\" 2>/dev/null",
            dest = script_path_str,
            url = url,
        );
        let _ = Command::new("sh").arg("-c").arg(&download_ps).output();

        let mut command = Command::new("sh");
        command.arg(&script_path_str);
        command
            .env("PENGLAI_BRANCH", PENGLAI_RELEASE_BRANCH)
            .env("PENGLAI_DIR", &target)
            .env("PENGLAI_SKIP_SETUP", "1")
            .env("PENGLAI_INSTALL_VERIFY", "1")
            .env("PENGLAI_INSTALL_DEPS", "1");
        command
    }
}

#[cfg(windows)]
fn ps_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

// ============================================================
// Core bridge & install commands.
// ============================================================

#[tauri::command]
fn start_bridge_with_config(app_handle: tauri::AppHandle, python_path: String, project_dir: String) -> Result<(), String> {
    write_desktop_settings(&python_path, &project_dir)?;

    // If a bootstrap-mode bridge is running (setup wizard flow), stop it first
    // so we can spawn a full runtime bridge with the newly written config.
    if is_bridge_running() && is_bridge_bootstrap() {
        stop_bridge_process();
        // Give the OS a moment to release port 14168.
        std::thread::sleep(Duration::from_millis(500));
    }

    if !is_bridge_running() {
        if is_bridge_port_open() {
            return Err("检测到旧版或非蓬莱桌面桥接占用 127.0.0.1:14168；请先关闭旧桥接后重试。".into());
        }
        let py = PathBuf::from(&python_path);
        let dir = PathBuf::from(&project_dir);
        let script = dir.join("frontends").join("desktop_bridge.py");
        if !script.exists() {
            return Err(format!("desktop_bridge.py not found at {:?}", script));
        }

        let mut cmd = Command::new(&py);
        cmd.arg(&script).current_dir(&dir);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        let child = cmd.spawn().map_err(|e| format!("Failed to spawn: {}", e))?;
        *BRIDGE_PROCESS.lock().unwrap() = Some(child);
    }

    if !wait_for_bridge_ready(Duration::from_secs(20)) {
        return Err("Bridge did not become ready within 20s".into());
    }

    if let Some(main_win) = app_handle.get_webview_window("main") {
        let url = tauri::Url::parse("http://127.0.0.1:14168/").unwrap();
        let _ = main_win.navigate(url);
        let _ = main_win.show();
        let _ = main_win.set_focus();
    }
    if let Some(setup_win) = app_handle.get_webview_window("setup") {
        let _ = setup_win.hide();
    }

    Ok(())
}

#[tauri::command]
fn get_config() -> (String, String) {
    get_or_discover_config()
}

#[tauri::command]
fn detect_legacy_penglai() -> Result<Vec<HashMap<String, String>>, String> {
    let home = dirs::home_dir().ok_or("无法获取 home 目录")?;
    let mut results = Vec::new();

    // 检测已知旧版本路径
    let legacy_paths = vec![
        home.join("PenglaiAgent"),
        home.join("PenglaiAgentDesktop"),
        home.join("PenglaiAgentOld"),
    ];

    for path in legacy_paths {
        if path.exists() && path.join("penglai").exists() {
            let mut info = HashMap::new();
            info.insert("path".to_string(), path.display().to_string());
            // 尝试读取版本号
            let version = std::fs::read_to_string(path.join(".penglai-build.json"))
                .ok()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .and_then(|v| v.get("version").and_then(|v| v.as_str()).map(|s| s.to_string()))
                .unwrap_or_else(|| "unknown".to_string());
            info.insert("version".to_string(), version);
            // 检测是否有用户数据
            let has_data = path.join("mykey.py").exists() || path.join("memory").exists();
            info.insert("has_data".to_string(), has_data.to_string());
            results.push(info);
        }
    }

    Ok(results)
}

#[tauri::command]
fn install_runtime(
    app_handle: tauri::AppHandle,
    include_voice: bool,
    include_tts: bool,
) -> Result<RuntimeInstallResult, String> {
    let project = default_runtime_project_dir();
    let project_dir = project.to_string_lossy().to_string();

    let cmd = build_install_command(&project);
    run_streaming(&app_handle, cmd, "bootstrap")?;

    let python_path = find_project_python(&project).unwrap_or_else(find_python);

    if include_voice {
        let mut cmd = Command::new(&python_path);
        cmd.arg("penglai").arg("enable").arg("voice").current_dir(&project);
        let _ = run_streaming(&app_handle, cmd, "voice");
    }

    if include_tts {
        let mut cmd = Command::new(&python_path);
        cmd.arg("penglai").arg("enable").arg("tts").current_dir(&project);
        let _ = run_streaming(&app_handle, cmd, "tts");
    }

    let mut cmd = Command::new(&python_path);
    cmd.arg("penglai").arg("install-check").arg("--json").current_dir(&project);
    let _ = run_streaming(&app_handle, cmd, "diagnostics");

    write_desktop_settings(&python_path, &project_dir)?;

    // CRITICAL: After runtime install completes, the setup wizard (fallback.html)
    // needs to call setup_op → bridge_http → /setup/* endpoints.  If the bridge
    // is not running, every setup_op call fails with "bridge token unavailable"
    // and the user sees "clicking does nothing".  Spawn the bridge in
    // --bootstrap mode now so /setup/* endpoints are available for the wizard.
    if !is_bridge_running() {
        let script = project.join("frontends").join("desktop_bridge.py");
        if !script.exists() {
            return Err(format!("desktop_bridge.py not found at {:?} after install", script));
        }
        let mut cmd = Command::new(&python_path);
        cmd.arg(&script).arg("--bootstrap").current_dir(&project);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        let child = cmd.spawn().map_err(|e| {
            let msg = format!("启动桥接进程失败: {}", e);
            let _ = app_handle.emit("install-progress", InstallProgress {
                step: "bootstrap".to_string(),
                line: msg.clone(),
                done: true,
                ok: false,
            });
            msg
        })?;
        *BRIDGE_PROCESS.lock().unwrap() = Some(child);
        if !wait_for_bridge_ready(Duration::from_secs(20)) {
            // Bridge spawned but did not become ready — likely Python import
            // error (missing aiohttp) or crash on startup.  Surface the error
            // so the user knows the wizard won't work, instead of silently
            // returning Ok and letting them click into a dead UI.
            return Err("运行时已安装，但配置桥接启动失败（20 秒内未就绪）。可能原因：Python 依赖未正确安装。请重新初始化，或点击「手动指定路径」用已有运行时启动。".into());
        }
    }

    Ok(RuntimeInstallResult { python_path, project_dir, log: String::new() })
}

#[tauri::command]
fn install_runtime_step(
    app_handle: tauri::AppHandle,
    step: String,
) -> Result<String, String> {
    let project = default_runtime_project_dir();
    let python_path = find_project_python(&project).unwrap_or_else(find_python);

    match step.as_str() {
        "voice" => {
            let mut cmd = Command::new(&python_path);
            cmd.arg("penglai").arg("enable").arg("voice").current_dir(&project);
            run_streaming(&app_handle, cmd, "voice")
        }
        "tts" => {
            let mut cmd = Command::new(&python_path);
            cmd.arg("penglai").arg("enable").arg("tts").current_dir(&project);
            run_streaming(&app_handle, cmd, "tts")
        }
        "doctor" => {
            let mut cmd = Command::new(&python_path);
            cmd.arg("penglai").arg("doctor").current_dir(&project);
            run_streaming(&app_handle, cmd, "doctor")
        }
        "install-check" => {
            let mut cmd = Command::new(&python_path);
            cmd.arg("penglai").arg("install-check").arg("--json").current_dir(&project);
            run_streaming(&app_handle, cmd, "install-check")
        }
        "update-check" => {
            let mut cmd = Command::new(&python_path);
            cmd.arg("penglai").arg("update").arg("--check").current_dir(&project);
            run_streaming(&app_handle, cmd, "update-check")
        }
        "update-apply" => {
            let mut cmd = Command::new(&python_path);
            cmd.arg("penglai").arg("update").arg("--apply").current_dir(&project);
            run_streaming(&app_handle, cmd, "update-apply")
        }
        _ => Err(format!("未知步骤: {}", step)),
    }
}

#[tauri::command]
fn check_update() -> Result<UpdateInfo, String> {
    let project = default_runtime_project_dir();
    let python_path = find_project_python(&project).unwrap_or_else(find_python);

    let mut cmd = Command::new(&python_path);
    cmd.arg("penglai").arg("update").arg("--check").current_dir(&project);
    let output = cmd.output().map_err(|e| format!("启动失败: {}", e))?;
    let text = String::from_utf8_lossy(&output.stdout).to_string()
        + &String::from_utf8_lossy(&output.stderr);

    let has_update = text.contains("落后") || text.contains("新版本");
    let old_version = extract_field(&text, "当前").or(extract_field(&text, "old")).unwrap_or_default();
    let new_version = extract_field(&text, "最新").or(extract_field(&text, "new")).unwrap_or_default();

    Ok(UpdateInfo {
        has_update,
        old_version,
        new_version,
        detail: text,
    })
}

// ============================================================
// App self-update via tauri-plugin-updater (Task 10)
// These check/install the desktop bundle itself (dmg/nsis), distinct from
// the runtime `check_update` above which is `penglai update --check` (git pull).
// ============================================================

#[tauri::command]
async fn check_app_update(app_handle: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let updater = app_handle.updater()
        .map_err(|e| format!("更新器初始化失败: {}", e))?;
    let update = updater.check().await
        .map_err(|e| format!("检查应用更新失败: {}", e))?;
    match update {
        Some(u) => Ok(serde_json::json!({
            "has_update": true,
            "version": u.version,
            "body": u.body,
        })),
        None => Ok(serde_json::json!({"has_update": false})),
    }
}

#[tauri::command]
async fn install_app_update(app_handle: tauri::AppHandle) -> Result<(), String> {
    let updater = app_handle.updater()
        .map_err(|e| format!("更新器初始化失败: {}", e))?;
    let update = updater.check().await
        .map_err(|e| format!("检查应用更新失败: {}", e))?
        .ok_or_else(|| "没有待安装的更新".to_string())?;
    update.download_and_install(
        |_chunk_length, _content_length| {},
        || {},
    ).await
        .map_err(|e| format!("下载/安装更新失败: {}", e))?;
    app_handle.restart()
}

fn extract_field(text: &str, key: &str) -> Option<String> {
    // 1. Try parsing the whole text as JSON (penglai update --check --json output).
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(text) {
        if let Some(s) = val.get(key).and_then(|v| v.as_str()) {
            return Some(s.to_string());
        }
        // Also try nested "version" sub-keys the CLI may emit.
        if let Some(obj) = val.as_object() {
            for (k, v) in obj {
                if k.contains(key) {
                    if let Some(s) = v.as_str() {
                        return Some(s.to_string());
                    }
                    if let Some(n) = v.as_f64() {
                        return Some(n.to_string());
                    }
                }
            }
        }
    }
    // 2. Fallback: scan text lines for "key[:|：|空格] version" patterns.
    //    Handles "当前版本: 0.3.0", "当前: 0.3.0", "最新 0.3.1", "old: 0.3.0".
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix(key) {
            // Skip optional "版本" suffix, colons (ascii/cjk), spaces.
            let rest = rest.trim_start_matches("版本");
            let rest = rest.trim_start_matches(|c: char| c == ':' || c == '：' || c == ' ');
            // Extract version-like token: digits, dots, hyphens, plus, letters.
            let version: String = rest.chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-' || *c == '+')
                .collect();
            if !version.is_empty() {
                return Some(version);
            }
        }
    }
    None
}

// ============================================================
// Setup wizard command (Task 7: no inline Python; delegates to bridge HTTP)
// ============================================================

/// Unified setup operation dispatcher.  The frontend calls this with an op
/// name and optional JSON params.  All ops are forwarded to the desktop bridge
/// HTTP endpoints (see /setup/* and /channels/* in desktop_bridge.py) so the
/// Rust shell contains zero inline Python configuration logic.
#[tauri::command]
fn setup_op(
    _app_handle: tauri::AppHandle,
    _python_path: String,
    _project_dir: String,
    op: String,
    params: String,
) -> Result<String, String> {
    match op.as_str() {
        "list_providers" => bridge_get("/setup/list_providers"),
        "test_llm" => bridge_post("/setup/test_llm", &params),
        "feishu_qr_init" => bridge_post("/setup/feishu/qr_init", &params),
        "feishu_qr_poll" => bridge_post("/setup/feishu/qr_poll", &params),
        "feishu_verify" => bridge_post("/setup/feishu/verify", &params),
        "write_identity" => bridge_post("/setup/write_identity", &params),
        "write_mykey" => bridge_post("/setup/write_mykey", &params),
        "service_status" => bridge_get("/setup/service_status"),
        "doctor" => bridge_get("/doctor"),
        "enable_channel" => {
            let p: serde_json::Value = serde_json::from_str(&params)
                .map_err(|e| format!("invalid params JSON: {}", e))?;
            let channel = p["channel"].as_str().unwrap_or("");
            if channel.is_empty() {
                return Err("missing 'channel' param".into());
            }
            bridge_post(&format!("/channels/{}/enable", channel), "{}")
        }
        "check_main_update" => bridge_get("/setup/check_main_update"),
        _ => Err(format!("未知操作: {}", op)),
    }
}

// ============================================================
// App entry point with system tray
// ============================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let no_autostart = args.iter().any(|a| a == "--no-autostart");
    let dev_mode = args.iter().any(|a| a == "--dev");

    let bridge_ok = is_bridge_running();
    let mut spawned_bridge = false;
    if !bridge_ok && !no_autostart {
        if is_bridge_port_open() {
            eprintln!("[penglai-desktop] port 14168 is occupied by an old or untrusted bridge; setup window will be shown");
        } else {
            let (py_str, dir_str) = get_or_discover_config();
            let dir = PathBuf::from(&dir_str);
            let script = dir.join("frontends").join("desktop_bridge.py");
            if script.exists() {
                let mut cmd = Command::new(&py_str);
                cmd.arg(&script).current_dir(&dir);
                #[cfg(windows)]
                cmd.creation_flags(0x08000000);
                if let Ok(child) = cmd.spawn() {
                    *BRIDGE_PROCESS.lock().unwrap() = Some(child);
                    spawned_bridge = true;
                }
            }
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            start_bridge_with_config,
            get_config,
            install_runtime,
            install_runtime_step,
            check_update,
            setup_op,
            check_app_update,
            install_app_update,
            detect_legacy_penglai,
        ])
        .setup(move |app| {
            // ---- System tray icon (macOS menu bar / Windows notification area) ----
            let show_hide_item = tauri::menu::MenuItemBuilder::with_id("show_hide", "显示主窗口")
                .build(app)?;
            let check_update_item = tauri::menu::MenuItemBuilder::with_id("check_update", "检查更新")
                .build(app)?;
            let quit_item = tauri::menu::MenuItemBuilder::with_id("quit", "退出蓬莱")
                .build(app)?;

            let tray_menu = tauri::menu::MenuBuilder::new(app)
                .item(&show_hide_item)
                .item(&check_update_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let _tray = tauri::tray::TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&tray_menu)
                .tooltip("蓬莱 · Penglai")
                .on_menu_event(move |app_handle, event| {
                    match event.id().as_ref() {
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
                            // Task 9: emit event to renderer instead of eval'ing JS.
                            // Renderer (app.js) listens via window.__TAURI__.event.listen.
                            let _ = app_handle.emit("menu-check-update", ());
                        }
                        "quit" => {
                            stop_bridge_process();
                            app_handle.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray_icon, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up, ..
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

            // ---- Bridge startup & window routing ----
            let bridge_wait = if spawned_bridge {
                Duration::from_secs(20)
            } else {
                Duration::from_secs(2)
            };
            let bridge_ready = if bridge_ok { true } else { wait_for_bridge_ready(bridge_wait) };
            if bridge_ready {
                if let Some(w) = app.get_webview_window("main") {
                    let url = tauri::Url::parse("http://127.0.0.1:14168/").unwrap();
                    let _ = w.navigate(url);
                    if dev_mode {
                        w.open_devtools();
                    } else {
                        let _ = w.eval(r#"
                            document.addEventListener('keydown', function(e) {
                                if (e.key === 'F12' || e.key === 'F5' ||
                                    (e.ctrlKey && e.key === 'r') ||
                                    (e.ctrlKey && e.shiftKey && e.key === 'I')) {
                                    e.preventDefault();
                                }
                            });
                            document.addEventListener('contextmenu', function(e) {
                                e.preventDefault();
                            });
                        "#);
                    }
                    let _ = w.show();
                }
            } else {
                if let Some(w) = app.get_webview_window("setup") {
                    if dev_mode {
                        w.open_devtools();
                    }
                    let _ = w.show();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let label = window.label();
                if label == "main" {
                    // Hide to tray instead of quitting (unless PENGLAI_NO_TRAY is set, for CI)
                    let no_tray = std::env::var("PENGLAI_NO_TRAY").is_ok();
                    if no_tray {
                        stop_bridge_process();
                        window.app_handle().exit(0);
                    } else {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                } else if label == "setup" {
                    if let Some(main_win) = window.app_handle().get_webview_window("main") {
                        // Only exit if main window is confirmed hidden.
                        // On is_visible() error, be conservative: assume visible, don't exit.
                        if !main_win.is_visible().unwrap_or(true) {
                            stop_bridge_process();
                            window.app_handle().exit(0);
                        }
                    } else {
                        stop_bridge_process();
                        window.app_handle().exit(0);
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
