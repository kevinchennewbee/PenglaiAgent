use std::process::{Command, Child, Stdio};
use std::sync::Mutex;
use std::net::TcpStream;
use std::io::{Read, Write, BufRead, BufReader};
use std::time::{Duration, Instant};
use std::thread;
use std::path::PathBuf;
use tauri::{Manager, Emitter};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

static BRIDGE_PROCESS: Mutex<Option<Child>> = Mutex::new(None);
const PENGLAI_OWNER_REPO: &str = "kevinchennewbee/PenglaiAgent";
const PENGLAI_RELEASE_BRANCH: &str = "codex/0.3.0-runtime-hub";

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
/// events, and return Ok(log) or Err(log) when it finishes.  This replaces the
/// old `command.output()` blocking call that left the UI frozen for minutes.
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
        // Download install.sh to a temp file first, then execute it.
        // This avoids the `curl | sh` pipe which silently succeeds (exit 0)
        // when curl fails to download the script — the root cause of the
        // "click button, nothing happens" bug.
        let tmp_dir = std::env::temp_dir();
        let script_path = tmp_dir.join("penglai-install-desktop.sh");
        let script_path_str = script_path.to_string_lossy().to_string();
        let url = raw_github_url("install.sh");

        // Download with fallback to gh-proxy mirror
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

#[tauri::command]
fn start_bridge_with_config(app_handle: tauri::AppHandle, python_path: String, project_dir: String) -> Result<(), String> {
    write_desktop_settings(&python_path, &project_dir)?;

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

/// Full runtime install with streaming progress events.
/// Emits "install-progress" events with {step, line, done, ok} to the frontend.
#[tauri::command]
fn install_runtime(
    app_handle: tauri::AppHandle,
    include_voice: bool,
    include_tts: bool,
) -> Result<RuntimeInstallResult, String> {
    let project = default_runtime_project_dir();
    let project_dir = project.to_string_lossy().to_string();

    // Step 1: bootstrap (download source + Python + deps + install-check)
    let cmd = build_install_command(&project);
    run_streaming(&app_handle, cmd, "bootstrap")?;

    let python_path = find_project_python(&project).unwrap_or_else(find_python);

    // Step 2: optional voice model
    if include_voice {
        let mut cmd = Command::new(&python_path);
        cmd.arg("penglai").arg("enable").arg("voice").current_dir(&project);
        let _ = run_streaming(&app_handle, cmd, "voice");
    }

    // Step 3: optional TTS model
    if include_tts {
        let mut cmd = Command::new(&python_path);
        cmd.arg("penglai").arg("enable").arg("tts").current_dir(&project);
        let _ = run_streaming(&app_handle, cmd, "tts");
    }

    // Step 4: diagnostics (install-check)
    let mut cmd = Command::new(&python_path);
    cmd.arg("penglai").arg("install-check").arg("--json").current_dir(&project);
    let _ = run_streaming(&app_handle, cmd, "diagnostics");

    write_desktop_settings(&python_path, &project_dir)?;
    Ok(RuntimeInstallResult { python_path, project_dir, log: String::new() })
}

/// Run a single step independently (for re-running voice/tts/doctor/update-check
/// without redoing the full bootstrap).  Supports the "补配置" use case.
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

/// Check for runtime updates by parsing `penglai update --check` output.
#[tauri::command]
fn check_update() -> Result<UpdateInfo, String> {
    let project = default_runtime_project_dir();
    let python_path = find_project_python(&project).unwrap_or_else(find_python);

    let mut cmd = Command::new(&python_path);
    cmd.arg("penglai").arg("update").arg("--check").current_dir(&project);
    let output = cmd.output().map_err(|e| format!("启动失败: {}", e))?;
    let text = String::from_utf8_lossy(&output.stdout).to_string()
        + &String::from_utf8_lossy(&output.stderr);

    // Parse: "🔄 检查蓬莱更新 ..." + "✅ 已是最新版" or version lines
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

fn extract_field(_text: &str, _key: &str) -> Option<String> {
    // Simple extraction; penglai update --check prints human-readable text
    // We return the whole text as detail and let frontend parse display
    None
}

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
        .invoke_handler(tauri::generate_handler![
            start_bridge_with_config,
            get_config,
            install_runtime,
            install_runtime_step,
            check_update,
        ])
        .setup(move |app| {
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
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let label = window.label();
                if label == "main" {
                    stop_bridge_process();
                    window.app_handle().exit(0);
                } else if label == "setup" {
                    if let Some(main_win) = window.app_handle().get_webview_window("main") {
                        if !main_win.is_visible().unwrap_or(false) {
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
