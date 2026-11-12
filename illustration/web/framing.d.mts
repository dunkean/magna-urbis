export interface GroundFrame {
  width: number; height: number; minAcross: number; maxAcross: number; minAlong: number; maxAlong: number;
  perspective: boolean; distance?: number; sin?: number; cos?: number; tan?: number; aspect?: number; angle?: number;
}
export function groundFrame(context: Record<string, unknown>): GroundFrame | undefined;
export function battlemapAvailability(context: Record<string, unknown>, pixels?: number, cellMetres?: number): {
  eligible: boolean; reason: string; warning?: string; cellMetres: number; cellPixels?: number; columns?: number; rows?: number; approximate?: boolean;
};
