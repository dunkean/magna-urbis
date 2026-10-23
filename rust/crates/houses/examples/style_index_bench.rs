//! Run: cargo run -p magna-urbis-houses --example style_index_bench
//! Measures selection only; it does not measure architectural synthesis/rendering.
use magna_urbis_houses::placement::ArchitectureTypology;
use magna_urbis_houses::style_index::{StyleQuery, style_index};
use std::hint::black_box;
use std::time::Instant;

fn main() {
    let start = Instant::now();
    let index = style_index().expect("source style index");
    println!(
        "index_entries={} index_init_ms={:.3}",
        index.entries.len(),
        start.elapsed().as_secs_f64() * 1000.0
    );
    let queries: Vec<_> = ["EUR-MED", "AF-EAST", "MED-ANT", "AS-CHI"]
        .into_iter()
        .map(|pack| StyleQuery {
            pack_id: Some(pack.into()),
            typology: Some(ArchitectureTypology::Common),
            ..StyleQuery::default()
        })
        .collect();
    assert!(queries.iter().all(|query| !index.find(query).is_empty()));
    println!(
        "packs=EUR-MED,AF-EAST,MED-ANT,AS-CHI query=automatic_residential include_variants=true"
    );
    for count in [1_000, 10_000, 100_000] {
        let start = Instant::now();
        let mut attempts = 0_usize;
        let mut checksum = 0_u64;
        for position in 0..count {
            let query = &queries[position % queries.len()];
            let seed = format!("style-bench-{position}");
            let candidates = index.candidate_styles(black_box(query), black_box(&seed), 4);
            attempts += candidates.len();
            for candidate in candidates {
                for byte in candidate.id.bytes() {
                    checksum = checksum.wrapping_mul(31).wrapping_add(u64::from(byte));
                }
            }
        }
        let elapsed = start.elapsed().as_secs_f64();
        println!(
            "queries={count} max_attempts=4 actual_attempts={attempts} elapsed_ms={:.3} us_per_query={:.3} checksum={}",
            elapsed * 1000.0,
            elapsed * 1_000_000.0 / count as f64,
            black_box(checksum)
        );
    }
}
