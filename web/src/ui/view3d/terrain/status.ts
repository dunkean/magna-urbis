/**
 * Status attributes of a 3D terrain view (data-renderer, data-terrain-shader, data-ground-variant on the owner's
 * element): recorded always, shown unless the view is being prepared silently behind the displayed one (a backend switch).
 */
import type { Terrain3dStatus } from './contract';

export class TerrainStatus {
  private values: Partial<Record<Terrain3dStatus, string>> = {};

  constructor(
    private readonly element: HTMLElement,
    private silent: boolean,
  ) {}

  /** Records a status attribute, shown on the element unless the view is silent. */
  mark(key: Terrain3dStatus, value: string): void {
    this.values[key] = value;
    if (!this.silent) this.element.dataset[key] = value;
  }

  get(key: Terrain3dStatus): string | undefined {
    return this.values[key];
  }

  /** A silent view becomes the displayed one: its status attributes replace the previous view's. */
  show(): void {
    this.silent = false;
    for (const key of ['renderer', 'terrainShader', 'groundVariant'] as const) {
      if (this.values[key] === undefined) delete this.element.dataset[key];
      else this.element.dataset[key] = this.values[key];
    }
  }
}
