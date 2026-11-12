use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
    mpsc,
};
use std::time::{Duration, Instant};

struct Service {
    child: Child,
    port: u16,
}

impl Drop for Service {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Own only this application's neural process; never adopt or stop another service.
pub struct NeuralEngine {
    resources: PathBuf,
    service: Mutex<Option<Service>>,
    closing: AtomicBool,
}

impl NeuralEngine {
    pub fn new(resources: PathBuf) -> Self {
        Self {
            resources,
            service: Mutex::new(None),
            closing: AtomicBool::new(false),
        }
    }

    pub fn stop(&self) {
        self.closing.store(true, Ordering::Relaxed);
        if let Ok(mut slot) = self.service.lock() {
            slot.take();
        }
    }

    pub fn ensure(&self) -> Result<String, String> {
        // Keep the lock through startup so concurrent windows share one child.
        let mut slot = self.service.lock().map_err(|e| e.to_string())?;
        if self.closing.load(Ordering::Relaxed) {
            return Err("Application is closing".into());
        }
        if let Some(service) = slot.as_mut() {
            if service
                .child
                .try_wait()
                .map_err(|e| e.to_string())?
                .is_none()
                && status(service.port).is_ok_and(|value| value["state"] == "ready")
            {
                return Ok(format!("http://127.0.0.1:{}", service.port));
            }
        }
        slot.take();
        let checkout = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        let name = if cfg!(windows) {
            "neural.exe"
        } else {
            "neural"
        };
        let binary = self.resources.join(name);
        let binary = if binary.is_file() {
            binary
        } else if cfg!(debug_assertions) {
            checkout.join("target/release").join(name)
        } else {
            return Err("Bundled neural executable is missing".into());
        };
        let weights = self.resources.join("neural-weights");
        let weights = if weights.is_dir() {
            weights
        } else if cfg!(debug_assertions) {
            checkout.join("pkg/neural-weights")
        } else {
            return Err("Bundled neural weights are missing".into());
        };
        for name in ["coarse", "base", "decoder"] {
            if !weights.join(format!("{name}.safetensors")).is_file() {
                return Err(format!("Neural weights are missing: {name}.safetensors"));
            }
        }
        let mut command = Command::new(binary);
        command
            .arg("serve")
            .arg("--weights")
            .arg(weights)
            .args(["--address", "127.0.0.1:0"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let child = command
            .spawn()
            .map_err(|e| format!("Could not start neural service: {e}"))?;
        // The guard also kills the child on timeout, startup error or app exit.
        let mut service = Service { child, port: 0 };
        let stdout = service.child.stdout.take().ok_or("Missing neural stdout")?;
        let (sender, ready) = mpsc::sync_channel(1);
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line)
                    && value["ready"] == true
                    && let Some(port) = value["port"].as_u64().and_then(|p| u16::try_from(p).ok())
                {
                    let _ = sender.try_send(port);
                }
                // Drain all later logs so inference can never block on stdout.
            }
        });
        let deadline = Instant::now() + Duration::from_secs(180);
        loop {
            if self.closing.load(Ordering::Relaxed) {
                return Err("Application is closing".into());
            }
            if let Some(exit) = service.child.try_wait().map_err(|e| e.to_string())? {
                return Err(format!("Neural service exited during startup: {exit}"));
            }
            if service.port == 0 {
                service.port = ready.try_recv().unwrap_or(0);
            }
            if service.port != 0 {
                if let Ok(value) = status(service.port) {
                    if value["state"] == "ready" {
                        let url = format!("http://127.0.0.1:{}", service.port);
                        *slot = Some(service);
                        return Ok(url);
                    }
                    if value["state"] == "error" {
                        return Err(format!(
                            "Neural service could not load: {}",
                            value["message"]
                        ));
                    }
                }
            }
            if Instant::now() >= deadline {
                return Err("Neural service startup timed out".into());
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    }
}

fn status(port: u16) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    let mut stream =
        TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(500))?;
    stream.set_read_timeout(Some(Duration::from_secs(1)))?;
    stream.set_write_timeout(Some(Duration::from_secs(1)))?;
    stream.write_all(b"GET /status HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")?;
    let mut response = String::new();
    stream.take(64 * 1024).read_to_string(&mut response)?;
    let (headers, body) = response
        .split_once("\r\n\r\n")
        .ok_or("Invalid neural response")?;
    if !headers.starts_with("HTTP/1.1 200 ") {
        return Err("Neural status unavailable".into());
    }
    Ok(serde_json::from_str(body)?)
}

#[tauri::command]
pub async fn ensure_neural(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || app.state::<NeuralEngine>().ensure())
        .await
        .map_err(|e| e.to_string())?
}
