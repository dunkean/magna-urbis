//! Native neural relief tool; see `magna_urbis_neural::cli`.
fn main() {
    #[cfg(not(target_arch = "wasm32"))]
    magna_urbis_neural::cli::main();
}
