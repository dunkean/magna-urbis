import { registerMessages } from './i18n';
import { urbanHelpMessages } from './localeUrbanHelp';
import { urbanContextHelp, urbanParameterHelp } from './urbanParameterHelpSource';
export { urbanContextHelp, urbanParameterHelp } from './urbanParameterHelpSource';

registerMessages(Object.fromEntries(urbanHelpMessages.map(([en, fr]) => [en, { en, fr }])));

/** Resolve the semantic field before zone names and range endpoints (e.g. blockSize.core.0). */
export function urbanHelp(path: string): string | undefined {
  const parts = path.split('.').filter(part => !/^\d+$/.test(part));
  const params = parts.indexOf('params');
  if (params >= 0) {
    const key = parts[params + 1];
    if (key === 'orientation') return urbanContextHelp.streetOrientation;
    return urbanParameterHelp[key];
  }
  const key = parts.at(-1)!;
  if (key === 'recipe' && (parts.includes('house_config') || parts.includes('houseConfig') || parts.length === 1)) return urbanContextHelp.houseRecipe;
  if (key === 'mode' && (parts.includes('house_config') || parts.includes('houseConfig') || parts.length === 1)) return urbanContextHelp.houseMode;
  if (parts.includes('zoneOperators')) return urbanParameterHelp.operator;
  return urbanParameterHelp[key];
}
