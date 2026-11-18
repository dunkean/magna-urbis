/**
 * Silhouette storeys, roof choices and massing rules, called by silhouette conversion and facade details.
 * Reads/writes: Reads programme, role, wealth and footprint area; returns derived massing values and writes no shared state.
 */
import type { PlacedBuilding } from '../../../../rust/bridge/urbanArchitecture';
import type { MaterialPattern } from '../../../../rust/bridge/housesContract';
import { roleFamily } from '../cityCanvas';

/** City programme carried by silhouettes (urbanSilhouettes.ts), read defensively. */
export interface Programme {
  role?: string;
  district_role?: string;
  wealth?: number;
  landmark?: boolean;
  households?: number;
}

export const CITY3D_LEVEL_M = 3;

// ---------------------------------------------------------------- massing rules
interface Massing {
  floors: number;
  wall: MaterialPattern;
  roof: MaterialPattern;
  pitchDeg: number;
  hip: boolean;
  flat?: boolean;
}

const FAMILY_MASSING: Record<string, Massing> = {
  dwelling: { floors: 2, wall: 'plain', roof: 'tile', pitchDeg: 40, hip: false },
  commerce: { floors: 2, wall: 'plain', roof: 'tile', pitchDeg: 35, hip: false },
  craft: { floors: 2, wall: 'wood', roof: 'tile', pitchDeg: 35, hip: false },
  worship: { floors: 4, wall: 'stone', roof: 'stone', pitchDeg: 48, hip: false },
  civic: { floors: 3, wall: 'stone', roof: 'tile', pitchDeg: 35, hip: true },
  defence: { floors: 5, wall: 'stone', roof: 'stone', pitchDeg: 0, hip: false, flat: true },
  garden: { floors: 1, wall: 'wood', roof: 'thatch', pitchDeg: 30, hip: false },
};

export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Floors, materials and roof of a silhouette from its role family, role and wealth. */
export function silhouetteMassing(building: PlacedBuilding, area: number): Massing & { family: string } {
  const programme = (building as PlacedBuilding & { programme?: Programme }).programme,
    role = programme?.role ?? '';
  const family = roleFamily(role, building.function),
    base = FAMILY_MASSING[family] ?? FAMILY_MASSING.dwelling;
  const m = { ...base, family };
  if (family === 'dwelling') {
    if (/tenement/.test(role)) m.floors = 4;
    else if (/mansion|townhouse|palace/.test(role)) m.floors = 3;
    else if (/farm|platform|compound/.test(role)) m.floors = 1;
    if ((hash(building.id) & 3) === 0) m.floors += 1;
    const wealth = programme?.wealth;
    if (wealth !== undefined && wealth < 0.3) {
      m.floors = Math.max(1, m.floors - 1);
      m.roof = 'thatch';
      m.wall = 'earth';
    } else if (wealth !== undefined && wealth > 0.75) m.floors += 1;
  }
  if (/storage|granary|barn|warehouse/.test(role) || building.function === 'warehouse') {
    m.floors = Math.max(1, m.floors - 1);
    m.wall = 'wood';
  }
  if (programme?.landmark) m.floors = Math.round(m.floors * 1.5);
  if (area < 30) m.floors = Math.min(m.floors, 1);
  return m;
}
