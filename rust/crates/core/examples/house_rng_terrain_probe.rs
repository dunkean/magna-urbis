//! Terrain fingerprint before/after extracting the shared random stream.
use magna_urbis_core::TerrainGenerator;

fn main() {
    for relief in ["flat", "hills"] {
        let terrain = TerrainGenerator::new("étoile 🏠", 2400.0, relief, 0.0, 2400.0)
            .unwrap()
            .sample_region(0.0, 0.0, 2400.0, 64)
            .unwrap();
        let mut hash = 0xcbf29ce484222325_u64;
        for value in terrain
            .height
            .iter()
            .chain(&terrain.normal_x)
            .chain(&terrain.normal_y)
            .chain(&terrain.normal_z)
        {
            for byte in value.to_bits().to_le_bytes() {
                hash = (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3);
            }
        }
        println!("{relief}: {hash:016x}");
    }
}
