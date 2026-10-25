import { Terrain3d, type Terrain3dCamera } from './terrain3d';
import type { SettlementRaster } from '../../../rust/bridge/settlements';
import type { PlacementBatch } from '../../../rust/bridge/urbanArchitecture';
import type { UrbanBuildingAppearance } from '../render/urbanBuildingStyle';

export interface UrbanSurface { width: number; n: number; height: Float32Array; water: Uint8Array; waterLevel: Float32Array }
/** Reuse the physical grid. The terrain viewer owns mesh LOD; resampling here
 * would replace the ground underneath the native building foundations. */
export function urbanDisplaySurface(raster: SettlementRaster): UrbanSurface {
  return raster;
}

/** Reuses the terrain viewer and its camera, depth buffer and GPU lifetime. */
export class UrbanPerspective {
  private canvas = document.createElement('canvas');
  private controls = document.createElement('div');
  private viewer?: Terrain3d;
  private surface?: UrbanSurface;
  private scene?: PlacementBatch;
  private appearance: UrbanBuildingAppearance = { style: 'cartographic', diagnostic: 'none' };
  private visible = true;
  private active = false;
  private epoch = 0;
  private observer: ResizeObserver;
  constructor(private map: SVGSVGElement, private onCamera: (camera: Terrain3dCamera) => void, private onSelect: (id: string) => void, private onError: (message: string) => void) {
    const host = map.parentElement!; host.classList.add('urban-perspective-host');
    this.canvas.className = 'urban-perspective-canvas'; this.canvas.hidden = true; this.canvas.tabIndex = -1; this.canvas.setAttribute('aria-label', 'Vue urbaine en 3D'); host.append(this.canvas);
    this.controls.className = 'urban-perspective-tools'; this.controls.hidden = true;
    this.controls.innerHTML = '<button type="button" data-urban-3d-fit>Cadrer la ville</button><button type="button" data-urban-3d-north>Nord</button><label>Relief × <input data-urban-3d-exaggeration type="range" min="1" max="5" step=".1" value="1"><output>1</output></label><button type="button" data-urban-3d-capture>Capturer PNG</button>';
    host.append(this.controls);
    this.controls.querySelector<HTMLButtonElement>('[data-urban-3d-fit]')!.onclick = () => this.fit();
    this.controls.querySelector<HTMLButtonElement>('[data-urban-3d-north]')!.onclick = () => this.viewer?.north();
    this.controls.querySelector<HTMLInputElement>('input')!.oninput = event => {
      if (!this.viewer) return;
      this.viewer.setCamera({ ...this.viewer.getCamera(), exaggeration: Number((event.target as HTMLInputElement).value) }); this.changed();
    };
    this.controls.querySelector<HTMLButtonElement>('[data-urban-3d-capture]')!.onclick = () => { void this.capture().catch(error => this.onError(String(error))); };
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(map);
    let down: [number, number] | undefined;
    this.canvas.addEventListener('pointerdown', event => { down = [event.clientX, event.clientY]; });
    this.canvas.addEventListener('pointerup', event => {
      if (down && Math.hypot(event.clientX - down[0], event.clientY - down[1]) < 4) {
        const rect = this.canvas.getBoundingClientRect(), id = this.viewer?.pickBuilding(event.clientX - rect.left, event.clientY - rect.top);
        if (id) this.onSelect(id);
      }
      down = undefined;
    });
    window.addEventListener('pagehide', () => this.dispose(), { once: true });
  }
  setActive(active: boolean, camera?: Terrain3dCamera): boolean {
    if (camera && this.viewer) {
      const current = this.viewer.getCamera();
      if (Object.keys(camera).some(key => camera[key as keyof Terrain3dCamera] !== current[key as keyof Terrain3dCamera])) this.viewer.setCamera(camera);
    }
    if (active === this.active) return active;
    if (active && !this.surface) { this.onError('Générez un plan sur son terrain avant d’ouvrir la perspective.'); return false; }
    if (active && !this.viewer) {
      try { this.viewer = new Terrain3d(this.canvas, () => this.changed()); }
      catch (error) { this.onError(String(error)); return false; }
      this.syncSurface();
      if (camera) this.viewer.setCamera(camera);
      else if (this.surface) {
        const points = this.scene?.buildings.flatMap(b => b.footprint.flatMap(p => p.outer)) ?? [];
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
        if (Number.isFinite(x0)) this.viewer.setCamera({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, distance: Math.max(35, x1 - x0, y1 - y0) * 1.5, yaw: 0, pitch: .85, exaggeration: 1 });
      }
    }
    this.active = active; this.canvas.hidden = !active; this.controls.hidden = !active; this.canvas.tabIndex = active ? 0 : -1; this.map.style.visibility = active ? 'hidden' : '';
    this.viewer?.setActive(active); this.resize();
    if (active) { this.viewer?.setBuildings(this.scene, this.appearance, this.visible); void this.texture(); }
    if (active && this.viewer) this.changed();
    return active;
  }
  update(surface: UrbanSurface | undefined, scene: PlacementBatch | undefined, appearance: UrbanBuildingAppearance, visible: boolean): void {
    const changed = this.surface !== surface; this.surface = surface; this.scene = scene; this.appearance = appearance; this.visible = visible;
    if (changed) this.syncSurface();
    this.viewer?.setBuildings(scene, appearance, visible);
    if (this.active) void this.texture();
  }
  private syncSurface(): void {
    const source = this.surface;
    if (!this.viewer || !source) return;
    const mask = Float32Array.from(source.water, value => value > 0 && value < 4 ? 1 : -1);
    this.viewer.setSurface({ x: 0, y: 0, width: source.width, n: source.n, data: source.height }, { n: source.n, mask, levels: source.waterLevel }, true);
  }
  private resize(): void {
    const rect = this.map.getBoundingClientRect(), parent = this.map.parentElement!.getBoundingClientRect();
    Object.assign(this.canvas.style, { left: `${rect.left - parent.left}px`, top: `${rect.top - parent.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    Object.assign(this.controls.style, { left: `${rect.left - parent.left + 8}px`, top: `${rect.top - parent.top + 8}px` });
    this.viewer?.resize(rect.width, rect.height);
  }
  private async texture(): Promise<void> {
    if (!this.surface || !this.viewer || !this.active) return;
    const ticket = ++this.epoch, copy = this.map.cloneNode(true) as SVGSVGElement;
    copy.style.visibility = ''; copy.style.background = ''; copy.setAttribute('viewBox', `0 0 ${this.surface.width} ${this.surface.width}`); copy.setAttribute('width', '1536'); copy.setAttribute('height', '1536');
    copy.querySelectorAll('[data-urban-buildings], [data-building], [data-pin], [data-native-buildings]').forEach(node => node.remove());
    const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); background.setAttribute('width', String(this.surface.width)); background.setAttribute('height', String(this.surface.width)); background.setAttribute('fill', getComputedStyle(this.map).backgroundColor || '#eee6cf'); copy.prepend(background);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
    try {
      const image = new Image(); image.src = url; await image.decode();
      if (ticket === this.epoch && this.active) this.viewer.setTexture(image);
    } catch (error) { if (ticket === this.epoch) this.onError(`Fond 3D : ${String(error)}`); }
    finally { URL.revokeObjectURL(url); }
  }
  get camera(): Terrain3dCamera | undefined { return this.viewer?.getCamera(); }
  get isActive(): boolean { return this.active; }
  captureIllustration(): Promise<{ image: Blob; depth: Blob; camera: Terrain3dCamera }> {
    if (!this.active || !this.viewer) return Promise.reject(new Error('Vue 3D inactive.'));
    return this.viewer.captureIllustration();
  }
  private changed(): void {
    if (!this.viewer) return;
    const camera = this.viewer.getCamera();
    this.controls.querySelector<HTMLInputElement>('input')!.value = String(camera.exaggeration);
    this.controls.querySelector('output')!.textContent = camera.exaggeration.toFixed(1).replace('.0', ''); this.onCamera(camera);
  }
  fit(): void {
    if (!this.viewer) return;
    const points = this.scene?.buildings.flatMap(b => b.footprint.flatMap(p => p.outer)) ?? [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    if (Number.isFinite(x0)) this.viewer.fit((x0 + x1) / 2, (y0 + y1) / 2, Math.max(35, x1 - x0, y1 - y0));
    else this.viewer.fit();
  }
  async capture(): Promise<void> {
    if (!this.viewer) throw new Error('Ouvrez la vue 3D avant de la capturer.');
    const url = URL.createObjectURL(await this.viewer.capture()), link = document.createElement('a');
    link.href = url; link.download = 'magna-urbis-3d.png'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  dispose(): void { ++this.epoch; this.observer.disconnect(); this.viewer?.dispose(); this.viewer = undefined; this.canvas.remove(); this.controls.remove(); }
}
