/** Screen radius (CSS pixels) within which a press picks a map object: a fingertip covers about twice what a mouse
 * pointer needs. `pointerType` is the PointerEvent's ('touch', 'mouse', 'pen'; undefined: treated as a mouse). */
export const pickRadius = (pointerType: string | undefined, mousePx: number): number => (pointerType === 'touch' ? mousePx * 2 : mousePx);
