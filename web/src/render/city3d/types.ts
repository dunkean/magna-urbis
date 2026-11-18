/**
 * Shared roof mesh and height-sampler contracts. Called by the City 3D scene adapter and sibling mesh builders.
 * Reads/writes: Types only; no runtime state.
 */
import type { ArchitectureVolume } from '../../../../rust/bridge/urbanArchitecture';

export type RoofMesh = ArchitectureVolume['roof_mesh'];

export type RoofMeshFace = RoofMesh['faces'][number];

/** Ground sampler in metres (physical, before display exaggeration). */
export type City3dHeight = (x: number, y: number) => number;
