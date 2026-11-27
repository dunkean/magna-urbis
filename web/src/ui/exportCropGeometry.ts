export interface ExportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ExportHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Move the grabbed edges within the map while keeping the opposite edges anchored. */
export function resizeExportRect(rect: ExportRect, bounds: ExportRect, handle: ExportHandle, dx: number, dy: number): ExportRect {
  let { x, y } = rect;
  let right = x + rect.width,
    bottom = y + rect.height;
  const minWidth = Math.min(1, bounds.width),
    minHeight = Math.min(1, bounds.height);
  if (handle.includes('w')) x = Math.max(bounds.x, Math.min(right - minWidth, x + dx));
  if (handle.includes('e')) right = Math.min(bounds.x + bounds.width, Math.max(x + minWidth, right + dx));
  if (handle.includes('n')) y = Math.max(bounds.y, Math.min(bottom - minHeight, y + dy));
  if (handle.includes('s')) bottom = Math.min(bounds.y + bounds.height, Math.max(y + minHeight, bottom + dy));
  return { x, y, width: right - x, height: bottom - y };
}

/** Clip a selection to the exported map, retaining a nonempty rectangle. */
export function clampExportRect(rect: ExportRect, bounds: ExportRect): ExportRect {
  const width = Math.max(Math.min(1, bounds.width), Math.min(bounds.width, rect.width));
  const height = Math.max(Math.min(1, bounds.height), Math.min(bounds.height, rect.height));
  return { x: Math.max(bounds.x, Math.min(bounds.x + bounds.width - width, rect.x)), y: Math.max(bounds.y, Math.min(bounds.y + bounds.height - height, rect.y)), width, height };
}

/** Keep the longest edge at the export resolution without stretching a rectangular crop. */
export function exportPixelSize(rect: ExportRect, longestEdge: number): { width: number; height: number } {
  const scale = longestEdge / Math.max(rect.width, rect.height);
  return { width: Math.max(1, Math.round(rect.width * scale)), height: Math.max(1, Math.round(rect.height * scale)) };
}
