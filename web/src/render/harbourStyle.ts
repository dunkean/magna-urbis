/** Harbour vocabulary shared by the 2D plan (Canvas 2D and WebGL2) and the 3D city.
 *
 * A harbour is a list of platforms and furniture (`layout.structure.quays`, Rust `urban::harbour_furniture`): each item is a
 * polygon with a `kind` and a `material`. This module is the only place that turns (kind, material) into a look, so every
 * page and both renderers show the same harbour:
 *   - `harbourPaint`: fill and outline of an item on the plan;
 *   - `harbourPrism`: the vertical extent and material of an item in 3D, relative to its water level and deck;
 *   - `harbourShown`: small items are drawn on close views only.
 * Boat classes (hull colour, freeboard, mast height) come from the same data file as the generator
 * (rust/crates/core/src/urban/harbours.json). */
import harbours from '../../../rust/crates/core/src/urban/harbours.json';
import { quayFill } from './roadStyle';

interface BoatClass { length: number; beam: number; hull: string; masts?: number; rig?: string; cabin?: boolean; freeboard?: number; mast?: number; color?: string; sailColor?: string; cabinColor?: string }
const BOATS = harbours.boats as unknown as Record<string, BoatClass>;
/** Harbour types of the catalogue, in file order, with their [English, French] names. */
export const HARBOUR_TYPES: readonly string[] = Object.keys(harbours.types);
export const HARBOUR_TYPE_NAMES: Record<string, readonly [string, string]> = Object.fromEntries(
  Object.entries(harbours.types as unknown as Record<string, { label: string[] }>).map(([id, type]) => [id, [type.label[0], type.label[1]] as const]));

const DARK = '#2b2015';
const CARGO: Record<string, string> = { barrels: '#7b5b38', bales: '#c2b28a', timber: '#9a7b4f', nets: '#8d8a6a', crates: '#8a6c45', stone: '#9c958a' };
const hex = (value: string | undefined, fallback: string): string => `#${value ?? fallback}`;

export interface HarbourPaint { fill: string; fillAlpha: number; line: string; lineAlpha: number; /** Outline width in screen pixels. */ width: number }
/** Plan paint of one harbour item. `ink` is the caller's ordinary outline colour (parchment ink, or the grey of the other
 * palettes). Platforms keep the look they had before the harbour furniture existed. */
export function harbourPaint(kind: string, material: string, parchment: boolean, ink: string): HarbourPaint {
  const solid = (fill: string, line = DARK, width = .8, lineAlpha = 1): HarbourPaint => ({ fill, fillAlpha: 1, line, lineAlpha, width });
  switch (kind) {
    // Sheltered water inside a breakwater: a calm tone, no outline.
    case 'basin': return { fill: parchment ? '#7f9aa0' : '#10303a', fillAlpha: parchment ? .22 : .1, line: ink, lineAlpha: 0, width: 0 };
    case 'boat': case 'boat-ashore': return solid(hex(BOATS[material]?.color, parchment ? '7a5a3a' : '9c8463'), DARK, .8);
    case 'cabin': return solid(hex(BOATS[material]?.cabinColor, parchment ? 'a98a58' : 'b9a67c'), DARK, .5, .7);
    case 'mast': return { fill: DARK, fillAlpha: 1, line: DARK, lineAlpha: 0, width: 0 };
    // A furled sail on its yard.
    case 'yard': return solid(hex(BOATS[material]?.sailColor, 'e9e1cc'), DARK, .5, .6);
    case 'crane': case 'crane-jib': return solid('#4a3a28', DARK, .8);
    case 'beacon': return solid(parchment ? '#b5533a' : '#c9bfa6', DARK, 1.2);
    case 'post': return { fill: DARK, fillAlpha: 1, line: DARK, lineAlpha: 0, width: 0 };
    case 'cargo': return solid(CARGO[material] ?? CARGO.crates, DARK, .5, .5);
    case 'raft': return solid('#8a7048', DARK, .5, .5);
    case 'shiphouse': return solid(material === 'stone' ? (parchment ? '#b08a68' : '#8d7a66') : parchment ? '#a9744f' : '#7a5a40', DARK, 1);
    case 'slip': return solid(material === 'timber' ? quayFill('timber', parchment) : parchment ? '#cbbd97' : '#9a917b', ink, .9);
    case 'steps': return solid(parchment ? '#c7bb98' : '#989080', ink, .9);
    // The quay wall along the water: one dark stroke, as an engraver marks a built bank.
    case 'kerb': return { fill: material === 'timber' ? '#4f3e2c' : parchment ? DARK : '#4d473d', fillAlpha: .9, line: DARK, lineAlpha: 0, width: 0 };
    // Moles and breakwaters: a dark outline, legible zoomed out.
    case 'mole': case 'breakwater': return solid(quayFill(material, parchment), DARK, 1.6);
    default: return solid(quayFill(material, parchment), ink, .9);
  }
}

const PLATFORMS = new Set(['quay', 'landing', 'pier', 'mole']);
/** Platforms of the harbour planner (walkable structures); every other kind is furniture. */
export const harbourPlatform = (kind: string): boolean => PLATFORMS.has(kind);
const DETAIL = new Set(['mast', 'yard', 'cabin', 'post', 'cargo', 'crane-jib']);
/** Whether an item is drawn at a level of detail of the plan: furniture too small to read on a town view (masts, yards, cabins,
 * posts, cargo, jibs) on near and close views only, the quay wall from the mid view, everything else at every zoom. */
export const harbourShown = (kind: string, lod: 'far' | 'mid' | 'near' | 'close'): boolean =>
  DETAIL.has(kind) ? lod === 'near' || lod === 'close' : kind === 'kerb' ? lod !== 'far' : true;

export interface HarbourPrism { bottom: number; top: number; timber: boolean; /** Final sRGB tint of the top face. */ tint: string; /** Tint of the side faces; the top tint when absent. */ side?: string; /** Timber piles under the deck. */ piles?: boolean; /** Ridge height above `top` (gabled shed). */ ridge?: number }
/** Vertical extent of one harbour item in the 3D city (metres, absolute), or null when it has no volume. `deck` is the
 * item's `deck_z_m`: one metre above its water level, as the generator and the retained water levels set it. */
export function harbourPrism(kind: string, material: string, deck: number): HarbourPrism | null {
  const water = deck - 1, timber = material === 'timber', boat = BOATS[material], freeboard = boat?.freeboard ?? .6;
  const tint = (color: string): string => color.replace('#', '');
  switch (kind) {
    case 'basin': return null;
    // Stone platforms show their wall down into the water, darker than the paved top.
    case 'quay': case 'mole': case 'breakwater': return timber ? { bottom: deck - .5, top: deck, timber, tint: '6b5640', piles: true }
      : { bottom: water - 1.6, top: kind === 'breakwater' ? deck + .5 : deck, timber, tint: '857e6e', side: '5c564b' };
    // A landing is a plank deck: a thin face (0.2 m), never a block.
    case 'pier': case 'landing': case 'jetty': return timber ? { bottom: deck - (kind === 'landing' ? .2 : .45), top: deck, timber, tint: '6b5640', piles: true }
      : { bottom: water - 1.6, top: deck, timber, tint: '857e6e', side: '5c564b' };
    case 'pontoon': case 'raft': return { bottom: water - .1, top: water + .4, timber: true, tint: kind === 'raft' ? '7a6442' : '6b5640' };
    case 'slip': return { bottom: water - .6, top: water + .3, timber, tint: timber ? '6b5640' : '8f8878', side: '5c564b' };
    case 'steps': return { bottom: water - .8, top: water + .45, timber: false, tint: '8f8878', side: '6a6458' };
    // The quay wall: a coping just above the deck, its face down into the water.
    case 'kerb': return timber ? { bottom: deck - .35, top: deck + .2, timber, tint: '4f3e2c' } : { bottom: water - 1.6, top: deck + .25, timber, tint: '6f685b', side: '4f493f' };
    case 'boat': return { bottom: water - .35, top: water + freeboard, timber: true, tint: tint(hex(boat?.color, '6e5338')), side: tint(hex(boat?.color, '4f3b28')) };
    case 'boat-ashore': return { bottom: water + .2, top: water + .55 + freeboard, timber: true, tint: tint(hex(boat?.color, '6e5338')), side: tint(hex(boat?.color, '4f3b28')) };
    case 'cabin': return { bottom: water + freeboard, top: water + freeboard + 1.7, timber: true, tint: tint(hex(boat?.cabinColor, '8f7448')) };
    case 'mast': return { bottom: water + freeboard, top: water + (boat?.mast ?? 8), timber: true, tint: '3a2c1e' };
    case 'yard': { const at = water + .72 * (boat?.mast ?? 8); return { bottom: at, top: at + .45, timber: true, tint: tint(hex(boat?.sailColor, 'd8cfb8')) }; }
    case 'crane': return { bottom: deck, top: deck + (material === 'gantry' ? 14 : material === 'derrick' ? 9 : 7), timber: material !== 'gantry', tint: material === 'gantry' ? '5d6468' : '5a4631', ridge: material === 'treadwheel' ? 1.6 : 0 };
    case 'crane-jib': { const at = deck + (material === 'gantry' ? 12.5 : material === 'derrick' ? 8 : 6); return { bottom: at, top: at + .5, timber: material !== 'gantry', tint: material === 'gantry' ? '5d6468' : '4a3826' }; }
    case 'beacon': return { bottom: deck, top: deck + 8, timber, tint: timber ? '6b5640' : 'a39a86', ridge: 1.2 };
    case 'post': return { bottom: water - .6, top: water + 2.1, timber: true, tint: '3f3022' };
    case 'cargo': return { bottom: deck, top: deck + (material === 'timber' ? .9 : material === 'nets' ? 1.6 : 1.2), timber: true, tint: tint(CARGO[material] ?? CARGO.crates) };
    case 'shiphouse': return { bottom: water - .2, top: deck + 3.2, timber, tint: timber ? '6f4f38' : '8d8272', side: timber ? '5c4632' : '776d5f', ridge: 2.4 };
    default: return { bottom: deck - .6, top: deck, timber, tint: timber ? '6b5640' : '857e6e' };
  }
}
