import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined) });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`);
  const results = await page.evaluate(async () => {
    document.body.innerHTML = `<details id="urbanQuarterStage"><summary>Plan <span data-state>9</span></summary>
      <button data-apply>Régénérer</button><label>Génération<select data-config="composition"><option value="settlement">Ville</option><option value="district" selected>Secteur</option></select></label>
      <details><summary>Dimensions et budget</summary><label>Aspect<input data-footprint="aspect" value="2.5"></label></details></details>
      <details id="urbanParcelStage"><summary>Parcelles <span>12</span></summary><button data-apply>Régénérer</button></details>
      <details id="rendering"><summary>Rendu</summary><div><label><input data-render="blocks" type="checkbox" checked>Îlots</label>
      <label>Palette<select data-render="palette"><option value="growth">Phases</option><option value="ink" selected>Encre</option></select></label>
      <label>Opacité<input data-render="opacity" value="0.7"></label></div><small></small></details>`;
    const { setupUrbanPanelLocale, urbanText } = await import('/urbanPanelLocale.ts');
    const { setupUrbanRenderLocale } = await import('/urbanRenderLocale.ts');
    setupUrbanPanelLocale([document.querySelector('#urbanQuarterStage'), document.querySelector('#urbanParcelStage')], true);
    setupUrbanRenderLocale(document.querySelector('#rendering'));
    return ['fr','en','zh','es','pt'].map(language => {
      localStorage.setItem('magna-urbis-locale', language);
      dispatchEvent(new Event('magna-locale-change'));
      const composition = document.querySelector('[data-config=composition]');
      const blocks = document.querySelector('[data-render=blocks]');
      return {
        parcelAction: document.querySelector('#urbanParcelStage [data-apply]').textContent,
        blocksLabel: blocks.nextSibling.textContent,
        checked: blocks.checked,
        composition: composition.value,
        compositionOption: composition.selectedOptions[0].textContent,
        dimensions: document.querySelector('#urbanQuarterStage details summary').textContent,
        aspect: document.querySelector('[data-footprint=aspect]').value,
        stageState: document.querySelector('#urbanQuarterStage [data-state]').textContent,
        palette: document.querySelector('[data-render=palette]').value,
        opacity: document.querySelector('[data-render=opacity]').value,
        errorText: urbanText(['erreur','error','错误','error español','erro']),
      };
    });
  });
  const parcelActions = ['Régénérer les parcelles','Regenerate parcels','重新生成地块','Regenerar parcelas','Regenerar lotes'];
  const blocksLabels = ['Îlots','Blocks','街区','Manzanas','Quadras'];
  const compositionOptions = ['Secteur isolé · ancien banc','Single sector · legacy bench','单个分区 · 旧工作台','Sector aislado · banco antiguo','Setor isolado · bancada antiga'];
  const dimensionsLabels = ['Dimensions et budget','Dimensions and budget','尺寸与预算','Dimensiones y presupuesto','Dimensões e orçamento'];
  const errors = ['erreur','error','错误','error español','erro'];
  for (const [i, result] of results.entries()) {
    assert.equal(result.parcelAction, parcelActions[i]);
    assert.equal(result.blocksLabel, blocksLabels[i]);
    assert.equal(result.checked, true);
    assert.equal(result.composition, 'district');
    assert.equal(result.compositionOption, compositionOptions[i]);
    assert.equal(result.dimensions, dimensionsLabels[i]);
    assert.equal(result.aspect, '2.5');
    assert.equal(result.stageState, '9');
    assert.equal(result.palette, 'ink');
    assert.equal(result.opacity, '0.7');
    assert.equal(result.errorText, errors[i]);
  }
  console.log('Urban locale: five languages preserve controls and stage state.');
} finally {
  await browser?.close();
  await server.close();
}
