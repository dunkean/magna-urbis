/** OSM classifications shared by the Overpass selectors and the map converter. */
export const HIGHWAY: Record<string, { region?: string; kind?: string; rank?: number; role?: string; width: number }> = {
  motorway: { region: 'major', width: 10 },
  trunk: { region: 'major', width: 9 },
  primary: { region: 'major', width: 8 },
  secondary: { region: 'major', width: 7 },
  tertiary: { region: 'minor', width: 6 },
  motorway_link: { region: 'major', width: 6 },
  trunk_link: { region: 'major', width: 6 },
  primary_link: { region: 'major', width: 6 },
  secondary_link: { region: 'major', width: 6 },
  tertiary_link: { region: 'minor', width: 5 },
  track: { region: 'track', width: 3 },
  unclassified: { kind: 'street', rank: 2, role: 'street', width: 4.5 },
  residential: { kind: 'street', rank: 2, role: 'street', width: 5 },
  living_street: { kind: 'street', rank: 3, role: 'lane', width: 4 },
  pedestrian: { kind: 'street', rank: 2, role: 'street', width: 5 },
  service: { kind: 'alley', rank: 3, role: 'lane', width: 3.5 },
  footway: { kind: 'alley', rank: 4, role: 'lane', width: 2 },
  path: { kind: 'alley', rank: 4, role: 'lane', width: 1.6 },
  steps: { kind: 'alley', rank: 4, role: 'lane', width: 2 },
  cycleway: { kind: 'alley', rank: 4, role: 'lane', width: 2 },
  bridleway: { region: 'track', width: 2 },
};

export const LANDUSE: Record<string, string> = { farmland: 'field', vineyard: 'orchard', orchard: 'orchard', meadow: 'meadow', grass: 'meadow', forest: 'forest', allotments: 'garden', village_green: 'commons', recreation_ground: 'commons', farmyard: 'pasture' };
export const NATURAL: Record<string, string> = { wood: 'forest', scrub: 'commons', grassland: 'meadow', heath: 'commons', wetland: 'marsh' };
export const URBAN_LANDUSE = new Set(['residential', 'commercial', 'retail', 'industrial', 'religious', 'civic', 'education', 'military']);
export const RIVER_WIDTH: Record<string, number> = { river: 35, canal: 10, stream: 3, ditch: 1.5, drain: 1.5 };
