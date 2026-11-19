/** Shared coast defaults, normalized by terrainSettings and the CPU/GPU/native bridges before passing profiles to Rust. */
export interface CoastProfile {
  width: number;
  variability: number;
}
export const DEFAULT_COAST_PROFILE: CoastProfile = { width: 250, variability: 0.5 };
export function coastProfile(settings: { coastProfile?: Partial<CoastProfile> }): CoastProfile {
  return { width: settings.coastProfile?.width ?? DEFAULT_COAST_PROFILE.width, variability: settings.coastProfile?.variability ?? DEFAULT_COAST_PROFILE.variability };
}
