/** Shared coast defaults, normalized by terrainSettings and the CPU/GPU/native bridges before passing profiles to Rust. */
export interface CoastProfile {
  smoothing: number;
  width: number;
  relief: number;
  detail: number;
  cliffs: number;
}
export const DEFAULT_COAST_PROFILE: CoastProfile = { smoothing: 1, width: 1200, relief: 1, detail: 1, cliffs: 0.35 };
export function coastProfile(settings: { coastProfile?: Partial<CoastProfile> }): CoastProfile {
  return { ...DEFAULT_COAST_PROFILE, ...settings.coastProfile };
}
