import { decodeHouseReplay, encodeHouseReplay } from '../../../rust/bridge/housesReplay';
import { validateHouseConfig, type HouseConfig } from '../../../rust/bridge/housesContract';

/** Reuse the existing Houses replay contract, including shell hash routes. */
export function readUrbanHouseModel(text: string, appliedMode?: 'strict' | 'inspired' | 'fantasy'): HouseConfig | undefined {
  const value = text.trim();
  if (!value) return undefined;
  let code = value;
  if (/^(https?:|file:)/i.test(value)) {
    const url = new URL(value);
    code = url.searchParams.get('replay') ?? new URLSearchParams(url.hash.slice(url.hash.indexOf('?') + 1)).get('replay') ?? '';
  } else if (value.startsWith('replay=')) code = new URLSearchParams(value).get('replay') ?? '';
  if (!code) throw new Error('Le lien Maisons doit contenir un code replay.');
  const { config } = decodeHouseReplay(code);
  validateHouseConfig(config);
  if (config.workshop && (config.mode !== 'fantasy_mix' || appliedMode !== 'fantasy')) throw new Error('house_config_workshop_mode : choisissez Fantasy dans le banc Maisons et appliquez le programme Fantasy du lieu avant d’implanter un preset libre.');
  return structuredClone(config);
}
export function urbanHouseModelCode(config?: HouseConfig): string {
  return config ? encodeHouseReplay(config, { mode: 'roof', level: 0, graph: false, dimensions: false }, 'urban-house-model') : '';
}
