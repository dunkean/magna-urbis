//! Painted operation masks, never elevations. Channels: sea, plain, hills,
//! mountains, high mountains; the remaining weight keeps the selected generator.
use serde::{Deserialize, Serialize};

pub const ZONE_CHANNELS: usize = 5;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TerrainZones {
    pub version: u8,
    pub resolution: usize,
    pub weights: Vec<u8>,
}

impl TerrainZones {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1
            || !(8..=128).contains(&self.resolution)
            || self.weights.len() != self.resolution * self.resolution * ZONE_CHANNELS
            || self
                .weights
                .as_chunks::<ZONE_CHANNELS>()
                .0
                .iter()
                .any(|w| w.iter().map(|&v| v as u32).sum::<u32>() > 255)
        {
            return Err("Zones invalides : cinq masques 8–128², poids cumulés ≤ 255.".into());
        }
        Ok(())
    }

    /// Normalized partition, including the untouched generator at index zero.
    pub fn sample(&self, u: f64, v: f64) -> [f64; 6] {
        let n = self.resolution;
        let x = (u * n as f64 - 0.5).clamp(0.0, (n - 1) as f64);
        let y = (v * n as f64 - 0.5).clamp(0.0, (n - 1) as f64);
        let (x0, y0) = (x.floor() as usize, y.floor() as usize);
        let (tx, ty) = (x - x0 as f64, y - y0 as f64);
        let mut out = [0.0; 6];
        for (xx, wx) in [(x0, 1.0 - tx), ((x0 + 1).min(n - 1), tx)] {
            for (yy, wy) in [(y0, 1.0 - ty), ((y0 + 1).min(n - 1), ty)] {
                let start = (yy * n + xx) * ZONE_CHANNELS;
                for k in 0..ZONE_CHANNELS {
                    out[k + 1] += wx * wy * self.weights[start + k] as f64 / 255.0;
                }
            }
        }
        out[0] = (1.0 - out[1..].iter().sum::<f64>()).max(0.0);
        out
    }

    pub(crate) fn strongest(&self, fallback: crate::Relief) -> crate::Relief {
        use crate::Relief;
        let profiles = [
            Relief::Flat,
            Relief::Flat,
            Relief::Hills,
            Relief::Mountains,
            Relief::HighMountains,
        ];
        let mut strongest = Relief::Flat;
        for cell in self.weights.as_chunks::<ZONE_CHANNELS>().0.iter() {
            if cell.iter().map(|&v| v as u32).sum::<u32>() < 255
                && fallback.amplitude(2400.0) > strongest.amplitude(2400.0)
            {
                strongest = fallback;
            }
            for (k, &weight) in cell.iter().enumerate() {
                if weight > 0 && profiles[k].amplitude(2400.0) > strongest.amplitude(2400.0) {
                    strongest = profiles[k];
                }
            }
        }
        strongest
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn erased_operations_restore_the_seeded_generator() {
        let zones = TerrainZones {
            version: 1,
            resolution: 8,
            weights: vec![0; 8 * 8 * 5],
        };
        let ordinary =
            crate::TerrainGenerator::new("zones-regression", 2400.0, "flat", 0.7, 3000.0).unwrap();
        let edited = crate::TerrainGenerator::with_zones(
            "zones-regression",
            2400.0,
            "flat",
            0.7,
            3000.0,
            0.5,
            None,
            &zones,
        )
        .unwrap();
        assert_eq!(
            ordinary.sample_region(0.0, 0.0, 2400.0, 64).unwrap().height,
            edited.sample_region(0.0, 0.0, 2400.0, 64).unwrap().height
        );
    }

    #[test]
    fn mountain_operations_generate_seeded_relief_inside_their_mask() {
        let mut zones = TerrainZones {
            version: 1,
            resolution: 16,
            weights: vec![0; 16 * 16 * 5],
        };
        for y in 0..16 {
            for x in 0..16 {
                zones.weights[(y * 16 + x) * 5 + if x < 8 { 1 } else { 3 }] = 255;
            }
        }
        let generate = |seed| {
            crate::generate_motif_base_with_noise(
                seed,
                12000.0,
                "flat",
                0.7,
                64,
                4000.0,
                0.5,
                None,
                Some(&zones),
            )
            .unwrap()
            .height
        };
        let first = generate("zones-regression");
        let mut plain = Vec::new();
        let mut mountains = Vec::new();
        for y in 8..56 {
            for x in 4..28 {
                plain.push(first[y * 64 + x]);
                mountains.push(first[y * 64 + x + 32]);
            }
        }
        let range = |v: &[f32]| {
            v.iter().copied().fold(f32::NEG_INFINITY, f32::max)
                - v.iter().copied().fold(f32::INFINITY, f32::min)
        };
        assert!(range(&mountains) > range(&plain) * 5.0);
        assert_eq!(first, generate("zones-regression"));
        assert_ne!(first, generate("zones-other-seed"));
        let mut tiny = TerrainZones {
            version: 1,
            resolution: 16,
            weights: vec![0; 16 * 16 * 5],
        };
        tiny.weights[(8 * 16 + 8) * 5 + 4] = 255;
        let height = crate::generate_motif_base_with_noise(
            "tiny-massif",
            12000.0,
            "flat",
            0.7,
            64,
            4000.0,
            0.5,
            None,
            Some(&tiny),
        )
        .unwrap()
        .height;
        assert!(
            height.iter().all(|h| h.is_finite() && *h < 10000.0),
            "A small mask must not normalize against the plain's percentile."
        );
    }

    #[test]
    fn marine_operation_cuts_neural_land_without_sculpting_other_zones() {
        let mut zones = TerrainZones {
            version: 1,
            resolution: 8,
            weights: vec![0; 8 * 8 * 5],
        };
        for y in 0..8 {
            for x in 4..8 {
                zones.weights[(y * 8 + x) * 5] = 255;
            }
        }
        let field = vec![1000.0; 1024 * 1024];
        let terrain = crate::TerrainGenerator::with_zoned_surface(
            "sea-operation",
            40000.0,
            6000.0,
            &field,
            &zones,
        )
        .unwrap()
        .sample_region(0.0, 0.0, 40000.0, 64)
        .unwrap();
        assert_eq!(terrain.height[32 * 64 + 8], 1000.0);
        assert!(terrain.height[32 * 64 + 56] < 0.0);
        let mut procedural = crate::TerrainGenerator::with_zones(
            "sea-operation",
            2400.0,
            "flat",
            0.0,
            3000.0,
            0.5,
            None,
            &zones,
        )
        .unwrap();
        // An automatic west coast must not erase the separately painted east sea.
        procedural.set_coast(1 << 6, "island").unwrap();
        let retained = procedural.sample_region(0.0, 0.0, 2400.0, 64).unwrap();
        assert!(retained.height[32 * 64 + 56] < 0.0);
    }
}
