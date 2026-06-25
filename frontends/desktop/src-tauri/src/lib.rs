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

fn extract_field(_text: &str, _key: &str) -> Option<String> {
    None
}

// ============================================================
// New 0.3.0 complete-wizard commands
// ============================================================

/// Run a Python one-liner and return its stdout.
fn exec_python(python_path: &str, project_dir: &str, code: &str) -> Result<String, String> {
    let mut cmd = Command::new(python_path);
    cmd.args(["-c", code]).current_dir(project_dir);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    let output = cmd.output().map_err(|e| format!("Python 执行失败: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(if stderr.is_empty() { stdout } else { stderr });
    }
    Ok(stdout.trim().to_string())
}

/// Run a Python command with streaming progress events.
fn exec_python_streaming(
    app_handle: &tauri::AppHandle,
    python_path: &str,
    project_dir: &str,
    args: &[&str],
    step_label: &str,
) -> Result<String, String> {
    let mut cmd = Command::new(python_path);
    for arg in args {
        cmd.arg(arg);
    }
    cmd.current_dir(project_dir);
    run_streaming(app_handle, cmd, step_label)
}

/// Unified setup operation dispatcher.  The frontend calls this with an op name
/// and optional JSON params; the Rust side executes the matching Python logic.
#[tauri::command]
fn setup_op(
    app_handle: tauri::AppHandle,
    python_path: String,
    project_dir: String,
    op: String,
    params: String,
) -> Result<String, String> {
    match op.as_str() {
        // ---- LLM provider catalog ----
        "list_providers" => {
            let code = r#"
import sys,os,json
sys.path.insert(0,os.getcwd())
data=None
try:
    import yaml
    with open('penglai_providers.yaml','r',encoding='utf-8') as f:
        data=yaml.safe_load(f)
except Exception:
    pass
if data is None:
    # Fallback: hardcoded minimal catalog
    data={"wizard_order":["deepseek","volcengine","bailian","zhipu","minimax","moonshot","openrouter","hunyuan","xunfei","agnes","custom"],"providers":{}}
print(json.dumps(data,ensure_ascii=False))
"#;
            exec_python(&python_path, &project_dir, code)
        }

        // ---- Test LLM endpoint connectivity ----
        "test_llm" => {
            let p: serde_json::Value = serde_json::from_str(&params)
                .map_err(|e| format!("invalid params JSON: {}", e))?;
            let base = p["base_url"].as_str().unwrap_or("");
            let model = p["model"].as_str().unwrap_or("");
            let key = p["api_key"].as_str().unwrap_or("");
            let code = format!(
                r#"import urllib.request,json,sys
try:
    req=urllib.request.Request('{base}/chat/completions',
        data=json.dumps({{"model":"{model}","messages":[{{"role":"user","content":"回复两个字：蓬莱"}}],"max_tokens":64}}).encode(),
        headers={{"Authorization":"Bearer {key}","Content-Type":"application/json"}})
    resp=urllib.request.urlopen(req,timeout=40)
    body=json.loads(resp.read())
    content=body['choices'][0]['message']['content']
    print(json.dumps({{"ok":True,"content":content}}))
except Exception as e:
    print(json.dumps({{"ok":False,"error":str(e)[:200]}}))
"#,
                base = base.trim_end_matches('/'),
                model = model.replace('"', r#"\""#),
                key = key.replace('"', r#"\""#),
            );
            exec_python(&python_path, &project_dir, &code)
        }

        // ---- Feishu QR code init (device code flow) ----
        "feishu_qr_init" => {
            let code = r#"
import urllib.request,json
try:
    # Step 1: init
    req=urllib.request.Request('https://accounts.feishu.cn/oauth/v1/app/registration',
        data=b'action=init',headers={'Content-Type':'application/x-www-form-urlencoded'})
    resp=urllib.request.urlopen(req,timeout=20)
    data=json.loads(resp.read())
    if 'client_secret' not in str(data.get('supported_auth_methods','')):
        print(json.dumps({"ok":False,"error":"Feishu device flow not available, use manual mode"}))
        raise SystemExit(0)
    # Step 2: begin
    req2=urllib.request.Request('https://accounts.feishu.cn/oauth/v1/app/registration',
        data=b'action=begin&archetype=PersonalAgent&auth_method=client_secret&request_user_info=open_id',
        headers={'Content-Type':'application/x-www-form-urlencoded'})
    resp2=urllib.request.urlopen(req2,timeout=20)
    data2=json.loads(resp2.read())
    print(json.dumps({"ok":True,"device_code":data2.get("device_code",""),
        "qr_url":data2.get("verification_uri_complete",""),
        "expires_in":data2.get("expires_in",600),"interval":data2.get("interval",2)}))
except Exception as e:
    print(json.dumps({"ok":False,"error":str(e)[:200]}))
"#;
            exec_python(&python_path, &project_dir, code)
        }

        // ---- Feishu QR code poll ----
        "feishu_qr_poll" => {
            let p: serde_json::Value = serde_json::from_str(&params)
                .map_err(|e| format!("invalid params JSON: {}", e))?;
            let device_code = p["device_code"].as_str().unwrap_or("");
            let code = format!(
                r#"import urllib.request,json
try:
    req=urllib.request.Request('https://accounts.feishu.cn/oauth/v1/app/registration',
        data='action=poll&device_code={dc}&tp=ob_app'.encode(),
        headers={{'Content-Type':'application/x-www-form-urlencoded'}})
    resp=urllib.request.urlopen(req,timeout=20)
    data=json.loads(resp.read())
    if 'client_id' in data and 'client_secret' in data:
        print(json.dumps({{"status":"ok","app_id":data['client_id'],"app_secret":data['client_secret']}}))
    elif 'access_denied' in str(data):
        print(json.dumps({{"status":"denied"}}))
    elif 'expired' in str(data).lower():
        print(json.dumps({{"status":"expired"}}))
    else:
        print(json.dumps({{"status":"waiting"}}))
except Exception as e:
    print(json.dumps({{"status":"error","error":str(e)[:200]}}))
"#,
                dc = device_code,
            );
            exec_python(&python_path, &project_dir, &code)
        }

        // ---- Feishu verify credentials ----
        "feishu_verify" => {
            let p: serde_json::Value = serde_json::from_str(&params)
                .map_err(|e| format!("invalid params JSON: {}", e))?;
            let app_id = p["app_id"].as_str().unwrap_or("");
            let app_secret = p["app_secret"].as_str().unwrap_or("");
            let code = format!(
                r#"import urllib.request,json
try:
    body=json.dumps({{"app_id":"{aid}","app_secret":"{asec}"}}).encode()
    req=urllib.request.Request('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
        data=body,headers={{'Content-Type':'application/json'}})
    resp=urllib.request.urlopen(req,timeout=20)
    data=json.loads(resp.read())
    if data.get('code')==0:
        print(json.dumps({{"ok":True,"tenant_access_token":"valid"}}))
    else:
        print(json.dumps({{"ok":False,"error":"code={{}} msg={{}}".format(data.get('code'),data.get('msg',''))}}))
except Exception as e:
    print(json.dumps({{"ok":False,"error":str(e)[:200]}}))
"#,
                aid = app_id,
                asec = app_secret,
            );
            exec_python(&python_path, &project_dir, &code)
        }

        // ---- Write L1 identity file ----
        "write_identity" => {
            let p: serde_json::Value = serde_json::from_str(&params)
                .map_err(|e| format!("invalid params JSON: {}", e))?;
            let agent_name = p["agent_name"].as_str().unwrap_or("蓬莱助手 Penglai");
            let user_name = p["user_name"].as_str().unwrap_or("主人");
            let code = format!(
                r#"import os
mem_dir=os.path.join(os.getcwd(),'memory')
os.makedirs(mem_dir,exist_ok=True)
ins_path=os.path.join(mem_dir,'global_mem_insight.txt')

base='''# [Global Memory Insight]
L0: ../memory/memory_management_sop.md
L2: global_mem.txt (当前空)
L3: cleanup/scheduled/autonomous/plan/subagent/web_setup
L4: ../memory/L4_raw_sessions/

# 规则
1. 行动验证: 无工具执行结果不写入记忆
2. 交叉验证: 关键事实至少两个独立来源
3. 读后即改: 修改前必须先读当前内容
4. 闭环: 每次任务结束做记忆结算
5. SOP 优先: 匹配到场景先读对应 SOP

[身份]
我是「{an}」，基于 GenericAgent 的开源个人管家发行版蓬莱。用户称呼：{un}。
被问及身份/名字时以此为准，勿自称底层模型名。

[蓬莱SOP]
penglai_checkpoint_sop: 长任务打检查点
penglai_compress_sop: 记忆压缩
penglai_channels_sop: IM渠道管理（penglai enable <渠道>）
penglai_memsig_sop: 长期事实写入（时间戳+取代旧条目）
scheduled_task_sop: 提醒/定时任务（注意注入安全）
penglai_weather_sop: 天气（Open-Meteo 免费）
版本更新: penglai update --check / --apply，禁止裸 git 命令

[蓬莱规则]
IM 图片: 读 penglai_im_vision_sop，用 ask_vision(backend='openai')，勿先 OCR
语音: 包含[audio:文件名]时，首个工具调用必须是 transcribe(path=该音频路径)
'''.format(an="{an}",un="{un}")

existing=''
if os.path.exists(ins_path):
    with open(ins_path,'r',encoding='utf-8') as f:
        existing=f.read()

if existing and '[身份]' in existing:
    # Preserve existing identity, only update SOP/rules
    for tag in ['[身份]','[蓬莱SOP]','[蓬莱规则]']:
        idx=existing.find(tag)
        if idx>=0:
            end=existing.find('[',idx+1)
            existing=existing[:idx]+('' if end<0 else existing[end:])
    with open(ins_path,'w',encoding='utf-8') as f:
        f.write(existing.strip()+'\n\n'+base)
else:
    with open(ins_path,'w',encoding='utf-8') as f:
        f.write(base)
os.chmod(ins_path,0o600)
print('ok')
"#,
                an = agent_name.replace('\'', r#"'"'"'"#),
                un = user_name.replace('\'', r#"'"'"'"#),
            );
            exec_python(&python_path, &project_dir, &code)
        }

        // ---- Write mykey.py ----
        "write_mykey" => {
            let p: serde_json::Value = serde_json::from_str(&params)
                .map_err(|e| format!("invalid params JSON: {}", e))?;
            // Build mykey.py content from params
            let llm_name = p["llm_name"].as_str().unwrap_or("DeepSeek");
            let llm_key = p["llm_key"].as_str().unwrap_or("");
            let llm_base = p["llm_base"].as_str().unwrap_or("https://api.deepseek.com");
            let llm_model = p["llm_model"].as_str().unwrap_or("deepseek-v4-flash");
            let lang = p["lang"].as_str().unwrap_or("zh");
            let fs_app_id = p["fs_app_id"].as_str().unwrap_or("");
            let fs_app_secret = p["fs_app_secret"].as_str().unwrap_or("");
            let fs_owner_open_id = p["fs_owner_open_id"].as_str().unwrap_or("");
            let companion = p["companion"].as_bool().unwrap_or(false);
            let critic_model = p["critic_model"].as_str().unwrap_or("");
            let critic_mode = if critic_model.is_empty() { "" } else { "smart" };
            let tinyfish_key = p["tinyfish_key"].as_str().unwrap_or("");
            let tavily_key = p["tavily_key"].as_str().unwrap_or("");
            let firecrawl_key = p["firecrawl_key"].as_str().unwrap_or("");

            let code = format!(
                r#"import os,shutil,json
mk=os.path.join(os.getcwd(),'mykey.py')
if os.path.exists(mk):
    import datetime
    bak=mk+'.bak.'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    shutil.copy2(mk,bak)

body='''# mykey.py -- 由 Penglai Desktop 生成
native_oai_config = {{
    'name': '{llm_name}',
    'apikey': '{llm_key}',
    'apibase': '{llm_base}',
    'model': '{llm_model}',
    'max_retries': 3,
}}
mixin_config = {{
    'llm_nos': ['{llm_name}'],
    'max_retries': 2,
    'base_delay': 2,
}}
penglai_lang = '{lang}'
fs_app_id = '{fs_id}'
fs_app_secret = '{fs_sec}'
fs_allowed_users = []
fs_owner_open_id = "{fs_oid}"
'''.format(llm_name='{llm_name}',llm_key='{llm_key}',llm_base='{llm_base}',llm_model='{llm_model}',
           lang='{lang}',fs_id='{fs_id}',fs_sec='{fs_sec}',fs_oid='{fs_oid}')

if '{companion}'=='true':
    body+='companion_enabled = True\n'
if '{critic_model}':
    body+="critic_model = '{{}}'\ncritic_mode = '{{}}'\n".format('{critic_model}','{critic_mode}')
if '{tinyfish}':
    body+="tinyfish_key = '{{}}'\n".format('{tinyfish}')
if '{tavily}':
    body+="tavily_key = '{{}}'\n".format('{tavily}')
if '{firecrawl}':
    body+="firecrawl_key = '{{}}'\n".format('{firecrawl}')

with open(mk,'w',encoding='utf-8') as f:
    f.write(body)
os.chmod(mk,0o600)
print('ok')
"#,
                llm_name = llm_name,
                llm_key = llm_key,
                llm_base = llm_base,
                llm_model = llm_model,
                lang = lang,
                fs_id = fs_app_id,
                fs_sec = fs_app_secret,
                fs_oid = fs_owner_open_id,
                companion = if_true("true", companion),
                critic_model = critic_model,
                critic_mode = critic_mode,
                tinyfish = tinyfish_key,
                tavily = tavily_key,
                firecrawl = firecrawl_key,
            );
            exec_python(&python_path, &project_dir, &code)
        }

        // ---- Get runtime service status ----
        "service_status" => {
            let code = r#"
import subprocess,json,os,sys
cwd=os.getcwd()
py=os.path.join(cwd,'.venv','bin','python')
if not os.path.exists(py):
    py=sys.executable
result={"services":[],"bridge":False}
# Check if bridge is running
import socket
s=socket.socket()
s.settimeout(1)
if s.connect_ex(('127.0.0.1',14168))==0:
    result["bridge"]=True
s.close()
# Check penglai processes
try:
    out=subprocess.check_output(['pgrep','-f','penglai'],timeout=3).decode()
    for line in out.strip().split('\n'):
        if line.strip():
            result["services"].append({"pid":line.strip(),"name":"penglai"})
except:
    pass
print(json.dumps(result))
"#;
            exec_python(&python_path, &project_dir, code)
        }

        // ---- Run full doctor diagnostic ----
        "doctor" => {
            exec_python_streaming(
                &app_handle, &python_path, &project_dir,
                &["penglai", "doctor"],
                "doctor",
            )
        }

        // ---- Enable a channel (for post-install "补配置") ----
        "enable_channel" => {
            let p: serde_json::Value = serde_json::from_str(&params)
                .map_err(|e| format!("invalid params JSON: {}", e))?;
            let channel = p["channel"].as_str().unwrap_or("");
            exec_python_streaming(
                &app_handle, &python_path, &project_dir,
                &["penglai", "enable", channel],
                &format!("enable_{}", channel),
            )
        }

        // ---- Check for runtime update against main branch ----
        "check_main_update" => {
            let code = format!(
                r#"import subprocess,sys,json,os
cwd=os.getcwd()
# Check if git repo
if not os.path.exists(os.path.join(cwd,'.git')):
    print(json.dumps({{"has_update":False,"detail":"not a git install"}}))
    raise SystemExit(0)
# Check against main branch on release remote
try:
    subprocess.run(['git','fetch','release','main','--depth=1'],cwd=cwd,
        timeout=30,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    behind=subprocess.check_output(['git','rev-list','--count','HEAD..release/main'],
        cwd=cwd,timeout=10).decode().strip()
    has=int(behind)>0
    print(json.dumps({{"has_update":has,"behind":behind,"detail":"{{}} commits behind main".format(behind)}}))
except Exception as e:
    print(json.dumps({{"has_update":False,"detail":str(e)[:200]}}))
"#,
            );
            exec_python(&python_path, &project_dir, &code)
        }

        _ => Err(format!("未知操作: {}", op)),
    }
}

fn if_true(s: &str, cond: bool) -> &str {
    if cond { "true" } else { s }
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
        .invoke_handler(tauri::generate_handler![
            start_bridge_with_config,
            get_config,
            install_runtime,
            install_runtime_step,
            check_update,
            setup_op,
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
                                let _ = w.eval("if(typeof checkForUpdates==='function')checkForUpdates()");
                            }
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
