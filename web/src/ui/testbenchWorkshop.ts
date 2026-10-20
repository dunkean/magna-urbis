
/** Presentation only: retain all existing controls, IDs, handlers and seeds. */
export function installWorkshopSkin(): void {
  document.body.classList.add('urban-workshop');
  const masthead = document.createElement('div'); masthead.className = 'workshop-masthead';
  masthead.innerHTML = '<div class="workshop-wordmark">MAGNA URBIS<span>ATELIER URBAIN</span></div><div><small>COMPOSITION ET DESSERTE</small><h1>Quartiers &amp; parcelles</h1></div><span class="workshop-engine">RUST · WASM</span>';
  const layout = document.createElement('div'); layout.className = 'workshop-layout';
  const controls = document.createElement('section'); controls.className = 'workshop-controls'; controls.setAttribute('aria-label', 'Réglages de l’atelier');
  for (const selector of ['header', '#stages', '#advanced', '#reproduction']) {
    const element = document.querySelector(selector); if (element) controls.append(element);
  }
  const header = controls.querySelector('header')!;
  const primary = document.createElement('div'); primary.className = 'workshop-primary-controls';
  for (const id of ['mode', 'culture', 'recipe', 'zone']) {
    const label = header.querySelector(`#${id}`)?.closest('label'); if (label) primary.append(label);
  }
  const context = document.createElement('details'); context.className = 'workshop-context';
  context.innerHTML = '<summary>Contexte · forme, relief et contraintes</summary>';
  header.before(primary, context); context.append(header);
  header.querySelector('strong')?.remove();
  const preview = document.createElement('section'); preview.className = 'workshop-preview'; preview.setAttribute('aria-label', 'Plan et mesures');
  for (const selector of ['#status', 'main']) { const element = document.querySelector(selector); if (element) preview.append(element); }
  layout.append(controls, preview); document.body.prepend(masthead, layout);
}
