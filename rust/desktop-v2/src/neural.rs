//! Native inference and verified model installation. No Python or compiler at runtime.
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

#[derive(Deserialize)]
struct Model { file: String, bytes: u64, sha256: String }
#[derive(Deserialize)]
struct Profile { profile: String, models: Vec<Model> }
fn profile() -> Profile {
    serde_json::from_str(include_str!("../../models/neural-earth/desktop-profile.json")).expect("Invalid compiled model profile")
}
pub struct Neural {
    resources: PathBuf,
    weights: PathBuf,
    operation: Mutex<()>,
    progress: Mutex<Value>,
    url: Mutex<Option<String>>,
}
impl Neural {
    pub fn new(resources: PathBuf, data: PathBuf) -> Self {
        let data = std::env::var_os("MAGNA_RUNTIME_DATA").map(PathBuf::from).unwrap_or(data);
        let weights = std::env::var_os("MAGNA_DESKTOP_NEURAL_WEIGHTS").map(PathBuf::from)
            .unwrap_or_else(|| data.join("models").join(profile().profile));
        Self { resources, weights, operation: Mutex::new(()), progress: Mutex::new(json!({"phase":"idle"})), url: Mutex::new(None) }
    }
    fn progress(&self, value: Value) { *self.progress.lock().unwrap() = value; }
    fn download(&self, version: &str) -> Result<(), String> {
        fs::create_dir_all(&self.weights).map_err(|e| e.to_string())?;
        let client = reqwest::blocking::Client::builder().connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(1800)).user_agent("Magna-Urbis-Desktop").build().map_err(|e| e.to_string())?;
        for model in profile().models {
            self.progress(json!({"phase":"verify","file":model.file}));
            let target = self.weights.join(&model.file);
            if verified(&target, &model)? { continue; }
            let url = format!("https://github.com/dunkean/magna-urbis/releases/download/desktop-v{version}/{}", model.file);
            let mut response = client.get(&url).send().and_then(|r| r.error_for_status()).map_err(|e| format!("Download {}: {e}", model.file))?;
            let partial = target.with_extension("part");
            let result = (|| {
                let mut output = File::create(&partial).map_err(|e| e.to_string())?;
                copy_verified(&mut response, &mut output, &model, |received| {
                    self.progress(json!({"phase":"download","file":model.file,"received":received,"total":model.bytes}));
                })?;
                output.sync_all().map_err(|e| e.to_string())?;
                drop(output);
                if target.exists() { fs::remove_file(&target).map_err(|e| e.to_string())?; }
                fs::rename(&partial, &target).map_err(|e| e.to_string())
            })();
            if result.is_err() { let _ = fs::remove_file(&partial); }
            result?;
        }
        self.progress(json!({"phase":"ready"}));
        Ok(())
    }
    fn ensure(&self, app: &tauri::AppHandle) -> Result<String, String> {
        let _operation = self.operation.try_lock().map_err(|_| "A neural operation is already running. Wait for it to finish.")?;
        if let Some(url) = self.url.lock().unwrap().clone() {
            let port = url.rsplit(':').next().and_then(|p| p.parse().ok()).unwrap_or(0);
            if super::modules::service_status(port).is_some_and(|v| v["service"] == "magna-urbis-neural" && v["profile"] == profile().profile) { return Ok(url); }
        }
        self.download(&app.package_info().version.to_string())?;
        self.progress(json!({"phase":"starting"}));
        let binary = self.resources.join(if cfg!(windows) { "magna-urbis-neural.exe" } else { "magna-urbis-neural" });
        let mut command = Command::new(binary);
        command.arg("serve").arg("--weights").arg(&self.weights).args(["--address", "127.0.0.1:0"]);
        let (child, port) = super::ready_child(&mut command)?;
        app.state::<super::Services>().0.lock().map_err(|e| e.to_string())?.push(child);
        let url = format!("http://127.0.0.1:{port}");
        *self.url.lock().unwrap() = Some(url.clone());
        self.progress(json!({"phase":"ready"}));
        Ok(url)
    }
}

fn verified(path: &Path, model: &Model) -> Result<bool, String> {
    let mut input = match File::open(path) { Ok(f) => f, Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false), Err(e) => return Err(e.to_string()) };
    if input.metadata().map_err(|e| e.to_string())?.len() != model.bytes { return Ok(false); }
    let mut digest = Sha256::new();
    let mut chunk = [0u8; 262144];
    loop { let count = input.read(&mut chunk).map_err(|e| e.to_string())?; if count == 0 { break; } digest.update(&chunk[..count]); }
    Ok(format!("{:x}", digest.finalize()) == model.sha256)
}
fn copy_verified(input: &mut impl Read, output: &mut impl Write, model: &Model, mut progress: impl FnMut(u64)) -> Result<(), String> {
    let mut digest = Sha256::new();
    let mut received = 0u64;
    let mut chunk = [0u8; 262144];
    loop {
        let count = input.read(&mut chunk).map_err(|e| e.to_string())?;
        if count == 0 { break; }
        received += count as u64;
        if received > model.bytes { return Err(format!("{} is larger than expected", model.file)); }
        digest.update(&chunk[..count]); output.write_all(&chunk[..count]).map_err(|e| e.to_string())?; progress(received);
    }
    if received != model.bytes || format!("{:x}", digest.finalize()) != model.sha256 { return Err(format!("Integrity check failed for {}. Retry the download.", model.file)); }
    Ok(())
}

#[tauri::command]
pub fn desktop_neural_status(neural: tauri::State<'_, Neural>) -> Value {
    let profile = profile();
    json!({"profile":profile.profile,"directory":neural.weights,"progress":*neural.progress.lock().unwrap(),
        "busy":neural.operation.try_lock().is_err(),"models":profile.models.iter().map(|m| json!({"file":m.file,"bytes":m.bytes,
            "present":fs::metadata(neural.weights.join(&m.file)).is_ok_and(|s| s.len()==m.bytes)})).collect::<Vec<_>>()})
}
#[tauri::command]
pub async fn desktop_neural_download(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let neural = app.state::<Neural>();
        let _operation = neural.operation.try_lock().map_err(|_| "A neural operation is already running.")?;
        let result = neural.download(&app.package_info().version.to_string());
        if let Err(error) = &result { neural.progress(json!({"phase":"error","message":error})); }
        result
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn ensure_neural(app: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let neural = app.state::<Neural>();
        let result = neural.ensure(&app);
        if let Err(error) = &result { neural.progress(json!({"phase":"error","message":error})); }
        result
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transfers_reject_corruption_and_incomplete_or_oversized_files() {
        let model = Model { file: "test".into(), bytes: 3, sha256: format!("{:x}", Sha256::digest(b"abc")) };
        for bytes in [b"ab".as_slice(), b"abd", b"abcd"] {
            assert!(copy_verified(&mut &bytes[..], &mut Vec::new(), &model, |_| {}).is_err());
        }
        let mut output = Vec::new();
        copy_verified(&mut &b"abc"[..], &mut output, &model, |_| {}).unwrap();
        assert_eq!(output, b"abc");
    }
    #[test]
    fn profile_is_complete_and_paths_are_plain_filenames() {
        let profile = profile();
        assert_eq!(profile.models.len(), 3);
        for model in profile.models { assert_eq!(Path::new(&model.file).components().count(), 1); assert!(model.bytes > 0); assert_eq!(model.sha256.len(), 64); }
    }
}
