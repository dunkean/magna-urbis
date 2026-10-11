//! Local HTTP service for the terrain bench (native only).
//!
//! One GPU thread keeps the networks resident; it warms the kernels up once at
//! start. `GET /status` reports its state; `GET /generate?seed=…&relief=…`
//! returns the delivered `1024²` little-endian FP32 heights (metres, row-major
//! from the north-west corner, sea at zero), with metadata in `X-Neural-Meta`.
use crate::{Clock, Networks, Request};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::{Sender, channel};
use std::sync::{Arc, Mutex};
use std::time::Instant;

struct Wall(Instant);
impl Clock for Wall {
    fn now_ms(&self) -> f64 {
        self.0.elapsed().as_secs_f64() * 1000.0
    }
}

#[derive(Clone)]
struct Status {
    state: &'static str,
    message: String,
    generated: u64,
}

type Reply = Result<(Vec<f32>, String), String>;
type Job = (HashMap<String, String>, Sender<Reply>);

fn json_escape(text: &str) -> String {
    text.replace('\\', "\\\\").replace('"', "\\\"")
}

fn decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                if let Ok(v) = u8::from_str_radix(&text[i + 1..i + 3], 16) {
                    out.push(v);
                    i += 2;
                }
            }
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn request(query: &HashMap<String, String>) -> Result<Request, String> {
    let get = |key: &str, default: &str| query.get(key).cloned().unwrap_or_else(|| default.into());
    let number = |key: &str, default: f64| {
        query
            .get(key)
            .and_then(|v| v.parse().ok())
            .unwrap_or(default)
    };
    Request::regional(
        &get("seed", "42"),
        &get("relief", "hills"),
        number("mix", 0.5),
        number("coasts", 0.0) as u8,
        &get("islands", "island"),
        &get("climate", "temperate"),
        number("noise", 0.05) as f32,
    )
}

fn generate(networks: &Networks, query: &HashMap<String, String>, clock: &Wall) -> Reply {
    let request = request(query)?;
    let started = clock.now_ms();
    let output = pollster::block_on(networks.generate(&request, clock))?;
    let t = &output.timings;
    let (min, max) = output
        .heights
        .iter()
        .fold((f32::MAX, f32::MIN), |(a, b), &h| (a.min(h), b.max(h)));
    let land =
        output.heights.iter().filter(|&&h| h > 0.0).count() as f64 / output.heights.len() as f64;
    let meta = format!(
        r#"{{"resolution":{},"extent":{},"min":{min},"max":{max},"land":{land},"totalMs":{:.1},"coarseMs":{:.1},"baseMs":{:.1},"decoderMs":{:.1},"reconstructionMs":{:.1},"evaluations":[{},{},{}],"profile":"coarse4 \u00b7 base 1 passe \u00b7 decoder student200k \u00b7 FP16 Vulkan"}}"#,
        output.resolution,
        request.extent_m,
        clock.now_ms() - started,
        t.coarse_ms,
        t.base_ms,
        t.decoder_ms,
        t.reconstruction_ms,
        output.evaluations.0,
        output.evaluations.1,
        output.evaluations.2,
    );
    Ok((output.heights, meta))
}

fn respond(
    stream: &mut TcpStream,
    status: &str,
    kind: &str,
    extra: &str,
    body: &[u8],
) -> std::io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Expose-Headers: X-Neural-Meta\r\nCache-Control: no-store\r\nConnection: close\r\n{extra}\r\n",
        body.len()
    )?;
    stream.write_all(body)
}

fn handle(
    mut stream: TcpStream,
    status: &Arc<Mutex<Status>>,
    jobs: &Mutex<Sender<Job>>,
) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header)? == 0 || header.trim().is_empty() {
            break;
        }
    }
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or("/");
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let query: HashMap<String, String> = query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .map(|(k, v)| (decode(k), decode(v)))
        .collect();
    if method == "OPTIONS" {
        return respond(
            &mut stream,
            "204 No Content",
            "text/plain",
            "Access-Control-Allow-Methods: GET\r\n",
            b"",
        );
    }
    match path {
        "/status" => {
            let s = status.lock().unwrap().clone();
            let body = format!(
                r#"{{"state":"{}","message":"{}","generated":{},"extent":40000,"resolution":1024}}"#,
                s.state,
                json_escape(&s.message),
                s.generated
            );
            respond(
                &mut stream,
                "200 OK",
                "application/json",
                "",
                body.as_bytes(),
            )
        }
        "/generate" => {
            let (reply, result) = channel();
            jobs.lock().unwrap().send((query, reply)).ok();
            match result
                .recv()
                .unwrap_or_else(|_| Err("Service GPU arrêté.".into()))
            {
                Ok((heights, meta)) => {
                    let bytes: Vec<u8> = heights.iter().flat_map(|h| h.to_le_bytes()).collect();
                    let header = format!("X-Neural-Meta: {meta}\r\n");
                    respond(
                        &mut stream,
                        "200 OK",
                        "application/octet-stream",
                        &header,
                        &bytes,
                    )
                }
                Err(error) => respond(
                    &mut stream,
                    "500 Internal Server Error",
                    "text/plain; charset=utf-8",
                    "",
                    error.as_bytes(),
                ),
            }
        }
        _ => respond(&mut stream, "404 Not Found", "text/plain", "", b"Not found"),
    }
}

/// Serves until the process stops. `load` builds the networks on the GPU thread.
pub fn serve(
    address: &str,
    load: impl FnOnce() -> Result<(Networks, String), String> + Send + 'static,
    warmup: bool,
) -> Result<(), String> {
    let listener = TcpListener::bind(address).map_err(|e| format!("{address} : {e}"))?;
    let status = Arc::new(Mutex::new(Status {
        state: "loading",
        message: "Chargement des poids…".into(),
        generated: 0,
    }));
    let (jobs, queue) = channel::<Job>();
    let gpu_status = status.clone();
    std::thread::spawn(move || {
        let set = |state: &'static str, message: String| {
            println!("[neural] {message}");
            let mut s = gpu_status.lock().unwrap();
            s.state = state;
            s.message = message;
        };
        let clock = Wall(Instant::now());
        let networks = match load() {
            Ok((networks, message)) => {
                set(
                    "warming",
                    format!("{message} · préchauffage des noyaux GPU (une fois par lancement)…"),
                );
                networks
            }
            Err(error) => {
                set("error", error.clone());
                for (_, reply) in queue {
                    reply.send(Err(error.clone())).ok();
                }
                return;
            }
        };
        if warmup {
            let started = clock.now_ms();
            let query = HashMap::from([
                ("relief".to_owned(), "mixed".to_owned()),
                ("seed".to_owned(), "0".to_owned()),
            ]);
            match generate(&networks, &query, &clock) {
                Ok(_) => set(
                    "ready",
                    format!(
                        "Prêt · préchauffage {:.0} s",
                        (clock.now_ms() - started) / 1000.0
                    ),
                ),
                Err(error) => set("error", error),
            }
        } else {
            set("ready", "Prêt".into());
        }
        for (query, reply) in queue {
            let result = generate(&networks, &query, &clock);
            match &result {
                Ok((_, meta)) => {
                    println!("[neural] {meta}");
                    gpu_status.lock().unwrap().generated += 1;
                }
                Err(error) => println!("[neural] erreur : {error}"),
            }
            reply.send(result).ok();
        }
    });
    println!("[neural] service sur http://{address}");
    let jobs = Arc::new(Mutex::new(jobs));
    for stream in listener.incoming().flatten() {
        let (status, jobs) = (status.clone(), jobs.clone());
        std::thread::spawn(move || {
            if let Err(error) = handle(stream, &status, &jobs) {
                eprintln!("[neural] connexion : {error}");
            }
        });
    }
    Ok(())
}
