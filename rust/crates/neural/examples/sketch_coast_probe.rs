//! Land/sea of the regional neural sketch for a few seeds (quick look, no inference).
//! usage: sketch_coast_probe <out.pgm> — rows: west, north+east, island, peninsula.
use magna_urbis_neural::{Climate, Family, Regional};

fn main() {
    let out = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "sketch_coast_probe.pgm".into());
    let layouts = [
        (64u8, "island"),
        (1 | 4, "island"),
        (255, "island"),
        (255, "peninsula"),
    ];
    let (n, gap, seeds) = (128usize, 4usize, [1u64, 2, 3, 42, 7, 99]);
    let (w, h) = (seeds.len() * (n + gap), layouts.len() * (n + gap));
    let mut image = vec![255u8; w * h];
    for (row, &(mask, mode)) in layouts.iter().enumerate() {
        for (col, &seed) in seeds.iter().enumerate() {
            let sketch = Regional::new(
                seed,
                Family::Hills,
                0.5,
                mask,
                mode,
                Climate::REFERENCE,
                40000.0,
            )
            .unwrap();
            for y in 0..n {
                for x in 0..n {
                    let v = sketch.elevation(
                        (x as f64 + 0.5) * 40000.0 / n as f64,
                        (y as f64 + 0.5) * 40000.0 / n as f64,
                    );
                    image[(row * (n + gap) + y) * w + col * (n + gap) + x] = if v <= 0.0 {
                        60
                    } else {
                        (140.0 + v.min(600.0) / 6.0) as u8
                    };
                }
            }
        }
    }
    let mut bytes = format!("P5\n{w} {h}\n255\n").into_bytes();
    bytes.extend(image);
    std::fs::write(out, bytes).unwrap();
}
