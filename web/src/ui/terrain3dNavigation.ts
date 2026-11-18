/** Navigation in rendered world metres, independent of terrain/map dimensions. */
export const WALK_EYE_HEIGHT = 1.7;
export const WALK_SPEED = 12;
export const FLIGHT_SPEED = 60;

/** First-person visibility follows the landscape, rather than the orbit's 20 m navigation anchor. */
export function navigationFogDistance(navigation: 'orbit' | 'walk' | 'fly' | undefined, distance: number, width: number): number {
  return navigation === 'walk' || navigation === 'fly' ? Math.max(5000, width * 2) : Math.max(distance * 2, 100);
}

export function groundNavigationScale(distance: number, clearance: number): number {
  // Altitude matters at grazing angles, where the orbit target can be far away.
  const localDistance = Math.min(distance, Math.max(1, clearance) * 2);
  return Math.max(0.12, Math.min(1, Math.sqrt(localDistance / 120)));
}

export function walkDisplacement(yaw: number, forward: number, right: number, seconds: number, fast: boolean): [number, number] {
  const length = Math.max(1, Math.hypot(forward, right));
  const step = (WALK_SPEED * (fast ? 3 : 1) * seconds) / length;
  return [(right * Math.cos(yaw) - forward * Math.sin(yaw)) * step, (-right * Math.sin(yaw) - forward * Math.cos(yaw)) * step];
}

/** Forward follows the view pitch; vertical input changes absolute altitude, without following the ground. */
export function flightDisplacement(yaw: number, pitch: number, forward: number, right: number, up: number, seconds: number, fast: boolean): [number, number, number] {
  const dx = right * Math.cos(yaw) - forward * Math.sin(yaw) * Math.cos(pitch);
  const dy = -right * Math.sin(yaw) - forward * Math.cos(yaw) * Math.cos(pitch),
    dz = up - forward * Math.sin(pitch);
  const step = (FLIGHT_SPEED * (fast ? 4 : 1) * seconds) / Math.max(1, Math.hypot(dx, dy, dz));
  return [dx * step, dy * step, dz * step];
}
