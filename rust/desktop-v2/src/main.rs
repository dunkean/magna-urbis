#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, mpsc};
use std::time::Duration;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Own only processes started by this window. Reused services outlive it.
struct Services(Mutex<Vec<Child>>);
impl Drop for Services {
    fn drop(&mut self) {
        if let Ok(children) = self.0.get_mut() {
            for child in children.iter_mut() {
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    let _ = Command::new("taskkill.exe").args(["/PID", &child.id().to_string(), "/T", "/F"])
                        .creation_flags(0x08000000).stdout(Stdio::null()).stderr(Stdio::null()).status();
                }
                let _ = child.kill();
                let _ = child.wait();
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

fn optional_python(resources: &std::path::Path, children: &mut Vec<Child>) {
    if std::net::TcpStream::connect_timeout(&"127.0.0.1:8793".parse().unwrap(), Duration::from_millis(150)).is_ok() { return; }
    // Installed apps use an explicitly configured external interpreter and model checkout.
    let checkout = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let earth = std::env::var_os("MAGNA_NEURAL_EARTH").map(PathBuf::from)
        .unwrap_or_else(|| checkout.join("../infinite_map"));
    let interpreter = std::env::var_os("MAGNA_NEURAL_PYTHON").map(PathBuf::from).unwrap_or_else(||
        earth.join(if cfg!(windows) { ".venv/Scripts/python.exe" } else { ".venv/bin/python" }));
    if !interpreter.is_file() { return; }
    let script = resources.join("web/scripts/neural_python.py");
    if !script.is_file() { return; }
    let mut command = Command::new(interpreter);
    command.args(["-u"]).arg(script).env("MAGNA_NEURAL_EARTH", earth).current_dir(resources)
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    hidden(&mut command);
    if let Ok(child) = command.spawn() { children.push(child); }
}

fn main() {
    tauri::Builder::default().setup(|app| {
        let resources = if cfg!(debug_assertions) { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources") }
            else { app.path().resource_dir()?.join("resources") };
        let binary = std::env::var_os("MAGNA_LOCAL_BIN").map(PathBuf::from).unwrap_or_else(||
            resources.join(if cfg!(windows) { "magna-urbis-local.exe" } else { "magna-urbis-local" }));
        let (engine, port) = native(binary)?;
        let mut children = vec![engine];
        optional_python(&resources, &mut children);
        app.manage(Services(Mutex::new(children)));
        let url = format!("v2.html?profile=local&localServer=http%3A%2F%2F127.0.0.1%3A{port}");
        WebviewWindowBuilder::new(app, "main", WebviewUrl::App(url.into()))
            .title("Magna Urbis V2").inner_size(1440.0, 960.0).min_inner_size(800.0, 600.0).build()?;
        Ok(())
    }).run(tauri::generate_context!()).expect("Magna Urbis V2 n’a pas pu démarrer");
}
