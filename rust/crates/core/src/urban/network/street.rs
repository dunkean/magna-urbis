//! Street role predicates and per-vertex ribbon widths.

use crate::urban::Street;

/// Ways whose ends are structures (decks, quays, stairs, wall lanes), never trimmed as loose ends.
pub(super) const CROSSINGS: [&str; 12] = ["bridge", "ford", "causeway", "quay", "pier", "mole", "landing", "boardwalk", "walkway", "stairs", "port-stairs", "wall-lane"];

/// A retained connection without built frontage is a field/access path.
pub(in crate::urban) fn downgrade_path(s: &mut Street) {
    s.role = "track".into();
    s.rank = 4;
    s.widths = (0..s.path.len()).map(|i| s.widths.get(i).or(s.widths.last()).copied().unwrap_or(2.0).min(2.0)).collect();
}

pub(in crate::urban) fn protected(s: &Street) -> bool {
    matches!(
        s.role.as_str(),
        "regional" | "bridge" | "ford" | "causeway" | "approach" | "peripheral" | "outbound"
    )
}

pub(in crate::urban) fn private(s: &Street) -> bool {
    matches!(
        s.role.as_str(),
        "close" | "derb" | "hutong" | "roji" | "collective" | "private"
    )
}

pub(in crate::urban) fn width(s: &Street, i: usize) -> f64 {
    s.widths
        .get(i)
        .copied()
        .or_else(|| s.widths.last().copied())
        .unwrap_or(4.0)
}
