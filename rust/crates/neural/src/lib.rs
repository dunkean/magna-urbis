//! Neural relief for Magna Urbis: Terrain Diffusion's coarse → base → decoder
//! chain in pure Rust (Burn), restricted to the windows of one square map.
//!
//! Native builds run on Vulkan/Metal/DX12 through wgpu; browser builds use WebGPU.
//! Convolutions run in FP16 (production used BF16), statistics in FP32.
pub use burn;
#[cfg(not(target_arch = "wasm32"))]
pub mod cli;
pub mod edm;
#[cfg(not(target_arch = "wasm32"))]
pub mod export;
pub mod gpu;
pub mod noise;
pub mod pipeline;
pub mod plan;
pub mod reconstruct;
#[cfg(not(target_arch = "wasm32"))]
pub mod server;
pub mod sketch;
pub mod student;
pub mod weights;
mod zone_profile;
#[cfg(not(target_arch = "wasm32"))]
mod zones;

pub use pipeline::{Clock, Networks, Output, Request, Timings};
pub use sketch::{Climate, Family, Regional, Sketch, Validation};

/// World seed of a user seed string: integers are used as is (matching the
/// Python reference), other strings are hashed with FNV-1a.
pub fn world_seed(seed: &str) -> u64 {
    if let Ok(value) = seed.trim().parse::<u64>() {
        return value;
    }
    seed.bytes().fold(0xcbf2_9ce4_8422_2325u64, |h, b| {
        (h ^ b as u64).wrapping_mul(0x100_0000_01b3)
    })
}
