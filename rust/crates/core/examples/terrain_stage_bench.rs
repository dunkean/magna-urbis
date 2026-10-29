//! Per-stage timing of the retained procedural TerrainPipeline with the bench defaults
//! (seed 42, width 2400, motif 10000, erosion 1, classic recipe {biome:true}, temperate).
//! usage: terrain_stage_bench [relief] [reps] [dump.f32|-] [regionalN|0] [surfaceN|0]
//! `dump` receives the final 1024² f32 field (little endian) of the last run.
//! compare: terrain_stage_bench --compare a.f32 b.f32
//! `RAYON_NUM_THREADS` sets the kernel threads; with 1, `BENCH_CPU=1` times
//! with the thread's CPU clock (Windows, 15.6 ms ticks) instead of wall time.
use magna_urbis_core::{GenerationNoisePlan, TerrainPipeline};
use std::time::Instant;

/// CPU time of the calling thread (Windows), else wall time: serial timings
/// that ignore descheduling on a busy machine (`BENCH_CPU=1`).
#[cfg(windows)]
fn thread_seconds() -> f64 {
    #[repr(C)]
    struct FileTime(u32, u32);
    unsafe extern "system" {
        fn GetCurrentThread() -> isize;
        fn GetThreadTimes(
            t: isize,
            c: *mut FileTime,
            e: *mut FileTime,
            k: *mut FileTime,
            u: *mut FileTime,
        ) -> i32;
    }
    let mut v = [
        FileTime(0, 0),
        FileTime(0, 0),
        FileTime(0, 0),
        FileTime(0, 0),
    ];
    let [a, b, k, u] = &mut v;
    unsafe { GetThreadTimes(GetCurrentThread(), a, b, k, u) };
    let t = |f: &FileTime| ((f.1 as u64) << 32 | f.0 as u64) as f64 * 1e-7;
    t(k) + t(u)
}
#[cfg(not(windows))]
fn thread_seconds() -> f64 {
    0.0
}

struct Clock(bool, Instant, f64);
impl Clock {
    fn start(cpu: bool) -> Self {
        Self(
            cpu,
            Instant::now(),
            if cpu { thread_seconds() } else { 0.0 },
        )
    }
    fn ms(&self) -> f64 {
        if self.0 {
            (thread_seconds() - self.2) * 1e3
        } else {
            self.1.elapsed().as_secs_f64() * 1e3
        }
    }
}

fn read(path: &str) -> Vec<f32> {
    std::fs::read(path)
        .unwrap()
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect()
}

fn compare(a: &str, b: &str) {
    let (x, y) = (read(a), read(b));
    assert_eq!(x.len(), y.len());
    let (lo, hi) = x
        .iter()
        .fold((f32::MAX, f32::MIN), |(l, h), &v| (l.min(v), h.max(v)));
    let (mut max, mut sum, mut changed) = (0.0_f64, 0.0_f64, 0usize);
    for (&p, &q) in x.iter().zip(&y) {
        let d = (p as f64 - q as f64).abs();
        if p.to_bits() != q.to_bits() {
            changed += 1;
        }
        max = max.max(d);
        sum += d;
    }
    println!(
        "relief {:.2}..{:.2} m | changed {}/{} ({:.4}%) | max |dh| {:.6} | mean |dh| {:.3e}{}",
        lo,
        hi,
        changed,
        x.len(),
        100. * changed as f64 / x.len() as f64,
        max,
        sum / x.len() as f64,
        if changed == 0 { " | BIT-IDENTICAL" } else { "" }
    );
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    if a.get(1).map(String::as_str) == Some("--compare") {
        return compare(&a[2], &a[3]);
    }
    let relief = a.get(1).map(String::as_str).unwrap_or("mountains");
    let reps: usize = a.get(2).and_then(|v| v.parse().ok()).unwrap_or(2);
    let dump = a.get(3).filter(|v| v.as_str() != "-");
    let rn: f32 = a.get(4).and_then(|v| v.parse().ok()).unwrap_or(0.);
    let sn: f32 = a.get(5).and_then(|v| v.parse().ok()).unwrap_or(0.);
    let (width, motif, erosion, mix) = (2400.0_f64, 10000.0_f64, 1.0_f64, 0.5_f64);
    let plan = GenerationNoisePlan::erosion("42", width, relief, erosion, motif, mix).unwrap();
    let mut p = plan.parameters.clone();
    let mut s: Vec<f32> = p[24..32].to_vec();
    // configureProceduralPlan with recipe {biome:true} (temperate: all biome factors 1)
    let (old_n, old_steps, old_cell) = (p[2], p[13], p[4]);
    p[2] = if rn > 0. { rn } else { old_n };
    p[4] = (width * 1.44 / p[2] as f64) as f32;
    p[13] = old_steps;
    p[22] *= p[4] / old_cell;
    let n = if sn > 0. { sn } else { s[0] - 24. };
    let old_sc = s[1];
    s[0] = n + 24.;
    s[1] = (width / n as f64) as f32;
    s[2] = -12. * s[1];
    s[6] *= s[1] / old_sc;
    let flags: Vec<u32> = vec![0, 1, 1, 1, 1, 1, 1, 1, 1, 0, (relief == "canyon") as u32];
    eprintln!(
        "relief={relief} regional={} surface={} iters={} surface_iters={} threads={:?}",
        p[2],
        s[0] - 24.,
        p[13],
        s[3],
        std::env::var("RAYON_NUM_THREADS").ok()
    );
    let names = [
        "init",
        "regional",
        "finish",
        "reconstruct",
        "calibrate",
        "detail",
        "surface",
        "normalize",
    ];
    let mut best = [f64::MAX; 8];
    let mut total_best = f64::MAX;
    let mut last = Vec::new();
    let cpu = std::env::var("BENCH_CPU").is_ok_and(|v| v == "1");
    for _ in 0..reps.max(1) {
        let t0 = Clock::start(cpu);
        let mut pl = TerrainPipeline::new("42", &p, &s, &flags).unwrap();
        for (k, b) in best.iter_mut().enumerate() {
            let t = Clock::start(cpu);
            pl.advance(k as u32).unwrap();
            *b = b.min(t.ms());
        }
        last = pl.height();
        total_best = total_best.min(t0.ms());
    }
    for (k, nm) in names.iter().enumerate() {
        println!("{:>12} {:8.1} ms", nm, best[k]);
    }
    println!("{:>12} {:8.1} ms", "total(best)", total_best);
    if let Some(path) = dump {
        let bytes: Vec<u8> = last.iter().flat_map(|v| v.to_le_bytes()).collect();
        std::fs::write(path, bytes).unwrap();
        eprintln!("dumped {} cells to {path}", last.len());
    }
}
