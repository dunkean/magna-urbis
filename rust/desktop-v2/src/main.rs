#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, mpsc};
use std::time::Duration;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
mod modules;
mod updates;

/// Own only processes started by this window. Reused services outlive it.
struct Services(Mutex<Vec<Child>>);
fn stop_child(child: &mut Child) {
    // A reaped child PID may already have been reused by an unrelated process.
    if matches!(child.try_wait(), Ok(Some(_))) { return; }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill.exe").args(["/PID", &child.id().to_string(), "/T", "/F"])
            .creation_flags(0x08000000).stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
    #[cfg(unix)]
    { let _ = Command::new("kill").args(["-TERM", "--", &format!("-{}", child.id())]).stdout(Stdio::null()).stderr(Stdio::null()).status(); }
    let _ = child.kill(); let _ = child.wait();
}
impl Services {
    fn stop(&self) { if let Ok(mut children) = self.0.lock() { for child in children.iter_mut() { stop_child(child); } } }
}
impl Drop for Services {
    fn drop(&mut self) {
        if let Ok(children) = self.0.get_mut() {
            for child in children.iter_mut() {
                stop_child(child);
            }
        }
    }
}

fn hidden(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let _ = command;
}

fn native(binary: PathBuf) -> Result<(Child, u16), Box<dyn std::error::Error>> {
    let mut command = Command::new(binary);
    command.args(["--port", "0"]).env("MAGNA_LOCAL_ADDR", "127.0.0.1:0")
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::inherit());
    hidden(&mut command);
    let mut child = command.spawn()?;
    let stdout = child.stdout.take().ok_or("Sortie du moteur absente")?;
    let (sender, receiver) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line)
                && value["ready"] == true
                && let Some(port) = value["port"].as_u64().and_then(|port| u16::try_from(port).ok()) {
                let _ = sender.try_send(port);
            }
        }
    });
    match receiver.recv_timeout(Duration::from_secs(30)) {
        Ok(port) => Ok((child, port)),
        Err(error) => { let _ = child.kill(); let _ = child.wait(); Err(error.into()) }
    }
}

fn main() {
    tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![modules::desktop_status, modules::desktop_configure, modules::desktop_action, updates::desktop_release_info, updates::desktop_open_download])
    .on_window_event(|window, event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Some(services) = window.try_state::<Services>() { services.stop(); }
        }
    })
    .setup(|app| {
        let resources = if cfg!(debug_assertions) { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources") }
            else { app.path().resource_dir()?.join("resources") };
        let binary = std::env::var_os("MAGNA_LOCAL_BIN").map(PathBuf::from).unwrap_or_else(||
            resources.join(if cfg!(windows) { "magna-urbis-local.exe" } else { "magna-urbis-local" }));
        let (engine, port) = native(binary)?;
        app.manage(Services(Mutex::new(vec![engine])));
        // Optional modules never prevent the procedural application from opening.
        app.manage(modules::Modules::new(resources, app.path().app_local_data_dir()?, app.path().app_cache_dir()?));
        let handle = app.handle().clone();
        std::thread::spawn(move || handle.state::<modules::Modules>().start_existing(&handle));
        let url = format!("v2.html?profile=local&localServer=http%3A%2F%2F127.0.0.1%3A{port}");
        WebviewWindowBuilder::new(app, "main", WebviewUrl::App(url.into()))
            .title("Magna Urbis V2").inner_size(1440.0, 960.0).min_inner_size(800.0, 600.0).build()?;
        Ok(())
    }).build(tauri::generate_context!()).expect("Magna Urbis V2 n’a pas pu démarrer")
    .run(|app, event| {
        // Tauri can exit without dropping managed state or delivering Destroyed.
        if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
            if let Some(services) = app.try_state::<Services>() { services.stop(); }
        }
    });
}
