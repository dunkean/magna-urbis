#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, mpsc};
use std::time::Duration;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

struct Engine(Mutex<Child>);
struct IllustrationEngine(Mutex<Option<Child>>);

impl Drop for IllustrationEngine {
    fn drop(&mut self) {
        if let Ok(slot) = self.0.get_mut() {
            if let Some(child) = slot.as_mut() {
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    // A Windows venv executable can have its own interpreter child.
                    let _ = Command::new("taskkill.exe")
                        .args(["/PID", &child.id().to_string(), "/T", "/F"])
                        .creation_flags(0x08000000).stdout(Stdio::null()).stderr(Stdio::null()).status();
                }
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn start_illustration(resources: PathBuf) -> IllustrationEngine {
    // Reuse an already-running connector without taking ownership of it.
    if std::net::TcpStream::connect_timeout(&"127.0.0.1:8794".parse().unwrap(), Duration::from_millis(250)).is_ok() {
        return IllustrationEngine(Mutex::new(None));
    }
    let checkout = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let python = std::env::var_os("MAGNA_ILLUSTRATION_PYTHON").map(PathBuf::from)
        .or_else(|| {
            let path = checkout.join(if cfg!(windows) { ".venv-illustration/Scripts/python.exe" } else { ".venv-illustration/bin/python" });
            path.is_file().then_some(path)
        });
    let Some(python) = python else { return IllustrationEngine(Mutex::new(None)); };
    let root = if resources.join("illustration/__main__.py").is_file() { resources } else { checkout };
    let mut command = Command::new(python);
    command.args(["-u", "-m", "illustration"]).current_dir(root)
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    IllustrationEngine(Mutex::new(command.spawn().ok()))
}

impl Engine {
    fn stop(&self) {
        if let Ok(mut child) = self.0.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        self.stop();
    }
}

fn start_engine(binary: PathBuf) -> Result<(Engine, u16), Box<dyn std::error::Error>> {
    let mut command = Command::new(binary);
    command
        .args(["--port", "0"])
        .env("MAGNA_LOCAL_ADDR", "127.0.0.1:0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn()?;
    let stdout = child.stdout.take().expect("piped engine stdout");
    let engine = Engine(Mutex::new(child));
    let (sender, ready) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line)
                && value["ready"] == true
                && let Some(port) = value["port"]
                    .as_u64()
                    .and_then(|port| u16::try_from(port).ok())
            {
                let _ = sender.send(port);
                // Keep draining stdout so logging can never stall the engine.
            }
        }
    });
    let port = ready.recv_timeout(Duration::from_secs(20))?;
    Ok((engine, port))
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let binary = std::env::var_os("MAGNA_LOCAL_BIN")
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    let name = if cfg!(windows) {
                        "magna-urbis-local.exe"
                    } else {
                        "magna-urbis-local"
                    };
                    if cfg!(debug_assertions) {
                        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                            .join("resources")
                            .join(name)
                    } else {
                        app.path()
                            .resource_dir()
                            .expect("application resources")
                            .join("resources")
                            .join(name)
                    }
                });
            let (engine, port) = start_engine(binary)?;
            app.manage(engine);
            let resources = if cfg!(debug_assertions) {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")
            } else {
                app.path().resource_dir()?.join("resources")
            };
            app.manage(start_illustration(resources));
            let profiles: serde_json::Value =
                serde_json::from_str(include_str!("../../../config/execution.json"))?;
            let source = profiles["local"]["neural"].as_str().unwrap_or("neural-python");
            // An explicit fresh route replaces a stale procedural terrain session,
            // while the other workshops and exported decors remain available.
            let url = format!(
                "rustbench.html?profile=local&localServer=http%3A%2F%2F127.0.0.1%3A{port}#terrain?source={source}&width=2400"
            );
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App(url.into()))
                .title("Magna Urbis")
                .inner_size(1440.0, 960.0)
                .min_inner_size(800.0, 600.0)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Magna Urbis could not start");
    app.run(|app, event| {
        if matches!(event, RunEvent::Exit) {
            app.state::<Engine>().stop();
        }
    });
}
