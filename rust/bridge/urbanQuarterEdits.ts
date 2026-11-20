import type { Layout } from './urban';

/** A split piece keeps its source recipe key independently of the output array position. */
export function quarterEditKey(layout: Pick<Layout, 'config'>, index: number): string {
  const part = layout.config?.quarterEdits?.parts.find(p => p.quarter === index);
  return part ? `${part.source}${part.part ? `/${part.part}` : ''}` : String(index);
}
export function quarterEditSource(layout: Pick<Layout, 'config'>, index: number): { sourceId: string; part: number; deleted: boolean } {
  const part = layout.config?.quarterEdits?.parts.find(p => p.quarter === index);
  return { sourceId: String(part?.source ?? index), part: part?.part ?? 0, deleted: part?.deleted ?? false };
}
