import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base = process.env.MAGNA_V2_URL ?? 'http://127.0.0.1:5175', label = process.argv[2] ?? 'current';
const root = '/@fs/' + fileURLToPath(new URL('../src/v2', import.meta.url)).replace(/\\/g, '/');
const browser = await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'msedge', headless: true });
try {
  const page = await browser.newPage(); await page.goto(`${base}/v2.html?empty&lang=en`, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async root => {
    const [{ defaultSettings }, api, { urbanControlFields }, { readSettingPath }] = await Promise.all([import(root + '/settings.ts'), import(root + '/urbanControls.ts'), import(root + '/urbanControlSchema.ts'), import(root + '/parameterForm.ts')]);
    const settings = defaultSettings(); settings.urban = { backend: 'rust', buildings: Object.fromEntries(Array.from({ length: 10000 }, (_, i) => [`main/request-${i}`, { seed: `house-${i}`, overrides: { floors: 2, roof_pitch_deg: 32 } }])), local: Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`city-${i}`, { layout: { density: .8, footprint: { aspect: 1.4 } } }])) };
    const scope = { kind: 'global' }, host = document.createElement('div'); host.style.display = 'none'; document.body.append(host);
    const form = api.mountUrbanControls(host, () => settings, () => {}, scope);
    const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const measure = action => { action(); const samples = []; for (let i = 0; i < 15; i++) { const t = performance.now(); action(); samples.push(performance.now() - t); } return +median(samples).toFixed(3); };
    const effectiveMs = measure(() => api.urbanEffectiveValues(settings, scope)), syncMs = measure(() => form.sync());
    const effective = api.urbanEffectiveValues(settings, scope), values = urbanControlFields().map(field => [field.path, readSettingPath(effective, field.path)]);
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(values))))].map(b => b.toString(16).padStart(2, '0')).join('');
    form.dispose(); host.remove(); return { workload: { houseOverrides: 10000, localCities: 32, scalarFields: values.length }, medianMs: { effective: effectiveMs, sync: syncMs }, visibleValuesSha256: digest };
  }, root);
  const out = new URL('../out/v2-optimization/', import.meta.url); await mkdir(out, { recursive: true }); await writeFile(new URL(`form-${label}.json`, out), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
