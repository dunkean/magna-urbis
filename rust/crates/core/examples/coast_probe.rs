//! Land/sea silhouettes of the coast plan for a few seeds and layouts (quick look).
//! usage: coast_probe <out.pgm> [relief] — rows: west, north+east, island, archipelago, peninsula.
use magna_urbis_core::TerrainGenerator;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let out = args.get(1).map(String::as_str).unwrap_or("coast_probe.pgm");
    let relief = args.get(2).map(String::as_str).unwrap_or("flat");
    let layouts = [
        (64, "island"),
        (1 | 4, "island"),
        (255, "island"),
        (255, "archipelago"),
        (255, "peninsula"),
    ];
    let seeds = ["1", "2", "3", "42", "brume", "sel", "ocre"];
    let (n, gap) = (160usize, 4usize);
    let (w, h) = (seeds.len() * (n + gap), layouts.len() * (n + gap));
    let mut image = vec![255u8; w * h];
    for (row, &(mask, mode)) in layouts.iter().enumerate() {
        for (col, seed) in seeds.iter().enumerate() {
            let width = 10000.0;
            let mut terrain = TerrainGenerator::new(seed, width, relief, 1.0, 3000.0).unwrap();
            terrain.configure_coast(mask, mode).unwrap();
            let t = terrain.sample_region(0.0, 0.0, width, n).unwrap();
            for y in 0..n {
                for x in 0..n {
                    let v = t.height[y * n + x];
                    image[(row * (n + gap) + y) * w + col * (n + gap) + x] = if v <= 0.0 {
                        60
                    } else {
                        (150.0 + v.min(400.0) / 4.0) as u8
                    };
                }
            }
        }
    }
    let mut bytes = format!("P5\n{w} {h}\n255\n").into_bytes();
    bytes.extend(image);
    std::fs::write(out, bytes).unwrap();
}
