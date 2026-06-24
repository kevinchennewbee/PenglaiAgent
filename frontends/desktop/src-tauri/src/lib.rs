use std::process::{Command, Child};
use std::sync::Mutex;
use std::net::TcpStream;
use std::io::{Read, Write};
use std::time::{Duration, Instant};
use std::thread;
use std::path::PathBuf;
use tauri::Manager;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

static BRIDGE_PROCESS: Mutex<Option<Child>> = Mutex::new(None);

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
    // exe is at frontends/Penglai.exe
    // bridge is at frontends/desktop_bridge.py
    std::env::current_exe()
        .expect("cannot get exe path")
        .parent().expect("cannot get exe dir")
        .join("desktop_bridge.py")
}

#[allow(dead_code)]
/// Find python executable:
/// 1. .portable/uv-python/ 下找 python.exe (Windows) 或 python3 (Unix)
/// 2. Fallback to system PATH
fn find_python() -> String {
    let root = project_root();
    let portable_python_dir = root.join(".portable").join("uv-python");

    if portable_python_dir.exists() {
        // uv installs python like: uv-python/cpython-3.12.x-windows-x86_64/python.exe
        // We need to search for python.exe inside subdirectories
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

    // Fallback: system PATH
    #[cfg(windows)]
    { "python".to_string() }
    #[cfg(not(windows))]
    { "python3".to_string() }
}

/// Find project directory by searching upward from exe for agentmain.py
fn find_project_dir() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    let mut dir = exe.parent();
    // Walk up to 8 levels from exe location
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

/// Settings file path: ~/.penglai_desktop_settings.json
fn settings_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".penglai_desktop_settings.json")
}

fn legacy_settings_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".ga_desktop_settings.json")
}

/// Read config from settings file, or auto-discover and save
pub fn get_or_discover_config() -> (String, String) {
    let path = settings_path();
    let legacy_path = legacy_settings_path();

    // Try reading existing settings. The old desktop settings path is kept as
    // a one-way migration source so existing testers do not lose their config.
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

    // Auto-discover
    let python = find_python();
    let project = find_project_dir().unwrap_or_default();

    // Save discovered config
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

#[allow(dead_code)]
fn ensure_bridge_running() {
    if is_bridge_running() {
        eprintln!("[penglai-desktop] bridge already running on 127.0.0.1:14168; reusing it");
        return;
    }
    if is_bridge_port_open() {
        eprintln!("[penglai-desktop] port 14168 is occupied by an old or untrusted bridge; not reusing it");
        return;
    }
    start_bridge();
}

#[tauri::command]
fn start_bridge_with_config(app_handle: tauri::AppHandle, python_path: String, project_dir: String) -> Result<(), String> {
    // Save to settings
    let path = settings_path();
    let obj = serde_json::json!({"python_path": python_path, "project_dir": project_dir});
    std::fs::write(&path, serde_json::to_string_pretty(&obj).unwrap())
        .map_err(|e| format!("Failed to write settings: {}", e))?;

    // Start bridge only if it is not already accepting connections.
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
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        let child = cmd.spawn().map_err(|e| format!("Failed to spawn: {}", e))?;
        *BRIDGE_PROCESS.lock().unwrap() = Some(child);
    }

    // Wait until the bridge serves the tokenized Penglai frontend.
    if !wait_for_bridge_ready(Duration::from_secs(20)) {
        return Err("Bridge did not become ready within 20s".into());
    }

    // Navigate main window to bridge URL after the bridge is ready, then show it.
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
            // Try to start bridge with saved/discovered config.
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
        .invoke_handler(tauri::generate_handler![start_bridge_with_config, get_config])
        .setup(move |app| {
            let bridge_wait = if spawned_bridge {
                Duration::from_secs(20)
            } else {
                Duration::from_secs(2)
            };
            let bridge_ready = if bridge_ok { true } else { wait_for_bridge_ready(bridge_wait) };
            if bridge_ready {
                // Navigate to bridge HTTP only after it is ready; the window starts on loading.html
                // so WebView never caches an early "connection refused" error page.
                if let Some(w) = app.get_webview_window("main") {
                    let url = tauri::Url::parse("http://127.0.0.1:14168/").unwrap();
                    let _ = w.navigate(url);
                    if dev_mode {
                        w.open_devtools();
                    } else {
                        // Disable F5/F12/Ctrl+R/right-click in production
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
                // Show setup window
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
                    // Main closed -> exit app
                    window.app_handle().exit(0);
                } else if label == "setup" {
                    // Setup closed -> exit if main is not visible
                    if let Some(main_win) = window.app_handle().get_webview_window("main") {
                        if !main_win.is_visible().unwrap_or(false) {
                            window.app_handle().exit(0);
                        }
                    } else {
                        window.app_handle().exit(0);
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
