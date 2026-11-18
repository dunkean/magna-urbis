/**
 * Compact native plans with lofted display roofs. Called by the City 3D scene adapter and sibling mesh builders.
 * Reads/writes: Reads native volumes/cartographic ridges; returns display roofs while preserving complete native volumes.
 */
import type { PlacedBuilding } from '../../../../rust/bridge/urbanArchitecture';
import { RoofBuilder, inRing, flatRoof, ridgeRoof, insetRoof } from './roofGeometry';

const FLAT_SYSTEMS = /FLAT|TERRACE|SLAB|PARAPET/;

/** Compact plan: native volumes and levels kept, roofs lofted to the plan's
 * cartographic ridges (or a pitched border / flat crown when it has none). */
export function compactBuilding(building: PlacedBuilding): PlacedBuilding {
  const ridges = building.cartographic?.ridges ?? [];
  const volumes = building.volumes.map(volume => {
    if (volume.roof_mesh?.faces.length) return volume;
    const roof = new RoofBuilder(),
      eave = volume.z_m + volume.wall_height_m,
      rise = Math.max(0, volume.roof_height_m),
      material = volume.materials.cladding;
    const own = ridges.filter(([a, b]) => volume.footprint.some(shape => inRing(shape.outer, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })));
    if (rise < 0.2 || FLAT_SYSTEMS.test(volume.roof_system)) flatRoof(roof, volume.footprint, eave + rise, material);
    else if (own.length) for (const shape of volume.footprint) ridgeRoof(roof, shape.outer, own, eave, eave + rise, material);
    else insetRoof(roof, volume.footprint, eave, rise, material);
    return { ...volume, roof_mesh: roof.mesh() };
  });
  return { ...building, volumes };
}
