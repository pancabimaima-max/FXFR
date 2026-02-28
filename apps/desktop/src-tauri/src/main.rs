#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{
    env,
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};
use tauri::{Manager, State};

const ENGINE_HOST: &str = "127.0.0.1";
const ENGINE_PORT: u16 = 8765;

#[derive(Default)]
struct SidecarState {
    inner: Mutex<SidecarInner>,
}

#[derive(Default)]
struct SidecarInner {
    child: Option<Child>,
    mode: String,
    managed: bool,
    last_error: String,
}

#[derive(Serialize)]
struct EngineRuntimeInfo {
    engine_url: String,
    sidecar_mode: String,
    sidecar_managed: bool,
    last_error: String,
}

#[derive(Serialize)]
struct EngineBootstrapHandoff {
    session_token: String,
    first_launch_complete: bool,
    display_timezone: String,
    server_timezone: String,
    macro_enabled: bool,
    macro_disabled_reason: String,
    worker_pool_size: i64,
    data_root: String,
}

#[derive(Clone)]
struct EngineLaunch {
    program: PathBuf,
    args: Vec<String>,
    cwd: PathBuf,
    mode: String,
}

fn engine_url() -> String {
    format!("http://{}:{}", ENGINE_HOST, ENGINE_PORT)
}

fn engine_addr() -> SocketAddr {
    format!("{}:{}", ENGINE_HOST, ENGINE_PORT)
        .parse()
        .expect("invalid engine socket address")
}

fn is_engine_port_open(addr: SocketAddr) -> bool {
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

fn wait_for_engine_port(addr: SocketAddr, attempts: u32, sleep_ms: u64) -> bool {
    for _ in 0..attempts {
        if is_engine_port_open(addr) {
            return true;
        }
        thread::sleep(Duration::from_millis(sleep_ms));
    }
    false
}

fn find_repo_root(start: &Path) -> Option<PathBuf> {
    let mut current = Some(start.to_path_buf());
    while let Some(path) = current {
        if path.join(".repo-role").exists() {
            return Some(path);
        }
        current = path.parent().map(|p| p.to_path_buf());
    }
    None
}

fn resolve_dev_launch(repo_root: &Path) -> Option<EngineLaunch> {
    let engine_dir = repo_root.join("services").join("engine");
    let python = engine_dir.join(".venv").join("Scripts").join("python.exe");
    if !python.exists() || !engine_dir.exists() {
        return None;
    }

    Some(EngineLaunch {
        program: python,
        args: vec![
            "-m".to_string(),
            "uvicorn".to_string(),
            "app.main:app".to_string(),
            "--host".to_string(),
            ENGINE_HOST.to_string(),
            "--port".to_string(),
            ENGINE_PORT.to_string(),
        ],
        cwd: engine_dir,
        mode: "dev_venv".to_string(),
    })
}

fn packaged_candidates(exe_dir: &Path) -> Vec<PathBuf> {
    vec![
        exe_dir.join("resources").join("engine").join("fxfr-engine.exe"),
        exe_dir.join("engine").join("fxfr-engine.exe"),
        exe_dir.join("fxfr-engine.exe"),
    ]
}

fn resolve_packaged_launch() -> Result<EngineLaunch, String> {
    let exe = env::current_exe().map_err(|err| format!("cannot resolve current exe: {err}"))?;
    let exe_dir = exe
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "current exe has no parent directory".to_string())?;

    let candidates = packaged_candidates(&exe_dir);
    for candidate in &candidates {
        if candidate.exists() {
            let cwd = candidate
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| exe_dir.clone());
            return Ok(EngineLaunch {
                program: candidate.clone(),
                args: vec![],
                cwd,
                mode: "packaged_sidecar".to_string(),
            });
        }
    }

    let scanned = candidates
        .iter()
        .map(|p| p.display().to_string())
        .collect::<Vec<_>>()
        .join(" | ");
    Err(format!("packaged sidecar not found. Scanned: {scanned}"))
}

fn resolve_engine_launch() -> Result<EngineLaunch, String> {
    if let Ok(cwd) = env::current_dir() {
        if let Some(root) = find_repo_root(&cwd) {
            if let Some(launch) = resolve_dev_launch(&root) {
                return Ok(launch);
            }
        }
    }

    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            if let Some(root) = find_repo_root(parent) {
                if let Some(launch) = resolve_dev_launch(&root) {
                    return Ok(launch);
                }
            }
        }
    }

    resolve_packaged_launch()
}

fn ensure_engine_running(state: &SidecarState) {
    let addr = engine_addr();
    {
        let mut inner = state.inner.lock().expect("sidecar state lock poisoned");
        inner.last_error.clear();

        if is_engine_port_open(addr) {
            inner.mode = "reused_existing".to_string();
            inner.managed = false;
            return;
        }

        let launch = match resolve_engine_launch() {
            Ok(launch) => launch,
            Err(err) => {
                inner.mode = "unavailable".to_string();
                inner.managed = false;
                inner.last_error = format!(
                    "No launch target found for engine sidecar: {err}. Use pnpm dev:fullstack as fallback."
                );
                return;
            }
        };

        let mut command = Command::new(&launch.program);
        command
            .args(&launch.args)
            .current_dir(&launch.cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .env("PYTHONUNBUFFERED", "1");

        match command.spawn() {
            Ok(child) => {
                inner.child = Some(child);
                inner.managed = true;
                inner.mode = launch.mode;
            }
            Err(err) => {
                inner.mode = "spawn_failed".to_string();
                inner.managed = false;
                inner.last_error = format!("Failed to spawn engine sidecar: {err}");
                return;
            }
        }
    }

    if !wait_for_engine_port(addr, 40, 250) {
        let mut inner = state.inner.lock().expect("sidecar state lock poisoned");
        if let Some(mut child) = inner.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        inner.managed = false;
        inner.mode = "start_timeout".to_string();
        inner.last_error =
            "Engine sidecar did not become reachable on 127.0.0.1:8765 in time. Use pnpm dev:fullstack fallback."
                .to_string();
    }
}

fn stop_engine_if_managed(state: &SidecarState) {
    let mut inner = state.inner.lock().expect("sidecar state lock poisoned");
    if let Some(mut child) = inner.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    if inner.mode.is_empty() {
        inner.mode = "stopped".to_string();
    }
    inner.managed = false;
}

#[tauri::command]
fn engine_runtime_info(state: State<'_, SidecarState>) -> EngineRuntimeInfo {
    let inner = state.inner.lock().expect("sidecar state lock poisoned");
    EngineRuntimeInfo {
        engine_url: engine_url(),
        sidecar_mode: inner.mode.clone(),
        sidecar_managed: inner.managed,
        last_error: inner.last_error.clone(),
    }
}

#[tauri::command]
fn engine_bootstrap_handoff() -> Result<EngineBootstrapHandoff, String> {
    let url = format!("{}/v1/bootstrap", engine_url());
    let response = ureq::get(&url)
        .call()
        .map_err(|err| format!("bootstrap handoff request failed: {err}"))?;

    let payload: serde_json::Value = response
        .into_json()
        .map_err(|err| format!("bootstrap handoff response parse failed: {err}"))?;

    let data = payload
        .get("data")
        .cloned()
        .ok_or_else(|| "bootstrap handoff missing data field".to_string())?;

    let read_string = |k: &str| -> String {
        data.get(k)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string()
    };
    let read_bool = |k: &str| -> bool { data.get(k).and_then(|v| v.as_bool()).unwrap_or(false) };
    let read_i64 = |k: &str| -> i64 { data.get(k).and_then(|v| v.as_i64()).unwrap_or_default() };

    Ok(EngineBootstrapHandoff {
        session_token: read_string("session_token"),
        first_launch_complete: read_bool("first_launch_complete"),
        display_timezone: read_string("display_timezone"),
        server_timezone: read_string("server_timezone"),
        macro_enabled: read_bool("macro_enabled"),
        macro_disabled_reason: read_string("macro_disabled_reason"),
        worker_pool_size: read_i64("worker_pool_size"),
        data_root: read_string("data_root"),
    })
}

fn main() {
    let app = tauri::Builder::default()
        .manage(SidecarState::default())
        .setup(|app| {
            let state = app.state::<SidecarState>();
            ensure_engine_running(state.inner());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![engine_runtime_info, engine_bootstrap_handoff])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) {
            let state = app_handle.state::<SidecarState>();
            stop_engine_if_managed(state.inner());
        }
    });
}
