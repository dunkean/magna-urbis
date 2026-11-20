/**
 * Shared roof mesh and height-sampler contracts. Called by the City 3D scene adapter and sibling mesh builders.
 * Reads/writes: Types only; no runtime state.
 */
import type { ArchitectureVolume } from '../../../../rust/bridge/urbanArchitecture';

type VolumeRoofMesh = ArchitectureVolume['roof_mesh'];

export type RoofMeshFace = VolumeRoofMesh['faces'][number] & { hiddenEdge?: number };
export type RoofMesh = VolumeRoofMesh & { faces: RoofMeshFace[] };

/** Ground sampler in metres (physical, before display exaggeration). */
export type City3dHeight = (x: number, y: number) => number;
