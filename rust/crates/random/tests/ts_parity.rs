use magna_urbis_random::Rng;
use serde::Deserialize;

#[derive(Deserialize)]
struct Vector {
    seed: String,
    label: Option<String>,
    values: Vec<u32>,
}

#[test]
fn reference_typescript_streams_and_forks() {
    let vectors: Vec<Vector> =
        serde_json::from_str(include_str!("../../../fixtures/houses/rng-ts-vectors.json")).unwrap();
    for vector in vectors {
        let root = Rng::new(&vector.seed);
        let mut rng = vector
            .label
            .map_or(root, |label| Rng::new(&vector.seed).fork(&label));
        for expected in vector.values {
            assert_eq!(rng.next_u32(), expected);
        }
    }
}
