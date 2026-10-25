/** Shared, build-free illustration client used by both applications. No credentials are persisted. */
const terminal = new Set(['succeeded', 'failed', 'cancelled']);
const styles = [['auto', 'Style de la couche visible'], ['cadastre', 'Cadastre'], ['parchment', 'Carte parchemin'], ['geographic', 'Carte géographique'], ['satellite', 'Satellite'], ['engraving', 'Gravure'], ['watercolor', 'Aquarelle'], ['fineart', 'Peinture · fine art'], ['photorealistic', 'Photoréaliste'], ['atlas', 'Atlas illustré']];
const css = `
.illustration-dialog{color:#e9edf0;background:#172126;border:1px solid #657b85;border-radius:14px;width:min(1120px,94vw);max-height:92vh;padding:0;font:14px/1.45 system-ui,sans-serif;box-shadow:0 20px 80px #0008}.illustration-dialog::backdrop{background:#071014bd}.illustration-dialog *{box-sizing:border-box}.illustration-dialog header{display:flex;align-items:center;gap:12px;background:none;padding:18px 22px;border-bottom:1px solid #415158}.illustration-dialog h2{margin:0;font-size:20px}.illustration-dialog header button{margin-left:auto}.illustration-body{padding:18px 22px;display:grid;grid-template-columns:minmax(230px,300px) minmax(0,1fr);gap:22px}.illustration-fields{display:flex;flex-direction:column;gap:12px}.illustration-dialog label{display:flex;flex-direction:column;gap:5px;font-size:13px;color:#c9d7dc}.illustration-dialog input:not([type=range]),.illustration-dialog select,.illustration-dialog textarea{width:100%;padding:8px;color:#edf2f4;background:#243239;border:1px solid #5a707a;border-radius:5px;font:inherit}.illustration-dialog button,.illustration-dialog a.illustration-download{padding:8px 12px;color:#edf2f4;background:#2e444d;border:1px solid #6e8994;border-radius:6px;cursor:pointer;font:inherit;text-decoration:none}.illustration-dialog button:disabled{opacity:.5;cursor:default}.illustration-dialog .illustration-primary{background:#447369;font-weight:600}.illustration-dialog small{color:#aabfc8;font-size:12px}.illustration-dialog details{border-top:1px solid #415158;padding-top:10px}.illustration-dialog summary{cursor:pointer;margin-bottom:8px}.illustration-dialog progress{width:100%;height:9px;accent-color:#8ac2ac}.illustration-preview{position:relative;background:#0c1317;border-radius:7px;overflow:hidden;min-height:190px;display:grid;place-items:center}.illustration-preview img{display:block;width:100%;max-height:62vh;object-fit:contain;grid-area:1/1}.illustration-preview .illustration-result{position:absolute;inset:0;width:100%;height:100%;clip-path:inset(0 0 0 50%)}.illustration-preview .illustration-placeholder{padding:50px 20px;color:#b3c5cd;text-align:center}.illustration-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.illustration-status{white-space:pre-wrap;overflow-wrap:anywhere;min-height:40px}.illustration-status[role=alert]{color:#ffc6a7}.illustration-history{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.illustration-history button{padding:3px;width:76px;height:60px;overflow:hidden}.illustration-history img{width:100%;height:100%;object-fit:cover}.illustration-prompt{white-space:pre-wrap;max-height:180px;overflow:auto;font:12px/1.5 monospace;color:#bbced5}.illustration-dialog [hidden]{display:none!important}.illustration-trigger{cursor:pointer}@media(max-width:720px){.illustration-body{grid-template-columns:1fr;padding:14px}.illustration-preview img{max-height:42vh}.illustration-dialog{max-height:96vh}.illustration-fields{display:grid;grid-template-columns:1fr 1fr}.illustration-fields>details,.illustration-fields>.illustration-full{grid-column:1/-1}}`;

const resetCss = `.illustration-dialog{max-width:min(1120px,94vw)}.illustration-dialog label{align-items:stretch;justify-content:initial;width:100%;margin:0;text-align:left}.illustration-dialog input:not([type=range]),.illustration-dialog select,.illustration-dialog button,.illustration-dialog textarea{height:auto;min-height:36px;line-height:1.4;max-width:none;white-space:normal;text-indent:0}.illustration-dialog select{width:100%;min-width:0;font-size:14px}.illustration-dialog header{height:auto}.illustration-dialog .illustration-history button{height:60px}`;

export function serviceUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw Error('Utilisez une adresse locale http://127.0.0.1:port.');
  return url.origin;
}

export function targetSize(width, height, pixels = 786432) {
  const scale = Math.sqrt(pixels / (width * height));
  return { width: Math.max(16, Math.round(width * scale / 16) * 16), height: Math.max(16, Math.round(height * scale / 16) * 16) };
}

export async function dataUrl(blob) {
  return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error('Lecture de capture impossible.')); reader.readAsDataURL(blob); });
}

export async function canvasBlob(canvas) {
  return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('Capture indisponible.')), 'image/png'));
}

/** Freeze all canvas layers before the first await, then resolve SVG images from the frozen clone. */
export async function captureViewport(viewport, { exclude = [], structural = false } = {}) {
  viewport.querySelectorAll('[data-city-canvas]').forEach(host => host.dispatchEvent(new Event('illustration:capture')));
  const rect = viewport.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) throw Error('Vue inactive.');
  const size = targetSize(rect.width, rect.height, Math.min(2097152, rect.width * rect.height * Math.min(2, devicePixelRatio || 1) ** 2));
  const output = document.createElement('canvas'); Object.assign(output, size);
  const context = output.getContext('2d'); context.fillStyle = structural ? '#000' : getComputedStyle(viewport).backgroundColor; context.fillRect(0, 0, size.width, size.height);
  const layers = [], excluded = ['[data-illustration-exclude]', '.ruler-layer', ...exclude].join(',');
  for (const element of viewport.querySelectorAll('canvas,svg')) {
    if (element.closest(excluded) || element.closest('[hidden]') || element.parentElement?.closest('svg')) continue;
    if (element.checkVisibility && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const style = getComputedStyle(element), box = element.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden' || !box.width || !box.height || +style.opacity === 0) continue;
    if (element.tagName.toLowerCase() === 'canvas') {
      if (structural) continue;
      const frozen = document.createElement('canvas'); frozen.width = element.width; frozen.height = element.height;
      frozen.getContext('2d').drawImage(element, 0, 0);
      layers.push({ image: frozen, box, opacity: +style.opacity, filter: style.filter });
    } else {
      const clone = element.cloneNode(true); clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', String(box.width)); clone.setAttribute('height', String(box.height));
      clone.style.cssText = 'display:block;visibility:visible;position:static;background:transparent!important;';
      // Ancestor-dependent rules (e.g. the GPU layer hiding the SVG terrain) do not
      // survive a standalone SVG. Freeze those visibility decisions before serialization.
      const originals = element.querySelectorAll('*'), copies = clone.querySelectorAll('*');
      const livePaint = element.querySelectorAll('foreignObject'), copiedPaint = clone.querySelectorAll('foreignObject');
      originals.forEach((original, index) => { const computed = getComputedStyle(original); if (computed.display === 'none' || computed.visibility === 'hidden') copies[index]?.remove(); });
      copiedPaint.forEach((node, index) => {
        if (!clone.contains(node)) return;
        const paint = livePaint[index], box = paint.getBoundingClientRect();
        const canvases = [...paint.querySelectorAll('canvas')].filter(canvas => {
          const style = getComputedStyle(canvas);
          return canvas.width && canvas.height && style.display !== 'none' && style.visibility !== 'hidden' && +style.opacity > 0;
        });
        if (structural || !canvases.length || !box.width || !box.height) { node.remove(); return; }
        // The city host stacks GPU streets/blocks below 2D native roofs and labels.
        // Freeze every visible canvas, including a Canvas-only fallback.
        const composite = document.createElement('canvas');
        composite.width = Math.max(...canvases.map(canvas => canvas.width)); composite.height = Math.max(...canvases.map(canvas => canvas.height));
        const context = composite.getContext('2d');
        for (const canvas of canvases) {
          const rect = canvas.getBoundingClientRect(), style = getComputedStyle(canvas);
          context.save(); context.globalAlpha = +style.opacity; context.filter = style.filter;
          context.drawImage(canvas, (rect.left - box.left) / box.width * composite.width, (rect.top - box.top) / box.height * composite.height,
            rect.width / box.width * composite.width, rect.height / box.height * composite.height); context.restore();
        }
        const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
        for (const key of ['x', 'y', 'width', 'height']) image.setAttribute(key, node.getAttribute(key) || '0');
        image.setAttribute('href', composite.toDataURL('image/png')); node.replaceWith(image);
      });
      clone.querySelectorAll('[data-illustration-exclude],#cityPins,#pins,.selection,.selected-overlay,.ruler,text,foreignObject').forEach(node => node.remove());
      const definitions = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      definitions.textContent = [...document.styleSheets].flatMap(sheet => { try { return [...sheet.cssRules].map(rule => rule.cssText); } catch { return []; } }).join('\n');
      if (structural) {
        clone.querySelectorAll('image,#cityBackground,[data-layer="terrain"],.terrain').forEach(node => node.remove());
        definitions.textContent += '\n*{fill:none!important;stroke:white!important;stroke-opacity:1!important;opacity:1!important;filter:none!important}';
      }
      clone.prepend(definitions); layers.push({ svg: clone, box, opacity: +style.opacity });
    }
  }
  for (const layer of layers) {
    let image = layer.image;
    if (layer.svg) {
      for (const node of layer.svg.querySelectorAll('image')) {
        const href = node.getAttribute('href') || node.getAttribute('xlink:href');
        if (href && !href.startsWith('data:')) {
          const response = await fetch(new URL(href, document.baseURI));
          if (!response.ok) throw Error('Une image de la carte ne peut pas être capturée.');
          node.setAttribute('href', await dataUrl(await response.blob()));
        }
      }
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(layer.svg)], { type: 'image/svg+xml' }));
      try { image = await loadImage(url); } finally { URL.revokeObjectURL(url); }
    }
    context.save(); context.globalAlpha = layer.opacity; context.filter = layer.filter || 'none';
    context.drawImage(image, (layer.box.left - rect.left) / rect.width * size.width, (layer.box.top - rect.top) / rect.height * size.height, layer.box.width / rect.width * size.width, layer.box.height / rect.height * size.height); context.restore();
  }
  return canvasBlob(output);
}

function loadImage(url) { return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(Error('Image de capture illisible.')); image.src = url; }); }

export function mountIllustration({ host, capture, defaultService = 'http://127.0.0.1:8794' }) {
  if (!document.getElementById('illustration-css')) { const sheet = document.createElement('style'); sheet.id = 'illustration-css'; sheet.textContent = css + resetCss; document.head.append(sheet); }
  const button = document.createElement('button'); button.type = 'button'; button.className = 'illustration-trigger'; button.textContent = '✦ Illustrer'; button.title = 'Créer une illustration de cette vue'; host.append(button);
  const dialog = document.createElement('dialog'); dialog.className = 'illustration-dialog'; dialog.setAttribute('aria-label', 'Illustrer cette vue');
  dialog.innerHTML = `<header><h2>Illustrer cette vue</h2><button type="button" data-close aria-label="Fermer">✕</button></header><div class="illustration-body"><div class="illustration-fields">
    <label>Moteur<select name="mode"><option value="quality">Local · qualité · Z-Image Turbo</option><option value="fast">Local · aperçu · SDXL Lightning</option><option value="cloud">API externe</option></select></label>
    <label>Style<select name="style"></select></label><label>Fidélité<select name="fidelity"><option value="strong">Forte</option><option value="balanced">Équilibrée</option><option value="free">Libre</option></select></label>
    <label data-cloud hidden>Fournisseur<select name="provider"><option value="openai">OpenAI · GPT Image</option><option value="gemini">Google · Gemini Image</option></select></label>
    <label data-cloud hidden>Modèle<input name="model" spellcheck="false" value="gpt-image-2.5-sunburst"></label><label data-cloud hidden>Clé API personnelle<input name="apiKey" type="password" autocomplete="off" placeholder="Clé conservée pour cette session"></label>
    <label class="illustration-full">Instruction supplémentaire<textarea name="instruction" rows="3" placeholder="Lumière du matin, ambiance brumeuse…"></textarea></label>
    <details><summary>Réglages avancés</summary><label>Service local<input name="service" spellcheck="false"></label><button type="button" data-connect>Vérifier la connexion</button><small data-connection>Le connecteur local doit être démarré.</small>
    <label>Guide<select name="control"><option value="auto">Automatique</option><option value="edges">Contours</option><option value="depth">Profondeur</option><option value="both">Contours + profondeur · SDXL</option></select></label>
    <label>Résolution<select name="pixels"><option value="393216">0,4 MP · petit aperçu</option><option value="786432">0,8 MP · aperçu</option><option value="1048576" selected>1 MP</option><option value="2097152">2 MP · qualité</option></select></label>
    <label>Étapes<select name="steps"><option value="4">4 · aperçu Lightning</option><option value="8" selected>8 · recommandé</option></select></label><label>Seed<input name="seed" type="number" min="0" max="4294967295" placeholder="Aléatoire"></label></details>
    <small class="illustration-full" data-budget>Rapide : privilégie la latence. Premier chargement et téléchargement plus longs.</small><small class="illustration-full">La fidélité reste indicative. Les images générées peuvent modifier des détails de la carte.</small>
    <button type="button" class="illustration-primary illustration-full" data-generate>Générer l’illustration</button><button type="button" data-cancel hidden>Annuler</button></div>
    <div><div class="illustration-preview"><div class="illustration-placeholder">Préparation de la capture…</div><img data-source alt="Vue capturée" hidden><img data-result class="illustration-result" alt="Illustration générée" hidden></div>
    <label data-compare hidden>Original ↔ illustration<input type="range" min="0" max="100" value="50" aria-label="Comparer original et illustration"></label>
    <div class="illustration-actions"><button type="button" data-recapture>Capturer la vue actuelle</button><button type="button" data-source-download hidden>Source PNG</button><button type="button" data-download hidden>Illustration PNG</button><button type="button" data-recipe hidden>Recette JSON</button></div>
    <progress value="0" max="1" hidden></progress><div class="illustration-status" role="status" aria-live="polite"></div>
    <details><summary>Description et prompt</summary><p data-scene-description></p><small data-prompt-state>Template automatique</small><pre class="illustration-prompt"></pre><textarea data-prompt-editor rows="10" aria-label="Prompt complet" spellcheck="false" hidden></textarea><small>Les templates suivent le style choisi. Vos modifications sont conservées pour chaque combinaison de réglages, pendant cette session. L’image de référence reste jointe.</small><div class="illustration-actions"><button type="button" data-prompt-edit>Modifier le prompt</button><button type="button" data-prompt-reset>Revenir au template</button><button type="button" data-prompt-preview>Actualiser le prompt</button></div></details><details data-history><summary>Historique local</summary><div class="illustration-history"></div></details></div></div>`;
  document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector), field = name => $(`[name="${name}"]`);
  for (const [value, label] of styles) field('style').add(new Option(label, value));
  let preferences = {}; try { preferences = JSON.parse(localStorage.getItem('magna-illustration-settings') || '{}'); } catch {}
  field('service').value = preferences.service || defaultService;
  for (const name of ['mode', 'style', 'fidelity', 'provider', 'model', 'control', 'pixels', 'steps']) if (preferences[name] !== undefined) field(name).value = preferences[name];
  let snapshot, activeId, activeServer, timer, previewTimer, previewTicket = 0, captureTicket = 0, disposed = false, metadata, busy = false;
  const promptDrafts = new Map();
  const promptKey = () => JSON.stringify(['mode', 'style', 'fidelity', 'instruction'].map(name => field(name).value));
  const objectUrls = new Map();
  const setImage = (selector, blob) => { const image = $(selector); if (objectUrls.has(selector)) URL.revokeObjectURL(objectUrls.get(selector)); const url = URL.createObjectURL(blob); objectUrls.set(selector, url); image.src = url; image.hidden = false; };
  const status = (message, error = false) => { $('.illustration-status').textContent = message; $('.illustration-status').setAttribute('role', error ? 'alert' : 'status'); };
  const settings = () => ({ ...Object.fromEntries(['mode', 'style', 'fidelity', 'provider', 'model', 'control', 'pixels', 'steps', 'instruction', 'seed'].map(name => [name, field(name).value]).filter(([name, value]) => name !== 'seed' || value !== '')),
    ...(promptDrafts.has(promptKey()) ? { promptOverride: promptDrafts.get(promptKey()) } : {}) });
  const renderPrompt = prompt => { $('.illustration-prompt').textContent = prompt; $('[data-prompt-editor]').value = prompt; };
  const api = async (path, options = {}, server = serviceUrl(field('service').value)) => {
    let response;
    try { response = await fetch(server + path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(12000) }); }
    catch (error) {
      throw Error(`Connecteur d’illustration injoignable à ${server}. Depuis web/, lancez npm run illustration:serve, ou relancez start-terrainbench.bat. ${error.name === 'TimeoutError' ? 'Délai de connexion dépassé.' : 'Vérifiez aussi l’autorisation d’accès au réseau local du navigateur.'}`);
    }
    const result = await response.json(); if (!response.ok) throw Error(result.error || `Service HTTP ${response.status}`); return result;
  };
  async function previewPrompt() {
    if (!snapshot || busy || disposed) return;
    const ticket = ++previewTicket, source = snapshot;
    try {
      const result = await api('/v1/illustrations/prompt', { method: 'POST', body: JSON.stringify({ version: 1, context: source.context, settings: settings() }) });
      if (ticket !== previewTicket || source !== snapshot || disposed || busy) return;
      $('[data-scene-description]').textContent = result.description;
      renderPrompt(result.prompt); sync();
    } catch {
      if (ticket === previewTicket && source === snapshot && !disposed && !busy) $('.illustration-prompt').textContent = 'Démarrez ou mettez à jour le connecteur local pour prévisualiser le prompt rédigé.';
    }
  }
  const schedulePreview = () => {
    ++previewTicket; clearTimeout(previewTimer);
    if (promptDrafts.has(promptKey())) renderPrompt(promptDrafts.get(promptKey()));
    sync(); previewTimer = setTimeout(previewPrompt, 250);
  };
  function sync() {
    const mode = field('mode').value;
    dialog.querySelectorAll('[data-cloud]').forEach(node => node.hidden = mode !== 'cloud');
    field('control').disabled = mode === 'cloud' || busy;
    field('steps').disabled = mode !== 'fast' || busy;
    if (mode === 'quality') field('steps').value = '8';
    if (mode === 'fast' && +field('pixels').value > 1048576) field('pixels').value = '786432';
    for (const option of field('pixels').options) option.disabled = mode === 'fast' && +option.value > 1048576;
    for (const option of field('control').options) option.disabled = (['depth', 'both'].includes(option.value) && !snapshot?.guides?.depth) || (option.value === 'both' && mode !== 'fast');
    if (field('control').selectedOptions[0]?.disabled) field('control').value = 'auto';
    $('[data-budget]').textContent = mode === 'fast' ? 'SDXL Lightning + ControlNet : aperçu rapide. Privilégiez 8 étapes et 1 MP ; choisissez Z-Image pour un rendu plus détaillé.' : mode === 'quality' ? 'Z-Image Turbo + ControlNet : 8 étapes, 1 MP recommandé. La génération peut prendre plusieurs dizaines de secondes ou davantage.' : 'La capture et son contexte seront envoyés au fournisseur choisi. Votre compte API est facturé par ce fournisseur.';
    $('[data-generate]').disabled = !snapshot || busy || (promptDrafts.has(promptKey()) && !promptDrafts.get(promptKey()).trim()); $('[data-recapture]').disabled = busy; $('[data-cancel]').hidden = !busy;
    $('[data-prompt-preview]').disabled = !snapshot || busy;
    $('[data-prompt-edit]').disabled = !snapshot || busy; $('[data-prompt-editor]').disabled = busy;
    $('[data-prompt-editor]').maxLength = { fast: 3000, quality: 6000, cloud: 28000 }[mode];
    $('[data-prompt-reset]').disabled = busy || !promptDrafts.has(promptKey());
    $('[data-prompt-state]').textContent = promptDrafts.has(promptKey()) ? 'Prompt personnalisé · texte transmis tel que modifié' : 'Template automatique · ' + (styles.find(([key]) => key === field('style').value)?.[1] || 'Style de la vue');
    field('mode').disabled = busy; field('service').disabled = busy;
  }
  async function recapture() {
    const ticket = ++captureTicket; snapshot = undefined; metadata = undefined; sync(); status('Capture de la vue…');
    $('[data-result]').hidden = true; $('[data-compare]').hidden = true; $('[data-download]').hidden = true; $('[data-recipe]').hidden = true;
    try {
      const captured = await capture(); if (disposed || ticket !== captureTicket) return;
      if (!(captured.image instanceof Blob)) throw Error('Capture invalide.');
      snapshot = { ...captured, context: structuredClone(captured.context), guides: { ...captured.guides } };
      setImage('[data-source]', snapshot.image); $('.illustration-placeholder').hidden = true; $('[data-source-download]').hidden = false;
      $('[data-scene-description]').textContent = ''; $('.illustration-prompt').textContent = 'Préparation de la description et du prompt…'; status('Capture prête.'); sync(); void previewPrompt();
    } catch (error) { if (ticket === captureTicket) { status(error.message, true); sync(); } }
  }
  async function history() {
    const server = serviceUrl(field('service').value), result = await api('/v1/illustrations/jobs', {}, server), container = $('.illustration-history'); container.replaceChildren();
    for (const job of result.jobs.filter(job => job.status === 'succeeded')) {
      const item = document.createElement('button'); item.type = 'button'; item.title = `${new Date(job.createdAt * 1000).toLocaleString()} · ${job.resolvedStyle}`;
      const image = document.createElement('img'); image.src = `${server}/v1/illustrations/jobs/${job.id}/result.png`; image.alt = job.resolvedStyle; image.loading = 'lazy'; item.append(image);
      item.onclick = async () => {
        if (busy) return; ++captureTicket; busy = true; sync();
        try { await showResult(job, server, true); } catch (error) { status(error.message, true); }
        finally { busy = false; sync(); }
      }; container.append(item);
    }
  }
  async function showResult(job, server, fromHistory = false) {
    const response = await fetch(`${server}/v1/illustrations/jobs/${job.id}/result.png`); if (!response.ok) throw Error('Illustration indisponible.');
    setImage('[data-result]', await response.blob());
    if (fromHistory) {
      const response = await fetch(`${server}/v1/illustrations/jobs/${job.id}/source.png`); if (!response.ok) throw Error('Source indisponible.');
      const image = await response.blob(); snapshot = { image, context: job.context, guides: {} }; setImage('[data-source]', image); $('.illustration-placeholder').hidden = true;
      if (job.settings.provider && job.settings.provider !== field('provider').value) switchCredentialProvider(job.settings.provider);
      for (const name of ['mode', 'style', 'fidelity', 'provider', 'model', 'control', 'pixels', 'steps', 'instruction', 'seed']) if (job.settings[name] !== undefined) field(name).value = String(job.settings[name]);
      if (typeof job.settings.promptOverride === 'string') promptDrafts.set(promptKey(), job.settings.promptOverride);
      // Reload only guides whose stored image matches the source, otherwise derive contours again.
      for (const kind of ['edges', 'depth']) {
        const guide = await fetch(`${server}/v1/illustrations/jobs/${job.id}/${kind}.png`); if (guide.ok) snapshot.guides[kind] = await guide.blob();
      }
    }
    metadata = job; $('[data-compare]').hidden = false; $('[data-download]').hidden = false; $('[data-recipe]').hidden = false;
    $('[data-scene-description]').textContent = job.description || '';
    renderPrompt(job.settings.mode === 'cloud' ? job.prompt : job.localPrompt || job.prompt);
    status(`Illustration terminée · ${job.totalSeconds}s · ${job.outputSize.join(' × ')} px`); sync();
  }
  async function poll() {
    if (!activeId || disposed) return;
    try {
      const job = await api(`/v1/illustrations/jobs/${activeId}`, {}, activeServer); status(job.message, job.status === 'failed'); $('progress').value = job.progress;
      if (terminal.has(job.status)) {
        activeId = undefined; $('progress').hidden = true;
        try { if (job.status === 'succeeded') { await showResult(job, activeServer); void history().catch(() => {}); } }
        finally { busy = false; sync(); }
        return;
      }
    } catch (error) { status(`Connexion interrompue : ${error.message}\nLa génération continue sur le service ; reconnexion automatique…`, true); }
    timer = setTimeout(poll, 1000);
  }
  async function generate() {
    if (!snapshot || busy) return;
    busy = true; sync(); $('progress').hidden = false; $('progress').value = 0; status('Envoi de la capture…');
    try {
      activeServer = serviceUrl(field('service').value);
      const info = await connection();
      if (field('mode').value !== 'cloud' && !info.localDependencies) throw Error('Dépendances de diffusion absentes. Depuis web/, lancez npm run illustration:setup, puis redémarrez le connecteur.');
      const chosen = settings(), guides = {};
      for (const [kind, blob] of Object.entries(snapshot.guides || {})) guides[kind] = await dataUrl(blob);
      const job = await api('/v1/illustrations/jobs', { method: 'POST', body: JSON.stringify({ version: 1, image: await dataUrl(snapshot.image), guides, context: snapshot.context, settings: chosen, apiKey: field('apiKey').value }) }, activeServer);
      const stored = { ...chosen, service: activeServer }; delete stored.instruction; delete stored.seed; delete stored.promptOverride;
      try { localStorage.setItem('magna-illustration-settings', JSON.stringify(stored)); } catch {}
      activeId = job.id; await poll();
    } catch (error) { busy = false; $('progress').hidden = true; status(error.message, true); sync(); }
  }
  const download = (blob, name) => { const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); };
  button.onclick = () => { dialog.showModal(); if (!busy) { void recapture(); void connection().then(history).catch(() => {}); } };
  $('[data-close]').onclick = () => dialog.close(); $('[data-recapture]').onclick = () => void recapture(); $('[data-generate]').onclick = () => void generate();
  $('[data-prompt-preview]').onclick = () => void previewPrompt();
  $('[data-prompt-edit]').onclick = () => {
    const editor = $('[data-prompt-editor]'); editor.hidden = !editor.hidden; $('.illustration-prompt').hidden = !editor.hidden;
    $('[data-prompt-edit]').textContent = editor.hidden ? 'Modifier le prompt' : 'Fermer l’éditeur';
    if (!editor.hidden) { editor.value = $('.illustration-prompt').textContent; editor.focus(); }
  };
  $('[data-prompt-editor]').oninput = event => {
    ++previewTicket; clearTimeout(previewTimer); promptDrafts.set(promptKey(), event.target.value);
    $('.illustration-prompt').textContent = event.target.value; sync();
  };
  $('[data-prompt-reset]').onclick = () => { promptDrafts.delete(promptKey()); sync(); void previewPrompt(); };
  for (const name of ['style', 'fidelity', 'instruction', 'mode', 'service']) field(name).addEventListener('input', schedulePreview);
  $('[data-cancel]').onclick = async () => { if (!activeId) return; try { await api(`/v1/illustrations/jobs/${activeId}/cancel`, { method: 'POST' }, activeServer); } catch (error) { status(error.message, true); } };
  async function connection() {
    try {
      const info = await api('/status');
      if (info.service !== 'magna-illustration' || info.protocol !== 1) throw Error('Service incompatible : démarrez le connecteur de cette version de Magna Urbis.');
      $('[data-connection]').textContent = info.localDependencies ? 'Connecté · SDXL Lightning / Z-Image Turbo (CUDA requis).' : 'Connecté · API disponible ; lancez npm run illustration:setup pour les modèles locaux.';
      return info;
    } catch (error) { $('[data-connection]').textContent = error.message; throw error; }
  }
  $('[data-connect]').onclick = () => void connection().then(history).catch(error => status(error.message, true));
  $('[data-source-download]').onclick = () => snapshot && download(snapshot.image, 'illustration-source.png');
  $('[data-download]').onclick = async () => { const response = await fetch($('[data-result]').src); download(await response.blob(), `illustration-${metadata.id}.png`); };
  $('[data-recipe]').onclick = () => metadata && download(new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' }), `illustration-${metadata.id}.json`);
  $('[data-compare] input').oninput = event => { $('[data-result]').style.clipPath = `inset(0 0 0 ${event.target.value}%)`; };
  const credentials = new Map(); let previousProvider = field('provider').value;
  function switchCredentialProvider(provider) {
    credentials.set(previousProvider, field('apiKey').value); previousProvider = provider;
    field('apiKey').value = credentials.get(previousProvider) || '';
  }
  field('mode').onchange = sync; field('provider').onchange = () => {
    switchCredentialProvider(field('provider').value);
    field('model').value = previousProvider === 'openai' ? 'gpt-image-2.5-sunburst' : 'gemini-3.1-flash-image';
  };
  sync();
  return { button, dialog, open: () => button.click(), dispose() { disposed = true; clearTimeout(timer); clearTimeout(previewTimer); ++captureTicket; ++previewTicket; objectUrls.forEach(url => URL.revokeObjectURL(url)); dialog.remove(); button.remove(); } };
}
