#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, mpsc};
use std::time::Duration;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

struct Engine(Mutex<Child>);

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
            let url =
                format!("rustbench.html?profile=local&localServer=http%3A%2F%2F127.0.0.1%3A{port}");
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
