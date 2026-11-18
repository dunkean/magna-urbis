/**
 * Architecture-volume record assembly. Called by the City 3D scene adapter and sibling mesh builders.
 * Reads/writes: Reads geometry/material inputs; returns a new display-volume record.
 */
import type { ArchitectureVolume } from '../../../../rust/bridge/urbanArchitecture';
import type { MaterialSlots, Surface } from '../../../../rust/bridge/housesContract';
import { RoofMesh } from './types';

// ---------------------------------------------------------------- buildings
export function baseVolume(id: string, footprint: Surface, z: number, wall: number, rise: number, materials: MaterialSlots, roof: RoofMesh, roofSystem: string, foundation: ArchitectureVolume['foundation'], levels?: ArchitectureVolume['levels']): ArchitectureVolume {
  return {
    id,
    footprint,
    levels: levels ?? [{ index: 0, footprint, z_m: z, height_m: wall }],
    z_m: z,
    wall_height_m: wall,
    roof_height_m: rise,
    roof_system: roofSystem,
    roof_pitch_deg: 0,
    overhang_m: 0,
    roof_spec: {} as ArchitectureVolume['roof_spec'],
    materials,
    role: 'main',
    envelope: 'walled',
    roof_mesh: roof,
    foundation,
  };
}
