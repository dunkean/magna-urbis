import type { World, Vec2 } from '../gen/types';
import type { V2Settings } from './contracts';
import { onLanguageChange, translate, registerMessages } from './i18n';
import { getDistanceUnit, unitFactor, onUnitsChange } from './units';
import { mapPresentation } from './mapPresentation';
import { labelCandidates, type LabelCandidate, type LabelEdit } from './mapLabels';
import { TOPONYM_PROFILES } from '../gen/names/profiles';
import { varyNames } from '../gen/names/policy';

/** Host performs the redraw and forwards map clicks while active. */
export function mountMapLabelEditor(host: HTMLElement, api: { getWorld(): World | undefined; getSettings(): V2Settings; onChange(): void; onNames?():void }): {
  sync(): void; active(): boolean; stop(): void; pick(point: Vec2): void; start(): void
} {
  const box = document.createElement('section'); box.className = 'map-label-editor';
  box.style.cssText = 'display:grid;gap:.55rem;margin:1rem 0;padding:.8rem;border:1px solid #aa9368;border-radius:.65rem;background:rgba(30,37,37,.28)';
  host.append(box);
  const title = document.createElement('strong'), search = document.createElement('input'), filter = document.createElement('select'), select = document.createElement('select');
  const input = document.createElement('input'), x = document.createElement('input'), y = document.createElement('input');
  const mode=document.createElement('select'),profile=document.createElement('select'),regenerate=document.createElement('button');
  mode.id='map-label-edit-mode';profile.id='map-label-profile';regenerate.type='button';
  const color = document.createElement('input'), size = document.createElement('input'), bold = document.createElement('input'), italic = document.createElement('input');
  const create = document.createElement('button'), locate = document.createElement('button'), choose = document.createElement('button'), remove = document.createElement('button'), hint = document.createElement('small'), count = document.createElement('small');
  search.type = 'search'; input.maxLength = 200; x.type = y.type = 'number'; x.step = y.step = 'any'; color.type = 'color'; size.type = 'number'; size.min = '.25'; size.max = '4'; size.step = '.1'; bold.type = italic.type = 'checkbox';
  for (const button of [create, locate, choose, remove]) button.type = 'button';
  const row = (...nodes: HTMLElement[]) => { const div = document.createElement('div'); div.style.cssText = 'display:flex;gap:.4rem;align-items:center;flex-wrap:wrap'; div.append(...nodes); return div; };
  const label = (control: HTMLElement) => { const l = document.createElement('label'); l.style.cssText = 'display:flex;gap:.3rem;align-items:center'; l.append(control); return l; };
  const lx = label(x), ly = label(y), lc = label(color), ls = label(size), lb = label(bold), li = label(italic);
  for (const n of [search, filter, select, input]) n.style.cssText = 'width:100%;min-width:0';
  for (const n of [x,y,size]) n.style.width = '5.5rem';
  box.append(title, filter, search, select, count, mode,input,profile,regenerate, row(lx,ly), row(lc,ls,lb,li), row(create,choose,locate,remove), hint);
  let candidates: LabelCandidate[] = [], selected = '', picking: 'place' | 'select' | undefined;
  const t = (fr:string,en:string) => {registerMessages({[en]:{en,fr}});return translate(en);};
  function locale(): void {
    title.textContent=t('Noms et étiquettes','Names and labels'); search.placeholder=t('Rechercher un nom, un quartier, une parcelle ou un bâtiment','Search names, districts, parcels or buildings');
    input.placeholder=t('Texte de l’étiquette','Label text'); create.textContent=t('+ Étiquette libre','+ Free label'); choose.textContent=picking === 'select' ? t('Annuler la sélection','Cancel selection') : t('Sélectionner sur la carte','Select on map'); locate.textContent=picking === 'place'?t('Annuler le placement','Cancel placement'):t('Placer sur la carte','Place on map'); remove.textContent=t('Effacer la modification','Clear edit');
    const editMode=mode.value||'label';mode.replaceChildren(new Option(t('Texte libre complet','Complete free text'),'label'),new Option(t('Nom propre et références','Proper name and references'),'proper'));mode.value=editMode;mode.setAttribute('aria-label',t('Mode de renommage','Renaming mode'));
    const profileValue=profile.value;profile.replaceChildren(new Option(t('Hériter du profil du quartier ou de la ville','Inherit quarter or city profile'),''),...TOPONYM_PROFILES.map(p=>new Option(p.id.replaceAll('-',' '),p.id)));profile.value=profileValue;profile.setAttribute('aria-label',t('Profil de ce lieu','This place’s profile'));
    regenerate.textContent=t('Générer un autre nom pour cet élément','Generate another name for this item');
    hint.textContent=t('Sélectionnez un élément, modifiez son texte puis placez-le sur la carte. Les modifications sont enregistrées dans le projet.','Select an item, edit its text, then place it on the map. Edits are saved in the project.');
    const caption = (el: HTMLElement, text: string) => { if (el.lastChild?.nodeType === Node.TEXT_NODE) el.lastChild.textContent = text; else el.append(document.createTextNode(text)); };
    caption(lx,` X (${getDistanceUnit()})`); caption(ly,` Y (${getDistanceUnit()})`); caption(lc,t(' Couleur',' Colour')); caption(ls,t(' Taille',' Size')); caption(lb,t(' Gras',' Bold')); caption(li,t(' Italique',' Italic'));
    search.setAttribute('aria-label',search.placeholder); select.setAttribute('aria-label',t('Élément à nommer','Item to name')); input.setAttribute('aria-label',input.placeholder);
    filter.setAttribute('aria-label',t('Type d’élément','Item type'));
    const value=filter.value || 'all'; filter.replaceChildren();
    for (const [id, text] of [['all',t('Tous les noms','All names')],['district',t('Districts et quartiers','Districts & quarters')],['parcel',t('Parcelles','Parcels')],['building',t('Bâtiments','Buildings')],['free',t('Étiquettes libres','Free labels')]]) filter.add(new Option(text,id));
    filter.value=value;
    x.setAttribute('aria-label',t('Position X','X position')); y.setAttribute('aria-label',t('Position Y','Y position')); color.setAttribute('aria-label',t('Couleur du texte','Text colour')); size.setAttribute('aria-label',t('Taille du texte','Text size')); bold.setAttribute('aria-label',t('Texte en gras','Bold text')); italic.setAttribute('aria-label',t('Texte en italique','Italic text'));
  }
  const edits = () => { const s = api.getSettings(); s.naming ??= {}; return s.naming.labels ??= {}; };
  const matchesType = (candidate: LabelCandidate): boolean => filter.value === 'all' || (filter.value === 'district' ? candidate.kind === 'district' || candidate.kind === 'quarter' : candidate.kind === filter.value || (filter.value === 'free' && candidate.id.startsWith('free:')));
  function populate(): void {
    const term = search.value.trim().toLocaleLowerCase(), previous = selected;
    select.replaceChildren();
    let shown = 0, matches = 0;
    for (const candidate of candidates) {
      if (!matchesType(candidate)) continue;
      const value = edits()[candidate.id]?.text || candidate.text;
      const name = `${candidate.kind} · ${value || candidate.id}`;
      if (term && !name.toLocaleLowerCase().includes(term) && candidate.id !== previous) continue;
      matches++;
      if (shown >= 200 && candidate.id !== previous) continue;
      select.add(new Option(name, candidate.id));
      shown++;
    }
    count.textContent = matches > shown ? t('{shown} sur {matches} résultats · affinez la recherche', '{shown} of {matches} results · refine the search').replace('{shown}',String(shown)).replace('{matches}',String(matches)) : `${matches}`;
    if (previous && Array.from(select.options).some(option => option.value === previous)) select.value = previous;
    else selected = select.value;
  }
  function fields(): void {
    const candidate = candidates.find(c => c.id === selected), edit = edits()[selected], anchor = edit?.anchor ?? candidate?.anchor;
    const value=(field:HTMLInputElement,next:string)=>{if(document.activeElement!==field)field.value=next;};
    const entry=api.getWorld()?.names?.entries.find(e=>e.id===selected);
    if(document.activeElement!==mode)mode.value=edit?.mode??mode.value??'label';
    value(input,edit?.text ?? (mode.value==='proper'?entry?.parts?.proper:undefined) ?? candidate?.text ?? '');value(x,anchor ? String(Math.round(anchor.x/unitFactor(getDistanceUnit())*100)/100) : '');value(y,anchor ? String(Math.round(anchor.y/unitFactor(getDistanceUnit())*100)/100) : '');
    profile.value=api.getSettings().naming?.features?.[selected]?.profile??'';
    profile.disabled=regenerate.disabled=mode.disabled=!entry;
    value(color,edit?.style?.color ?? '#493c2b');value(size,String(edit?.style?.size ?? 1));
    if(document.activeElement!==bold)bold.checked=!!edit?.style?.bold;
    if(document.activeElement!==italic)italic.checked=!!edit?.style?.italic;
    for (const el of [input,x,y,color,size,bold,italic,locate,remove]) el.disabled = !candidate;
  }
  function write(position = false, textChanged=false): void {
    const candidate = candidates.find(c => c.id === selected); if (!candidate) return;
    const old = edits()[selected], xx = Number(x.value)*unitFactor(getDistanceUnit()), yy = Number(y.value)*unitFactor(getDistanceUnit());
    const edit: LabelEdit = { ...old, ...(textChanged?{text:input.value.slice(0,200),mode:mode.value as 'label'|'proper'}:{}), style: { color: color.value, size: Math.max(.25,Math.min(4,Number(size.value)||1)), bold: bold.checked, italic: italic.checked } };
    if (position && x.value !== '' && y.value !== '' && Number.isFinite(xx) && Number.isFinite(yy)) edit.anchor = { x:xx, y:yy };
    if (candidate.kind === 'free' || selected.startsWith('free:')) edit.kind = 'free';
    else if (candidate.kind === 'quarter' || candidate.kind === 'parcel' || candidate.kind === 'building') edit.kind = candidate.kind;
    edits()[selected] = edit; api.onChange();
  }
  function stop(): void { picking = undefined; locale(); }
  function start(): void { if (!selected) return; picking = 'place'; window.dispatchEvent(new CustomEvent('v2-edit-mode', { detail:'labels' })); locale(); }
  window.addEventListener('v2-edit-mode', e => { if ((e as CustomEvent).detail !== 'labels') stop(); });
  search.addEventListener('input',()=>{populate();fields();}); filter.addEventListener('change',()=>{populate();fields();}); select.addEventListener('change',()=>{ selected=select.value; fields(); });
  input.addEventListener('change',()=>write(false,true)); for (const el of [color,size,bold,italic]) el.addEventListener('change',()=>write());
  mode.onchange=fields;
  profile.onchange=()=>{const settings=api.getSettings();settings.naming??={};settings.naming.features??={};if(profile.value)settings.naming.features[selected]={...settings.naming.features[selected],profile:profile.value};else delete settings.naming.features[selected];(api.onNames??api.onChange)();};
  regenerate.onclick=()=>{const settings=api.getSettings();settings.naming??={};varyNames(settings.naming,`feature:${selected}`);(api.onNames??api.onChange)();};
  for (const el of [x,y]) el.addEventListener('change',()=>write(true));
  create.onclick = () => {
    const world = api.getWorld(); if (!world) return;
    const id = `free:${crypto.randomUUID()}`, anchor = world.site?.center ?? { x:0, y:0 };
    edits()[id] = { kind:'free', text:t('Nouvelle étiquette','New label'), anchor };
    candidates.push({ id, kind:'free', text:edits()[id].text!, anchor }); selected=id; filter.value='all'; search.value=''; populate(); fields(); api.onChange(); start();
  };
  locate.onclick = () => picking === 'place' ? stop() : start();
  choose.onclick = () => { if (picking === 'select') { stop(); return; } picking='select'; window.dispatchEvent(new CustomEvent('v2-edit-mode',{detail:'labels'})); locale(); };
  remove.onclick = () => { delete edits()[selected]; api.onChange(); };
  const sync = () => { const world=api.getWorld(); create.disabled = choose.disabled = !world; candidates=world ? labelCandidates(mapPresentation(world,api.getSettings())) : []; populate(); fields(); };
  onLanguageChange(()=>{locale();sync();}); onUnitsChange(()=>{locale();fields();}); locale();
  return { sync, active:()=>!!picking, stop, start,
    pick(point) { if (!picking || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      if (picking === 'select') { let best: LabelCandidate | undefined, distance=(api.getWorld()?.mapSize ?? 0)*.03; const saved=api.getSettings().naming?.labels;
        for (const candidate of candidates) { if (!matchesType(candidate)) continue; const anchor=saved?.[candidate.id]?.anchor ?? candidate.anchor; const d=Math.hypot(anchor.x-point.x,anchor.y-point.y); if (d<distance) {distance=d;best=candidate;} }
        if (best) {selected=best.id;search.value='';populate();fields();} }
      else if (selected) { x.value=String(point.x/unitFactor(getDistanceUnit())); y.value=String(point.y/unitFactor(getDistanceUnit())); write(true); } stop(); } };
}
