export interface IllustrationCapture { image: Blob; guides?: Partial<Record<'edges' | 'depth' | 'normal' | 'segmentation', Blob>>; context: Record<string, unknown> }
export interface IllustrationNavigation { getView(): { cx: number; cy: number; scale: number }; setView(view: { cx: number; cy: number; scale: number }): void; ready?(): Promise<void> }
export function mountIllustration(options: { host: Element; capture: () => Promise<IllustrationCapture>; prepareBattlemap?: (settings: { pixels: number; cellMetres: number }) => void | Promise<void>; navigation?: IllustrationNavigation; defaultService?: string }): { button: HTMLButtonElement; dialog: HTMLDialogElement; open(): void; dispose(): void };
export function serviceUrl(value: string): string;
export function targetSize(width: number, height: number, pixels?: number): { width: number; height: number };
export function captureViewport(viewport: Element, options?: { exclude?: string[]; structural?: boolean }): Promise<Blob>;
export function dataUrl(blob: Blob): Promise<string>;
export function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob>;
export function saveIllustrationFile(blob: Blob, name: string, fallbackUrl?: string): Promise<string | undefined>;
