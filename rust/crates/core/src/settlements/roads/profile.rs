//! Cultural road-building profiles and the development levels that set classes and surfaces.

/// Road classes, most important first. Index = class rank.
pub const CLASSES: [&str; 5] = ["highway", "main", "local", "track", "trail"];
/// Surfaces, crudest first. Index = surface rank.
pub const SURFACES: [&str; 4] = ["dirt", "gravel", "paved", "flagstone"];
const CLASS_WIDTH: [f64; 5] = [9.0, 6.5, 4.5, 3.0, 1.5];

/// How a culture lays out its roads. Grades are rise over run.
#[derive(Debug)]
pub struct Profile {
    pub id: &'static str,
    pub label: &'static str,
    /// Comfortable grade of highways and main roads; local roads ×1.2, tracks ×1.5, trails × `trail_grade`.
    pub max_grade: f64,
    pub trail_grade: f64,
    /// Pull towards the straight line between the two ends (Roman roads, sacbeob).
    pub straightness: f64,
    /// Meandering on open ground.
    pub wobble: f64,
    /// Added to the level's surface rank: a positive bias paves the highways and main roads only,
    /// a negative one holds back every class.
    pub surface_bias: i32,
    /// Extra slope aversion: roads that follow the contours.
    pub contour: f64,
    /// Shallow lakes can be crossed on causeways.
    pub causeway: bool,
    /// River crossing cost multiplier (low: confident bridge builders; high: seeks fords).
    pub bridge: f64,
    pub width: f64,
}

pub const PROFILES: [Profile; 9] = [
    Profile {
        id: "medieval",
        label: "Medieval European",
        max_grade: 0.10,
        trail_grade: 2.2,
        straightness: 0.0,
        wobble: 0.55,
        surface_bias: 0,
        contour: 0.0,
        causeway: false,
        bridge: 1.0,
        width: 1.0,
    },
    Profile {
        id: "roman",
        label: "Roman / Byzantine",
        max_grade: 0.08,
        trail_grade: 2.0,
        straightness: 0.85,
        wobble: 0.08,
        surface_bias: 1,
        contour: 0.0,
        causeway: false,
        bridge: 0.6,
        width: 1.1,
    },
    Profile {
        id: "east-asian",
        label: "East Asian post roads",
        max_grade: 0.10,
        trail_grade: 2.6,
        straightness: 0.3,
        wobble: 0.35,
        surface_bias: 0,
        contour: 0.3,
        causeway: false,
        bridge: 0.9,
        width: 1.0,
    },
    Profile {
        id: "caravan",
        label: "Caravan routes",
        max_grade: 0.10,
        trail_grade: 2.0,
        straightness: 0.3,
        wobble: 0.4,
        surface_bias: -1,
        contour: 0.0,
        causeway: false,
        bridge: 1.3,
        width: 1.2,
    },
    Profile {
        id: "andean",
        label: "Andean (stone stairs)",
        max_grade: 0.18,
        trail_grade: 2.0,
        straightness: 0.5,
        wobble: 0.25,
        surface_bias: 1,
        contour: 0.0,
        causeway: false,
        bridge: 0.8,
        width: 0.8,
    },
    Profile {
        id: "mesoamerican",
        label: "Mesoamerican causeways",
        max_grade: 0.15,
        trail_grade: 2.0,
        straightness: 0.75,
        wobble: 0.1,
        surface_bias: 1,
        contour: 0.0,
        causeway: true,
        bridge: 0.8,
        width: 1.0,
    },
    Profile {
        id: "tribal",
        label: "Tribal paths",
        max_grade: 0.16,
        trail_grade: 1.8,
        straightness: 0.0,
        wobble: 0.85,
        surface_bias: -3,
        contour: 0.0,
        causeway: false,
        bridge: 2.0,
        width: 0.6,
    },
    Profile {
        id: "elven",
        label: "Elven (contour paths)",
        max_grade: 0.06,
        trail_grade: 2.0,
        straightness: 0.0,
        wobble: 0.9,
        surface_bias: -1,
        contour: 2.0,
        causeway: false,
        bridge: 1.0,
        width: 0.8,
    },
    Profile {
        id: "dwarven",
        label: "Dwarven (paved, steep)",
        max_grade: 0.14,
        trail_grade: 1.8,
        straightness: 0.6,
        wobble: 0.15,
        surface_bias: 2,
        contour: 0.0,
        causeway: false,
        bridge: 0.5,
        width: 1.0,
    },
];

pub fn profile_by_id(id: &str) -> Option<usize> {
    PROFILES.iter().position(|p| p.id == id)
}

/// Road profile of a settlement culture (the urban culture ids of the web generator).
pub fn profile_for(culture: &str) -> usize {
    const TRIBAL: [&str; 8] = [
        "barbarian",
        "native",
        "nomad",
        "celtic",
        "norse",
        "plains",
        "iroquoian",
        "stilt",
    ];
    let id = match culture {
        "roman-core" | "roman" | "byzantine-greek" => "roman",
        "chinese" | "korean" | "japanese-jokamachi" => "east-asian",
        "medina" | "persian" | "ottoman" | "sahel" | "indian-temple" => "caravan",
        c if c.starts_with("swahili") => "caravan",
        "inca" => "andean",
        "aztec" => "mesoamerican",
        "elven" | "myconid-colony" => "elven",
        "dwarven" | "duergar-hold" | "gnomish" | "drow-enclave" => "dwarven",
        c if TRIBAL.iter().any(|p| c.starts_with(p)) => "tribal",
        _ => "medieval",
    };
    profile_by_id(id).unwrap_or(0)
}

impl Profile {
    pub fn class_grade(&self, class: usize, main_override: f64) -> f64 {
        let main = if main_override > 0.0 {
            main_override
        } else {
            self.max_grade
        };
        main * [1.0, 1.0, 1.2, 1.5, self.trail_grade][class.min(4)]
    }
}

/// Development level of the whole network.
pub struct Level {
    pub id: &'static str,
    /// Final class rank of each traffic class: a rural network has no highways, a primitive one
    /// only tracks and trails, an imperial one promotes its main roads.
    pub classes: [usize; 5],
    /// Surface rank per class.
    pub surfaces: [i32; 5],
    pub width: f64,
    /// Multiplies the network density (loops and shortcuts).
    pub density: f64,
}
pub const LEVELS: [Level; 4] = [
    Level {
        id: "primitive",
        classes: [3, 3, 3, 4, 4],
        surfaces: [0, 0, 0, 0, 0],
        width: 0.7,
        density: 0.5,
    },
    Level {
        id: "rural",
        classes: [1, 1, 2, 3, 4],
        surfaces: [1, 1, 0, 0, 0],
        width: 0.9,
        density: 0.85,
    },
    Level {
        id: "developed",
        classes: [0, 1, 2, 3, 4],
        surfaces: [2, 2, 1, 0, 0],
        width: 1.0,
        density: 1.0,
    },
    Level {
        id: "imperial",
        classes: [0, 0, 1, 2, 4],
        surfaces: [3, 2, 2, 1, 0],
        width: 1.1,
        density: 1.25,
    },
];
pub fn level_by_id(id: &str) -> Option<&'static Level> {
    LEVELS.iter().find(|l| l.id == id)
}

/// Class rank of a connection between places of this (smaller) population.
pub fn class_index(importance: u32, level: &Level) -> usize {
    let base = match importance {
        5000.. => 0,
        1000.. => 1,
        150.. => 2,
        15.. => 3,
        _ => 4,
    };
    level.classes[base]
}
/// Surface rank: forced, or the level's table shifted by the culture.
pub fn surface_index(
    class: usize,
    level: &Level,
    profile: &Profile,
    forced: Option<usize>,
) -> usize {
    if let Some(s) = forced {
        return s;
    }
    let base = level.surfaces[class];
    let bias = if profile.surface_bias < 0 || class <= 1 {
        profile.surface_bias
    } else {
        0
    };
    (base + bias).clamp(0, 3) as usize
}
pub fn width(class: usize, level: &Level, profile: &Profile) -> f64 {
    CLASS_WIDTH[class] * level.width * profile.width
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cultures_map_to_profiles_and_tables_are_consistent() {
        assert_eq!(PROFILES[profile_for("roman-core")].id, "roman");
        assert_eq!(PROFILES[profile_for("aztec")].id, "mesoamerican");
        assert_eq!(PROFILES[profile_for("barbarian-norse")].id, "tribal");
        assert_eq!(PROFILES[profile_for("swahili-stone")].id, "caravan");
        assert_eq!(PROFILES[profile_for("european-organic")].id, "medieval");
        assert_eq!(PROFILES[profile_for("unknown")].id, "medieval");
        let primitive = level_by_id("primitive").unwrap();
        assert_eq!(class_index(50_000, primitive), 3);
        let tribal = &PROFILES[profile_for("nomad-camp")];
        let imperial = level_by_id("imperial").unwrap();
        assert_eq!(SURFACES[surface_index(0, imperial, tribal, None)], "dirt");
        let roman = &PROFILES[profile_for("roman-core")];
        assert_eq!(
            SURFACES[surface_index(0, imperial, roman, None)],
            "flagstone"
        );
        assert_eq!(
            SURFACES[surface_index(4, imperial, roman, Some(2))],
            "paved"
        );
        for p in &PROFILES {
            assert!(p.class_grade(4, 0.0) > p.class_grade(0, 0.0));
        }
    }
}
