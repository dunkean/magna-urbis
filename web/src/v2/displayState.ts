import type { DisplayOpts } from '../ui/protocol';
/** Compare applied display values without relying on object insertion order. */
export function sameDisplay(a:DisplayOpts,b:DisplayOpts):boolean{
  for(const key of ['buildings','style','contours','landuse','labels','legend','painted','cartouche','vegetation'] as const)if(a[key]!==b[key])return false;
  for(const key of new Set([...Object.keys(a.colors??{}),...Object.keys(b.colors??{})]))if(a.colors?.[key as keyof NonNullable<DisplayOpts['colors']>]!==b.colors?.[key as keyof NonNullable<DisplayOpts['colors']>])return false;
  for(const key of new Set([...Object.keys(a.layers??{}),...Object.keys(b.layers??{})]))if(a.layers?.[key as keyof NonNullable<DisplayOpts['layers']>]!==b.layers?.[key as keyof NonNullable<DisplayOpts['layers']>])return false;
  return true;
}
