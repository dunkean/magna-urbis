//! Optional desktop modules. Startup never installs Python, packages or weights.
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Manager, State};

#[derive(Clone, Default, Serialize, Deserialize)]
struct Configuration { terrain: String, illustration: String, earth: String }
#[derive(Default)]
struct Activity { busy: bool, last: Option<Value> }
pub struct Modules {
    resources: PathBuf,
    data: PathBuf,
    cache: PathBuf,
    config: Mutex<Configuration>,
    activity: Arc<Mutex<Activity>>,
}
fn component(value: &str) -> Result<(), String> {
    if matches!(value, "terrain" | "illustration") { Ok(()) } else { Err("Unknown module".into()) }
}
impl Modules {
    pub fn new(resources: PathBuf, data: PathBuf, cache: PathBuf) -> Self {
        let data = std::env::var_os("MAGNA_RUNTIME_DATA").map(PathBuf::from).unwrap_or(data);
        let cache = std::env::var_os("MAGNA_RUNTIME_CACHE").map(PathBuf::from).unwrap_or(cache);
        let mut warning = None;
        for dir in [&data, &cache] {
            if let Err(error) = fs::create_dir_all(dir) { warning = Some(error.to_string()); }
        }
        let config = match fs::read(data.join("modules.json")) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|error| { warning = Some(format!("Cannot read modules.json: {error}. Save paths to repair it.")); Configuration::default() }),
            Err(error) => { if error.kind() != std::io::ErrorKind::NotFound { warning = Some(error.to_string()); } Configuration::default() },
        };
        let activity = Activity { busy: false, last: warning.map(|message| json!({"action":"initialization","success":false,"message":message})) };
        Self { resources, data, cache, config: Mutex::new(config), activity: Arc::new(Mutex::new(activity)) }
    }
    fn uv(&self) -> PathBuf { self.resources.join(if cfg!(windows) { "bin/uv.exe" } else { "bin/uv" }) }
    fn python(&self, name: &str) -> PathBuf {
        let key = if name == "terrain" { "MAGNA_NEURAL_PYTHON" } else { "MAGNA_ILLUSTRATION_PYTHON" };
        if let Some(path) = std::env::var_os(key).filter(|path| !path.is_empty()) { return path.into(); }
        let config = self.config.lock().unwrap();
        let value = if name == "terrain" { &config.terrain } else { &config.illustration };
        if !value.is_empty() { return value.into(); }
        self.data.join("venvs").join(name).join(if cfg!(windows) { "Scripts/python.exe" } else { "bin/python" })
    }
    fn earth(&self) -> PathBuf {
        if let Some(path) = std::env::var_os("MAGNA_NEURAL_EARTH").filter(|path| !path.is_empty()) { return path.into(); }
        let config = self.config.lock().unwrap();
        if !config.earth.is_empty() { return (&config.earth).into(); }
        let inventory = fs::read(self.resources.join("rust/models/neural-earth/model-inventory.json"))
            .ok().and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
        let revision = inventory.as_ref().and_then(|v| v["sourceRevision"].as_str()).unwrap_or("unavailable");
        self.data.join("sources").join(format!("neural-earth-{revision}"))
    }
    fn env(&self, command: &mut Command) {
        let hf_home = std::env::var_os("HF_HOME").map(PathBuf::from).unwrap_or_else(|| {
            let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
            let existing = home.map(|home| home.join(".cache/huggingface"));
            existing.filter(|path| path.join("hub/models--xandergos--terrain-diffusion-30m").is_dir())
                .unwrap_or_else(|| self.cache.join("huggingface"))
        });
        let weights = std::env::var_os("MAGNA_NEURAL_WEIGHTS_DIR").map(PathBuf::from)
            .unwrap_or_else(|| self.data.join("models/distilled"));
        command.current_dir(&self.resources).env("UV_CACHE_DIR", self.cache.join("uv"))
            .env("UV_PYTHON_INSTALL_DIR", self.data.join("python"))
            .env("HF_HOME", hf_home)
            .env("MAGNA_RUNTIME_DATA", &self.data).env("MAGNA_RUNTIME_CACHE", &self.cache)
            .env("MAGNA_ILLUSTRATION_OUTPUT", self.data.join("illustrations"))
            .env("MAGNA_NEURAL_WEIGHTS_DIR", weights)
            .env("TERRAIN_RUNTIME_ROOT", self.data.join("terrain-runtime"));
        super::hidden(command);
    }
    fn start(&self, name: &str, app: &tauri::AppHandle) -> Result<Value, String> {
        component(name)?;
        let port = if name == "terrain" { 8793 } else { 8794 };
        if let Some(status) = service_status(port) {
            if correct_service(name, &status) { return Ok(json!({"message":"Compatible service is already running; it will be reused."})); }
            return Err(format!("Port {port} is occupied by an incompatible service."));
        }
        if std::net::TcpStream::connect_timeout(&format!("127.0.0.1:{port}").parse().unwrap(), std::time::Duration::from_millis(150)).is_ok() {
            return Err(format!("Port {port} is occupied, but no compatible service status could be read."));
        }
        let python = self.python(name);
        if !python.is_file() { return Err("Python environment missing. Install the module or configure an existing interpreter.".into()); }
        let mut command = Command::new(python);
        self.env(&mut command);
        command.arg("-u");
        if name == "terrain" {
            let earth = self.earth();
            if !earth.join("backend/terrain_app.py").is_file() || !earth.join("terrain-diffusion/terrain_diffusion").is_dir() {
                return Err("Neural Earth runtime source missing. Install the terrain module or configure its source directory.".into());
            }
            command.arg(self.resources.join("web/scripts/neural_python.py")).env("MAGNA_NEURAL_EARTH", earth);
        } else { command.args(["-m", "illustration"]); }
        let log = fs::OpenOptions::new().create(true).append(true).open(self.data.join(format!("{name}.log"))).map_err(|e| e.to_string())?;
        command.stdin(Stdio::null()).stdout(log.try_clone().map_err(|e| e.to_string())?).stderr(log);
        let child = command.spawn().map_err(|e| e.to_string())?;
        let pid = child.id();
        app.state::<super::Services>().0.lock().map_err(|e| e.to_string())?.push(child);
        for _ in 0..60 {
            if let Some(status) = service_status(port) {
                if correct_service(name, &status) { return Ok(json!({"message":"Service is ready. Reload detection to use it; model weights are checked on generation."})); }
                return Err(format!("Unexpected service on port {port}."));
            }
            if let Some(code) = child_exit(app, pid)? { return Err(format!("{name} stopped ({code}). {}", tail(&self.data.join(format!("{name}.log"))))); }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
        Err(format!("{name} is still initializing after 30 seconds. Refresh detection later. {}", tail(&self.data.join(format!("{name}.log")))))
    }
    pub fn start_existing(&self, app: &tauri::AppHandle) {
        for name in ["illustration", "terrain"] {
            if self.python(name).is_file() {
                if let Err(error) = self.start(name, app) { eprintln!("Optional {name}: {error}"); }
            }
        }
    }
}

fn tail(path: &Path) -> String {
    let Ok(mut file) = File::open(path) else { return String::new(); };
    if let Ok(length) = file.metadata().map(|m| m.len()) { let _ = file.seek(SeekFrom::Start(length.saturating_sub(12000))); }
    let mut bytes = Vec::new(); let _ = file.take(12000).read_to_end(&mut bytes);
    String::from_utf8_lossy(&bytes).into_owned()
}
fn service_status(port: u16) -> Option<Value> {
    let mut socket = std::net::TcpStream::connect_timeout(&format!("127.0.0.1:{port}").parse().ok()?, std::time::Duration::from_millis(150)).ok()?;
    socket.set_read_timeout(Some(std::time::Duration::from_millis(250))).ok()?;
    socket.set_write_timeout(Some(std::time::Duration::from_millis(250))).ok()?;
    write!(socket, "GET /status HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\n\r\n").ok()?;
    let mut bytes = Vec::new(); let _ = socket.take(65536).read_to_end(&mut bytes);
    let response = String::from_utf8_lossy(&bytes);
    let (header, body) = response.split_once("\r\n\r\n")?;
    if !header.lines().next()?.contains(" 200 ") { return None; }
    serde_json::from_str(body).ok()
}
fn correct_service(name: &str, status: &Value) -> bool {
    if name == "terrain" { status["backend"] == "python-cuda" } else { status["service"] == "magna-illustration" }
}
fn child_exit(app: &tauri::AppHandle, pid: u32) -> Result<Option<std::process::ExitStatus>, String> {
    let services = app.state::<super::Services>();
    let mut children = services.0.lock().map_err(|e| e.to_string())?;
    children.iter_mut().find(|child| child.id() == pid).ok_or("Process is no longer tracked")?.try_wait().map_err(|e| e.to_string())
}
#[tauri::command]
pub fn desktop_status(modules: State<'_, Modules>) -> Value {
    let (busy, last) = { let activity = modules.activity.lock().unwrap(); (activity.busy, activity.last.clone()) };
    json!({"uv": modules.uv().is_file(), "dataDir": modules.data, "cacheDir": modules.cache,
        "components": (["terrain", "illustration"].map(|name| {
            let path = modules.python(name);
            let config = modules.config.lock().unwrap().clone();
            let port = if name == "terrain" { 8793 } else { 8794 };
            let online = service_status(port).is_some_and(|status| correct_service(name, &status));
            json!({"component":name,"installed":path.is_file(),"online":online,"resolvedPython":path,
                "python":if name == "terrain" {config.terrain.clone()} else {config.illustration.clone()},
                "configured": if name == "terrain" { !config.terrain.is_empty() } else { !config.illustration.is_empty() },
                "earth": if name == "terrain" { Some(config.earth) } else { None }})
        })), "busy":busy,"lastOperation":last,"log":format!("{}\n\nTerrain service:\n{}\n\nIllustration service:\n{}",tail(&modules.data.join("modules.log")),tail(&modules.data.join("terrain.log")),tail(&modules.data.join("illustration.log")))})
}
#[tauri::command]
pub fn desktop_configure(modules: State<'_, Modules>, component: String, python: String, earth: String) -> Result<(), String> {
    self::component(&component)?;
    let activity = modules.activity.lock().unwrap();
    if activity.busy { return Err("Wait for the current operation to finish.".into()); }
    for path in [&python, &earth] {
        if !path.is_empty() && !Path::new(path).is_absolute() { return Err("Use an absolute path.".into()); }
    }
    if !python.is_empty() && !Path::new(&python).is_file() { return Err("Python interpreter does not exist.".into()); }
    if component == "terrain" && !earth.is_empty() && !Path::new(&earth).join("backend/terrain_app.py").is_file() { return Err("Neural Earth source directory does not contain backend/terrain_app.py.".into()); }
    let mut config = modules.config.lock().unwrap();
    let mut next = config.clone();
    if component == "terrain" { next.terrain = python; next.earth = earth; } else { next.illustration = python; }
    fs::write(modules.data.join("modules.json"), serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    *config = next; Ok(())
}

#[tauri::command]
pub fn desktop_action(app: tauri::AppHandle, modules: State<'_, Modules>, action: String, repo: Option<String>, revision: Option<String>) -> Result<(), String> {
    let known = ["setup-illustration", "setup-terrain", "probe-illustration", "probe-terrain", "start-illustration", "start-terrain", "download-original", "download-distilled"];
    if !known.contains(&action.as_str()) { return Err("Unknown action".into()); }
    let mut activity = modules.activity.lock().unwrap();
    if activity.busy { return Err("A module operation is already running.".into()); }
    if action.starts_with("download-distilled") && (repo.as_deref().unwrap_or("").is_empty() || revision.as_deref().unwrap_or("").len() != 40) {
        return Err("Provide the published Hugging Face repository and its full commit SHA.".into());
    }
    activity.busy = true; activity.last = None; drop(activity);
    std::thread::spawn(move || {
        let modules = app.state::<Modules>();
        let result = (|| -> Result<Value, String> {
            if let Some(name) = action.strip_prefix("start-") { return modules.start(name, &app); }
            let uv = modules.uv();
            let probing = action.starts_with("probe-");
            let mut command = if probing {
                let name = action.strip_prefix("probe-").unwrap();
                let python = modules.python(name);
                if !python.is_file() { return Err("Environment is not installed or configured. No download was started.".into()); }
                let mut command = Command::new(&python);
                command.env(if name == "terrain" { "MAGNA_NEURAL_PYTHON" } else { "MAGNA_ILLUSTRATION_PYTHON" }, &python);
                command
            } else {
                if !uv.is_file() { return Err("Bundled uv is missing; rebuild the desktop resources.".into()); }
                let mut command = Command::new(&uv);
                command.args(["run", "--no-project", "--managed-python", "--python", "3.12"]); command
            };
            modules.env(&mut command);
            if action.starts_with("download-") {
                command.args(["--with", "huggingface-hub==1.33.0", "--script"]).arg(modules.resources.join("scripts/neural_release.py"));
                if action == "download-original" { command.args(["download-original", "--stage", "coarse", "--stage", "base", "--stage", "decoder"]); }
                else { command.args(["download-distilled", "--repo"]).arg(repo.as_deref().unwrap_or("")).arg("--revision").arg(revision.as_deref().unwrap_or("")).arg("--output").arg(modules.data.join("models/distilled")); }
            } else {
                if !probing { command.arg("--script"); }
                command.arg(modules.resources.join("python_runtime/runtime_manager.py")).arg("--uv").arg(&uv);
                let (verb, name) = action.split_once('-').ok_or("Invalid action")?;
                let earth = modules.earth();
                if name == "terrain" && earth.join("backend/terrain_app.py").is_file() { command.env("MAGNA_NEURAL_EARTH", earth); }
                command.args([verb, name]);
            }
            let log = File::create(modules.data.join("modules.log")).map_err(|e| e.to_string())?;
            command.stdin(Stdio::null()).stdout(log.try_clone().map_err(|e| e.to_string())?).stderr(log);
            let child = command.spawn().map_err(|e| e.to_string())?;
            let pid = child.id();
            app.state::<super::Services>().0.lock().map_err(|e| e.to_string())?.push(child);
            let code = loop {
                if let Some(code) = child_exit(&app, pid)? { break code; }
                std::thread::sleep(std::time::Duration::from_millis(200));
            };
            if !code.success() { return Err(format!("Operation failed ({code}). See the log for details.")); }
            Ok(json!({"message":if action.starts_with("setup-") {"Managed environment installed. Any saved interpreter or environment override remains selected; clear that override to use the managed environment."} else {"Operation completed. See diagnostics in the log. Model compatibility is checked by the selected runtime."}}))
        })();
        let mut activity = modules.activity.lock().unwrap();
        activity.busy = false;
        activity.last = Some(match result {
            Ok(value) => json!({"action":action,"success":true,"message":value["message"]}),
            Err(message) => json!({"action":action,"success":false,"message":message}),
        });
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn service_handshake_reads_json_from_http() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let worker = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                let mut byte = [0]; socket.read_exact(&mut byte).unwrap(); request.push(byte[0]);
            }
            socket.write_all(b"HTTP/1.0 200 OK\r\nContent-Type: application/json\r\n\r\n{\"backend\":\"python-cuda\"}").unwrap();
        });
        let status = service_status(port).unwrap();
        assert!(correct_service("terrain", &status));
        assert!(!correct_service("illustration", &status));
        worker.join().unwrap();
    }
    #[test] fn log_tail_is_bounded() {
        let dir = std::env::temp_dir().join(format!("magna-modules-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap(); let log = dir.join("test.log");
        fs::write(&log, vec![b'x'; 24000]).unwrap(); assert_eq!(tail(&log).len(), 12000);
        fs::remove_file(log).unwrap(); fs::remove_dir(dir).unwrap();
    }
}
