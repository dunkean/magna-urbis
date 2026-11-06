import { waterRamp } from './waterStyle';
import { isUnderdarkBiome, biomeName, type BiomeName } from '../gen/biomes';
import { PALETTES, type MapStyle, type Palette } from './styles';

const GROUND: Record<Exclude<BiomeName, 'temperate'>, [string, string, string]> = {
  forest: ['#d8dfc0', '#b5c397', '#9a9f85'], desert: ['#f2d8a4', '#dcc28f', '#bca382'],
  steppe: ['#e7d9ad', '#c9bc8b', '#a7a184'], tropical: ['#d1dfb2', '#a5bd8c', '#929e7b'],
  tundra: ['#dce1d9', '#c6cdbd', '#a9b0a7'],
  underdark: ['#c0b9c6', '#8e8999', '#655e73'],
  'underdark-caverns': ['#c0b9c6', '#8e8999', '#655e73'],
};
/** Crops by climate: field tint, its light and dark strips, furrow ink, meadow. Temperate keeps the parchment tones. */
const CROPS: Record<'forest' | 'desert' | 'steppe' | 'tropical' | 'tundra', { field: string; stripA: string; stripB: string; furrow: string; meadow: string }> = {
  forest: { field: '#d8cf97', stripA: '#e3daaa', stripB: '#cdc389', furrow: '#7f7446', meadow: '#b1c48a' },
  desert: { field: '#e6d199', stripA: '#efdfb2', stripB: '#dac085', furrow: '#937b4b', meadow: '#d4ca92' },
  steppe: { field: '#e3cf8e', stripA: '#ebdca4', stripB: '#d5bf7b', furrow: '#8c7543', meadow: '#d2c88a' },
  tropical: { field: '#cdd089', stripA: '#d9dc9b', stripB: '#b7c376', furrow: '#6f7a3c', meadow: '#a9c882' },
  tundra: { field: '#d3d4b6', stripA: '#dddcc5', stripB: '#c3c6a7', furrow: '#7f806a', meadow: '#c0c9ae' },
};
const CACHE = new Map<string, Palette>();

/** Shared palette for SVG, Canvas, terrain and legend. Never mutate the registered map styles. */
export function biomePalette(style: MapStyle | Palette, value?: string): Palette {
  const base = typeof style === 'string' ? PALETTES[style] : style;
  const biome = biomeName(value);
  if (biome === 'temperate') return base;
  // Custom palettes are also supported, but must not share cached tokens with the registered style.
  const key = base === PALETTES[base.name] ? `${base.name}:${biome}` : '';
  const cached = key && CACHE.get(key);
  if (cached) return cached;
  if (isUnderdarkBiome(biome)) {
    const mono = ['engraving', 'blueprint'].includes(base.name), night = base.name === 'night';
    const stone = night ? '#353344' : '#aaa3b1', damp = night ? '#425259' : '#8dabae';
    const fungal = night ? '#9f93b6' : '#b4a4c9', ink = night ? '#d1c8df' : '#514763';
    const pal: Palette = {
      ...base, hedgeOn: false,
      tex: { ...base.tex, commons: true, garden: true, marsh: true },
      ...(!mono ? {
        hypso: (night ? [[0, '#484354'], [.5, '#34303f'], [1, '#211e2c']] : [[0, '#c0b9c6'], [.5, '#8e8999'], [1, '#655e73']]) as [number, string][],
        seaFill: night ? '#253e49' : '#769ca7', lakeFill: night ? '#31515a' : '#8caeb4',
        riverFill: night ? '#7baeb8' : '#9ebfc1', riverEdge: night ? '#91bcc3' : '#446873',
        waterEdge: night ? '#72959f' : '#496976',
        land: { field: fungal, meadow: stone, pasture: stone, commons: stone, forest: fungal, orchard: fungal, marsh: damp, garden: fungal },
        treeFill: fungal, treeInk: ink, orchardDot: ink, grass: night ? '#aaa2bb' : '#615b70', reed: ink,
        roadFill: night ? '#625a70' : '#c5bdce', roadEdge: ink, trackFill: stone,
        farmYard: stone, farmRoof: night ? '#80738d' : '#887893', farmInk: ink,
        urban: { ...base.urban, street: night ? '#4d475c' : '#b2abbc', streetEdge: ink,
          yard: night ? '#464051' : '#a9a2b3', garden: fungal, gardenInk: ink,
          mass: night ? '#7b718d' : '#71657f', massEdge: night ? '#d2c8df' : '#322a43',
          place: stone, placeInk: ink, landmark: night ? '#afa2c5' : '#9384a7', landmarkEdge: ink },
      } : {}),
    };
    pal.water = waterRamp(pal.waterEdge, pal.seaFill);
    if (key) CACHE.set(key, pal);
    return pal;
  }
  const dry = biome === 'desert', cold = biome === 'tundra';
  const colorful = !['engraving', 'blueprint', 'night'].includes(base.name);
  const tones = GROUND[biome], crops = CROPS[biome as keyof typeof CROPS];
  const pal: Palette = {
    ...base, tex: { ...base.tex, commons: dry ? false : base.tex.commons },
    hedgeOn: dry || cold ? false : base.hedgeOn,
    ...(colorful ? {
      hypso: [[0, tones[0]], [0.5, tones[1]], [1, tones[2]]] as [number, string][],
      land: { ...base.land, field: crops.field, meadow: crops.meadow, commons: tones[1], pasture: dry ? '#d5c79d' : cold ? '#c4cbb0' : base.land.pasture,
        forest: biome === 'tropical' ? '#799b65' : biome === 'forest' ? '#879e6e' : cold ? '#8e9f83' : dry ? '#9ba873' : base.land.forest },
      stripA: crops.stripA, stripB: crops.stripB, furrow: crops.furrow,
      grass: dry ? '#a18e64' : cold ? '#89927b' : base.grass,
      // Dedicated gardens still read as cultivation; dry rear yards use terrain instead of these tokens.
      urban: { ...base.urban, garden: dry ? '#c4c098' : biome === 'steppe' ? '#cbc994' : cold ? '#c2cbb6' : base.urban.garden,
        gardenInk: dry ? '#8b855b' : cold ? '#879276' : base.urban.gardenInk },
    } : {}),
  };
  if (key) CACHE.set(key, pal);
  return pal;
}
