import { describe, expect, it } from 'vitest';
import { defaultLayoutConfig, defaultParcelConfig, layoutExtent, normalizeLayoutConfig, normalizeParcelConfig, type Layout, type LayoutConfig, type Shape } from '../../rust/bridge/urban';
import { normalizeWorkshopContext, workshopConfig, type WorkshopContext } from '../src/ui/testbenchUrban';
import type { BenchOptions } from '../src/gen/urban/testbench';

const box = (x: number, y: number, width: number): Shape => ({ outer: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + width }, { x, y: y + width }], holes: [] });

describe('Rust urban configuration and framing boundary', () => {
  it('lets old planned links grow organically while retaining explicit geometric forms', () => {
    for (const family of ['auto', 'compact', 'composite', 'rectangle', 'polygon'] as const) {
      const result = normalizeLayoutConfig({ footprint: { mechanism: 'planned', family } }, true);
      expect(result.footprint.mechanism).toBe('auto');
      expect(result.footprint.family).toBe(family);
    }
  });
  it('retains legacy behaviour for old links while new scenes use the demographic budget', () => {
    const old = normalizeLayoutConfig({ count: 5, params: { fieldTwist: 0.4 } }, true);
    expect(old.composition).toBe('district');
    expect(old.footprint.mechanism).toBe('legacy');
    expect(old.footprint.budget).toBe('radius');
    expect(old.accessMode).toBe('cultural');
    const composed = normalizeLayoutConfig({ composition: 'settlement' }, true);
    expect(composed.composition).toBe('settlement');
    expect(composed.footprint.mechanism).toBe('legacy');
    expect(defaultLayoutConfig().footprint.budget).toBe('population');
    expect(defaultLayoutConfig().accessMode).toBe('adaptive');
    expect(defaultParcelConfig().operator).toBe('culture');
  });

  it('completes nested saved settings without losing valid zero values or mutating defaults', () => {
    const saved = { footprint: { mechanism: 'fusion' as const, family: 'archipelago' as const, irregularity: 0, orientation: 0, nuclei: 4 }, params: { fieldNoise: 0 } };
    const result = normalizeLayoutConfig(saved, true);
    expect(result.footprint).toMatchObject(saved.footprint);
    expect(result.footprint.budget).toBe('population');
    expect(result.footprint.aspect).toBeGreaterThan(0);
    result.footprint.nuclei = 6; result.params.fieldNoise = 1;
    expect(saved.footprint.nuclei).toBe(4);
    expect(saved.params.fieldNoise).toBe(0);
    expect(defaultLayoutConfig().footprint.nuclei).toBe(3);
  });

  it('repairs a saved modern Urban Bench link without passing parcel-only or unknown fields to Rust', () => {
    const saved = { ...defaultLayoutConfig(), culture: 'russian-kremlin', zone: 'village', count: 7,
      operator: 'culture', unknownLayoutOption: true, footprint: { ...defaultLayoutConfig().footprint, unknownFootprintOption: 3 }, params: { fieldNoise: 0 } };
    const result = normalizeLayoutConfig(saved, true);
    expect(result.culture).toBe('russian-kremlin');
    expect(result.count).toBe(7);
    expect(result.footprint.mechanism).toBe('auto');
    expect(result.footprint.budget).toBe('population');
    expect(result.accessMode).toBe('adaptive');
    expect(result).not.toHaveProperty('operator');
    expect(result).not.toHaveProperty('unknownLayoutOption');
    expect(result.footprint).not.toHaveProperty('unknownFootprintOption');
    expect(result.params).toEqual({ fieldNoise: 0 });
    expect(saved.operator).toBe('culture');
    const parcels = normalizeParcelConfig({ ...saved, operator: 'frontage' as const });
    expect(parcels.operator).toBe('frontage');
    expect(parcels).not.toHaveProperty('footprint');
    expect(parcels).not.toHaveProperty('count');
  });

  it('keeps old workshop map behaviour through quarters, parcels and shared settings', () => {
    const options: BenchOptions = { culture: 'japanese-jokamachi', recipe: 'core', zone: 'core', density: 1, count: 7, radius: 160, monument: 'none', stages: {} };
    const context: WorkshopContext = { source: 'map', siteCulture: options.culture, radius: 160,
      layoutConfig: { composition: 'settlement', culture: 'site', operator: 'culture', radius: 0 } as unknown as LayoutConfig,
      parcelConfig: { ...defaultParcelConfig(), operator: 'compound' } };
    const quarters = workshopConfig(options, context, 'quarters');
    expect(quarters.footprint).toMatchObject({ mechanism: 'legacy', budget: 'radius' });
    expect(quarters.accessMode).toBe('cultural');
    expect(quarters.composition).toBe('settlement');
    expect(quarters.culture).toBe('site');
    expect(quarters.radius).toBe(0);
    expect(quarters).not.toHaveProperty('operator');
    const parcelContext = normalizeWorkshopContext(context);
    expect(parcelContext.layoutConfig?.footprint.mechanism).toBe('legacy');
    expect(workshopConfig(options, parcelContext, 'parcels').operator).toBe('compound');
    expect(JSON.parse(JSON.stringify(parcelContext)).layoutConfig).not.toHaveProperty('operator');
    const fresh = workshopConfig(options, { source: 'fixture' }, 'quarters');
    expect(fresh.composition).toBe('district');
    expect(fresh.footprint.mechanism).toBe('auto');
    expect(fresh.footprint.budget).toBe('population');
    expect(fresh.accessMode).toBe('adaptive');
    const newContext = normalizeWorkshopContext({ source: 'fixture' });
    newContext.layoutConfig = { ...newContext.layoutConfig, fortification: 'none', zone: 'core' } as LayoutConfig;
    expect(workshopConfig(options, newContext, 'quarters').footprint.mechanism).toBe('auto');
    expect(context.layoutConfig).toHaveProperty('operator');
  });

  it('frames all attributed disconnected components and falls back for legacy or micro scenes', () => {
    const layout: Layout = { key: 'islands', culture: 'european-organic', center: { x: 0, y: 0 }, warnings: [], streets: [], blocks: [], quarters: [{ shape: box(0, 0, 10), phase: 0 }],
      structure: { version: 1, mechanism: 'fusion', family: 'archipelago', reserve: [], allocated: [box(0, 0, 10), box(100, 20, 20)], centers: [], districts: [], history: [],
        metrics: { targetArea: 500, allocatedArea: 500, streetArea: 0, reservedArea: 0, grossDensity: 100, plannedPopulation: 5, shortfallArea: 0, components: 2, accessAdded: 0 } } };
    expect(layoutExtent([layout])).toEqual({ center: { x: 60, y: 20 }, radius: 60 });
    expect(layoutExtent([{ ...layout, structure: undefined }])).toEqual({ center: { x: 5, y: 5 }, radius: 5 });
    expect(layoutExtent([])).toBeUndefined();
  });
});
