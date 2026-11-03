/** Navigation in rendered world metres, independent of terrain/map dimensions. */
export const WALK_EYE_HEIGHT = 1.7;
export const WALK_SPEED = 3;

export function groundNavigationScale(distance: number, clearance: number): number {
  // Altitude matters at grazing angles, where the orbit target can be far away.
  const localDistance = Math.min(distance, Math.max(1, clearance) * 2);
  return Math.max(.12, Math.min(1, Math.sqrt(localDistance / 120)));
}

export function walkDisplacement(yaw: number, forward: number, right: number, seconds: number, fast: boolean): [number, number] {
  const length = Math.max(1, Math.hypot(forward, right));
  const step = WALK_SPEED * (fast ? 3 : 1) * seconds / length;
  return [(right * Math.cos(yaw) - forward * Math.sin(yaw)) * step,
    (-right * Math.sin(yaw) - forward * Math.cos(yaw)) * step];
}
