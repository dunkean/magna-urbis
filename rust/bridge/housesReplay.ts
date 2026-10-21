/** Pure replay codec shared by Houses and urban model controls. */
import { HOUSE_SCHEMA, type HouseConfig } from './housesContract';

export function wellFormedSeed(seed: string): boolean {
  for (let index = 0; index < seed.length; index++) {
    const code = seed.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const following = seed.charCodeAt(++index);
      if (!(following >= 0xdc00 && following <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
export interface HouseView { mode: 'roof' | 'plan'; level: number; graph: boolean; dimensions: boolean }
export function encodeHouseReplay(config: HouseConfig, view: HouseView, generator: string): string {
  if (!wellFormedSeed(config.seed)) throw new Error('La graine contient une séquence Unicode invalide.');
  const bytes = new TextEncoder().encode(JSON.stringify({version: 1, generator_version: generator, config, view}));
  if (bytes.length > 12000) throw new Error('Configuration trop longue pour un lien rejouable.');
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeHouseReplay(encoded: string): {config: HouseConfig; view: HouseView; generator_version: string} {
  if (encoded.length > 16000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('Lien maisons invalide ou trop long.');
  const raw = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
  const replay = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Uint8Array.from(raw, char => char.charCodeAt(0))));
  if (replay.version !== 1 || replay.config?.schema_version !== HOUSE_SCHEMA || typeof replay.config?.seed !== 'string' || !wellFormedSeed(replay.config.seed)) throw new Error('Version ou graine du lien maisons incompatible.');
  if (typeof replay.generator_version !== 'string' || replay.generator_version.length > 100) throw new Error('Version du générateur absente ou invalide dans le lien.');
  if (!['roof', 'plan'].includes(replay.view?.mode) || !Number.isInteger(replay.view?.level) || replay.view.level < 0 || replay.view.level > 11 || typeof replay.view?.graph !== 'boolean' || typeof replay.view?.dimensions !== 'boolean') throw new Error('Options de vue du lien maisons invalides.');
  return replay;
}
