//! Adapts growth engine inputs and outputs to the core urban stages.

use super::{Layout, LayoutConfig, Site, Street, Surface};

/// Return a growth layout when the requested site can be handled by the growth engine.
pub(super) fn generate(
    _seed: &str,
    _site: &Site,
    _config: &LayoutConfig,
    _surface: Surface<'_>,
    _regional_roads: &[Street],
) -> Option<Layout> {
    None
}
