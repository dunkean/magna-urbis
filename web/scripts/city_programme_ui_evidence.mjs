/** Read-only DOM observation vocabulary shared with the capture runner. No
 * controls are changed, no generator/capacity or applied-context is inferred. */
export const PROGRAMME_UI_PROOF_SELECTORS = Object.freeze({ intent: '[data-programme-intent]', custom: '[data-programme-custom-functions]',
  weights: '[data-programme-function]', fieldset: '[data-programme-functions]', note: '[data-programme-function-note]',
  effects: '[data-programme-function-effects] li', draft: '[data-programme-draft]', applied: '[data-programme-functions-applied]',
  warnings: '[data-programme-warnings]' });
const KEYS = ['agricultural', 'commerce', 'artisan', 'riverine', 'port', 'capital'];
const text = value => typeof value === 'string' ? value.slice(0, 2000) : null;
const flag = value => typeof value === 'boolean' ? value : null;
const texts = value => Array.isArray(value) ? value.slice(0, 24).map(text).filter(item => item !== null) : [];
export function programmeUiEvidence(raw) {
  const nodes = Array.isArray(raw?.weights) ? raw.weights.slice(0, 24) : [], seen = new Set(), unknown = [], duplicates = [], weights = {};
  for (const node of nodes) {
    const key = text(node?.key); if (!key || !KEYS.includes(key)) { if (key) unknown.push(key); continue; }
    if (seen.has(key)) { duplicates.push(key); continue; } seen.add(key);
    weights[key] = { value: text(node.value), disabled: flag(node.disabled) };
  }
  return { scope: 'read-only UI attribute/text observation; not a native resolution or applied-capacity proof',
    controlsPresent: raw?.controlsPresent === true, draft: { intent: text(raw?.intent), custom: flag(raw?.custom),
      fieldsetDisabled: flag(raw?.fieldsetDisabled), fieldsetHidden: flag(raw?.fieldsetHidden), weights,
      modifiedMarkerVisible: flag(raw?.draftVisible), message: text(raw?.draftMessage) },
    explanation: { note: text(raw?.note), effects: texts(raw?.effects) },
    retainedAppliedSummaries: texts(raw?.applied), warnings: texts(raw?.warnings),
    controlIssues: { unknownWeightKeys: unknown, duplicateWeightKeys: duplicates, missingWeightKeys: KEYS.filter(key => !seen.has(key)) },
    resolvedContext: null, requestedEqualsApplied: null, runtimeCapabilityVerified: null };
}
