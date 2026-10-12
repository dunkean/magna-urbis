//! Local HTTP service for the terrain bench (native only).
//!
//! One GPU thread keeps the networks resident; it warms the kernels up once at
//! start. `GET /status` reports its state; `GET /generate?seed=…&relief=…`
//! returns the delivered `1024²` little-endian FP32 heights (metres, row-major
//! from the north-west corner, sea at zero), with metadata in `X-Neural-Meta`.
use crate::{Clock, Networks, Request, Sketch};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
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
    let mut request = Request::regional(
        &get("seed", "42"),
        &get("relief", "hills"),
        number("mix", 0.5),
        number("coasts", 0.0) as u8,
        &get("islands", "island"),
        &get("climate", "temperate"),
        number("noise", 0.05) as f32,
    )?;
    // Optional network properties of the neural bench; absent keys keep production values.
    let bounded = |key: &str, default: f64, min: f64, max: f64| -> Result<f64, String> {
        let value = number(key, default);
        if value.is_finite() && (min..=max).contains(&value) {
            Ok(value)
        } else {
            Err(format!("{key} : {value} hors de [{min}, {max}]"))
        }
    };
    if let Sketch::Regional(sketch) = &mut request.sketch {
        sketch.land_scale = bounded("landScale", 1.0, 0.0, 5.0)?;
        let c = &mut sketch.climate;
        c.temperature = bounded("temperature", c.temperature as f64, -30.0, 40.0)? as f32;
        c.temperature_std =
            bounded("temperatureStd", c.temperature_std as f64, 0.0, 3000.0)? as f32;
        c.precipitation = bounded("precipitation", c.precipitation as f64, 0.0, 6000.0)? as f32;
        c.precipitation_cv =
            bounded("precipitationCv", c.precipitation_cv as f64, 0.0, 200.0)? as f32;
    }
    let t = &mut request.tuning;
    let climate_keys = [
        "noiseTemperature",
        "noiseTemperatureStd",
        "noisePrecipitation",
        "noisePrecipitationCv",
    ];
    for (k, key) in climate_keys.iter().enumerate() {
        t.climate_noise[k] = bounded(key, t.climate_noise[k] as f64, 0.001, 10.0)? as f32;
    }
    t.coarse_steps = bounded("steps", 4.0, 1.0, 32.0)? as usize;
    t.relief_scale = bounded("reliefScale", 1.0, 0.0, 5.0)? as f32;
    if query.contains_key("reliefFixed") {
        t.relief_fixed = Some(bounded("reliefFixed", 0.0, 0.0, 5000.0)? as f32);
    }
    if let Some(list) = query.get("histogram") {
        let values: Vec<f32> = list
            .split(',')
            .filter_map(|v| v.trim().parse().ok())
            .collect();
        if values.len() != 5 || !values.iter().all(|v| v.is_finite()) {
            return Err("histogram : cinq valeurs attendues".into());
        }
        t.histogram.copy_from_slice(&values);
    }
    t.residual_scale = bounded("detail", 1.0, 0.0, 5.0)? as f32;
    if let Some(json) = query.get("sketch") {
        let value: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
        let n = value["resolution"].as_u64().unwrap_or(0) as usize;
        let values = value["heights"]
            .as_array()
            .ok_or("Esquisse : altitudes manquantes")?;
        if value["version"].as_u64() != Some(1) || !(8..=128).contains(&n) || values.len() != n * n
        {
            return Err("Esquisse : grille 8–128² attendue".into());
        }
        let heights = values
            .iter()
            .map(|v| {
                v.as_f64()
                    .filter(|h| h.is_finite() && (-12000.0..=12000.0).contains(h))
                    .ok_or_else(|| "Esquisse : altitude invalide".to_owned())
            })
            .collect::<Result<Vec<_>, _>>()?;
        let mut extent = request.extent_m;
        let mut origin = (0.0, 0.0);
        if let Some(region) = value.get("region") {
            let coordinate = |key: &str| {
                region[key]
                    .as_f64()
                    .filter(|v| v.is_finite())
                    .ok_or_else(|| format!("Esquisse : région invalide ({key})"))
            };
            extent = coordinate("width")?;
            origin = (coordinate("x")?, coordinate("y")?);
            if !(500.0..=request.extent_m).contains(&extent)
                || origin.0 < 0.0
                || origin.1 < 0.0
                || origin.0 + extent > request.extent_m + 1e-6
                || origin.1 + extent > request.extent_m + 1e-6
            {
                return Err("Esquisse : région hors de la surface neuronale".into());
            }
        }
        request.sketch = Sketch::Grid {
            resolution: n,
            heights,
            extent,
            origin,
            context: Box::new(request.sketch),
        };
    }
    Ok(request)
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
    let c = &output.coarse;
    let edited = query.contains_key("sketch");
    let meta = format!(
        r#"{{"edited":{edited},"sketchRegion":{edited},"resolution":{},"extent":{},"min":{min},"max":{max},"land":{land},"totalMs":{:.1},"coarseMs":{:.1},"baseMs":{:.1},"decoderMs":{:.1},"reconstructionMs":{:.1},"evaluations":[{},{},{}],"coarse":{{"sketch":{:.1},"elevation":{:.1},"relief":{:.1},"reliefUsed":{:.1},"cells":{}}},"profile":"coarse{} \u00b7 base 1 passe \u00b7 decoder student200k \u00b7 FP16 Vulkan"}}"#,
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
        c.sketch_m,
        c.elevation_m,
        c.relief_m,
        c.relief_used_m,
        c.cells,
        request.tuning.coarse_steps,
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
    let mut content_length = 0usize;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header)? == 0 || header.trim().is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':')
            && name.eq_ignore_ascii_case("Content-Length")
        {
            content_length = value.trim().parse().unwrap_or(usize::MAX);
        }
    }
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or("/");
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let mut query: HashMap<String, String> = query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .map(|(k, v)| (decode(k), decode(v)))
        .collect();
    if method == "OPTIONS" {
        return respond(
            &mut stream,
            "204 No Content",
            "text/plain",
            "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\n",
            b"",
        );
    }
    if method == "POST" && path == "/generate" {
        if content_length == 0 || content_length > 1_000_000 {
            return respond(
                &mut stream,
                "400 Bad Request",
                "text/plain",
                "",
                b"Invalid sketch size",
            );
        }
        let mut body = vec![0; content_length];
        reader.read_exact(&mut body)?;
        let json = String::from_utf8(body).unwrap_or_default();
        query.insert("sketch".into(), json);
        if let Err(error) = request(&query) {
            return respond(
                &mut stream,
                "400 Bad Request",
                "text/plain; charset=utf-8",
                "",
                error.as_bytes(),
            );
        }
    } else if method != "GET" {
        return respond(
            &mut stream,
            "405 Method Not Allowed",
            "text/plain",
            "Allow: GET, POST, OPTIONS\r\n",
            b"Method not allowed",
        );
    }
    match path {
        "/sketch" => match request(&query) {
            Ok(r) => {
                let n = 64;
                let mut heights = Vec::with_capacity(n * n);
                for y in 0..n {
                    for x in 0..n {
                        heights.push(r.sketch.elevation(
                            (x as f64 + 0.5) * r.extent_m / n as f64,
                            (y as f64 + 0.5) * r.extent_m / n as f64,
                        ));
                    }
                }
                let body = serde_json::json!({ "version": 1, "resolution": n, "heights": heights })
                    .to_string();
                respond(
                    &mut stream,
                    "200 OK",
                    "application/json",
                    "",
                    body.as_bytes(),
                )
            }
            Err(e) => respond(
                &mut stream,
                "400 Bad Request",
                "text/plain; charset=utf-8",
                "",
                e.as_bytes(),
            ),
        },
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
