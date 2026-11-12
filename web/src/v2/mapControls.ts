import type { World } from '../gen/types';
import type { V2Settings } from './contracts';
import { registerMessages, setText, translate } from './i18n';
import { mountParameterForm } from './parameterForm';
import { TOPONYM_PROFILES, resolveToponymProfile } from '../gen/names/profiles';
import { varyNames } from '../gen/names/policy';
import { LANGUAGES } from './languages';
import type { NamingPolicy } from '../gen/names/types';

const copy = (en: string, fr: string) => { registerMessages({ [en]: { en, fr } }); return en; };
const T = {
  title: copy('Map title', 'Titre de la carte'), apply: copy('Apply names', 'Appliquer les noms'),
  places: copy('Place names', 'Noms des lieux'), generated: copy('Generated name', 'Nom généré'),
  empty: copy('Place settlements to edit their names.', 'Implantez les peuplements pour modifier leurs noms.'),
  main: copy('Main settlement', 'Lieu principal'),
  mode: copy('Place-name presentation', 'Présentation des toponymes'),
  cultural: copy('Full cultural names', 'Culture intégrale'),
  localized: copy('Generic terms in interface language', 'Éléments génériques dans la langue de l’interface'),
  presentationHint: copy('Cultural names; generic terms follow the interface language.', 'Noms culturels ; les éléments génériques suivent la langue de l’interface.'),
  export: copy('Choose format and export…', 'Choisir le format et exporter…'),
};

export function mountMapControls(namingHost: HTMLElement, exportHost: HTMLElement, b: {
  getSettings(): V2Settings; getWorld(): World | undefined; busy(): boolean; onNames(): void; onExport(): void;
}): { sync(): void } {
  const formHost = document.createElement('div'); namingHost.append(formHost);
  const scope=document.createElement('select'),scopeLabel=document.createElement('label');
  scope.id='map-naming-scope';scopeLabel.className='parameter-field';
  const scopeCaption=document.createElement('span');setText(scopeCaption,copy('Naming scope','Portée des réglages de noms'));scopeLabel.append(scopeCaption,scope);namingHost.prepend(scopeLabel);
  const policy=():NamingPolicy=>{const n=b.getSettings().naming;if(scope.value==='region')return n?.region ?? {};if(scope.value.startsWith('city:'))return n?.local?.[scope.value.slice(5)] ?? {};return n ?? {};};
  const writePolicy=():NamingPolicy=>{const s=b.getSettings();s.naming??={};if(scope.value==='region')return s.naming.region??={};if(scope.value.startsWith('city:')){s.naming.local??={};return s.naming.local[scope.value.slice(5)]??={};}return s.naming;};
  const form = mountParameterForm(formHost, [
    { path: 'title', id: 'map-title-input', type: 'text', label: T.title, optional: true, placeholder: T.generated },
    { path: 'mode', id: 'map-naming-mode', type: 'select', label: T.mode,
      options: [{ value: 'cultural', label: T.cultural }, { value: 'localized', label: T.localized }] },
    {path:'profile',id:'map-naming-profile',type:'select',label:copy('Name profile','Profil des noms'),optional:true,emptyLabel:copy('Inherit from culture','Hériter de la culture'),options:TOPONYM_PROFILES.map(p=>({value:p.id,label:p.id.replaceAll('-',' ')}))},
    {path:'source',id:'map-naming-source',type:'select',label:copy('Name source','Source des noms'),optional:true,emptyLabel:copy('Inherit','Hériter'),options:[['auto','Profile default','Selon le profil'],['geographic','Real geographic names','Noms géographiques réels'],['invented','Invented names','Noms inventés'],['mixed','Real and invented names','Noms réels et inventés']].map(([value,en,fr])=>({value,label:copy(en,fr)}))},
    {path:'mapLanguage',id:'map-naming-language',type:'select',label:copy('Map language','Langue de la carte'),options:[{value:'ui',label:copy('Interface language','Langue de l’interface')},...LANGUAGES.map(l=>({value:l.code,label:l.name}))]},
    {path:'script',id:'map-naming-script',type:'select',label:copy('Name writing','Écriture des noms'),options:[{value:'source',label:copy('Source writing','Écriture de la source')},{value:'latin',label:copy('Latin reading when available','Lecture latine si disponible')}]},
  ], {
    getValue: path => path === 'title' ? b.getSettings().naming?.title ?? '' : path==='profile'||path==='source' ? policy()[path] ?? '' : path==='mapLanguage' ? b.getSettings().naming?.mapLanguage ?? 'ui' : path==='script' ? b.getSettings().naming?.script ?? 'source' : b.getSettings().naming?.mode ?? 'localized',
    setValue: (path, value) => {
      const settings = b.getSettings();
      if(path==='profile'||path==='source'){const p=writePolicy();if(value)Object.assign(p,{[path]:value});else delete p[path];}
      else if(path==='mapLanguage'||path==='script'){settings.naming??={};Object.assign(settings.naming,{[path]:value});}
      else if (path === 'mode') {
        settings.naming ??= {};
        settings.naming.mode = value as 'cultural' | 'localized';
        delete settings.naming.displayLanguage;
      }
      else { settings.naming ??= {}; settings.naming.title = String(value ?? '').trim().slice(0, 200); }
      b.onNames();
    }, disabled: b.busy,
  });
  formHost.querySelector<HTMLInputElement>('#map-title-input')!.maxLength = 200;
  const presentationHint = document.createElement('p'); presentationHint.className = 'hint'; setText(presentationHint, T.presentationHint); namingHost.append(presentationHint);
  const sourceHint=document.createElement('p');sourceHint.className='hint';namingHost.append(sourceHint);
  const regenerate=document.createElement('button');regenerate.type='button';regenerate.id='map-naming-regenerate';setText(regenerate,copy('Generate other names in this scope','Générer d’autres noms dans cette portée'));
  regenerate.onclick=()=>{const s=b.getSettings();s.naming??={};varyNames(s.naming,scope.value||'all');b.onNames();};namingHost.append(regenerate);
  scope.onchange=()=>{form.sync();sync();};
  const heading = document.createElement('p'); heading.className = 'hint'; setText(heading, T.places); namingHost.append(heading);
  const places = document.createElement('div'); places.className = 'map-place-names'; namingHost.append(places);
  const apply = document.createElement('button'); apply.type = 'button'; apply.id = 'map-names-apply'; setText(apply, T.apply); apply.onclick = b.onNames; namingHost.append(apply);
  const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.id = 'map-export-open'; exportButton.className = 'primary'; setText(exportButton, T.export); exportButton.onclick = b.onExport; exportHost.append(exportButton);
  let keys = '', inputs: { key: string; input: HTMLInputElement }[] = [];
  function sync(): void {
    const scopeValue=scope.value||'all';scope.replaceChildren(new Option(translate(copy('Common defaults','Réglages communs')),'all'),new Option(translate(copy('Regional landscape','Paysage régional')),'region'));
    for(const place of b.getWorld()?.settlements??[])scope.add(new Option(place.name??place.key,`city:${place.key}`));
    scope.value=Array.from(scope.options).some(o=>o.value===scopeValue)?scopeValue:'all';scope.disabled=b.busy();
    form.sync();
    const cityKey=scope.value.startsWith('city:')?scope.value.slice(5):'main',place=b.getWorld()?.settlements?.find(s=>s.key===cityKey);
    const selected=resolveToponymProfile(place?.culture??b.getSettings().options.culture,policy().profile??b.getSettings().naming?.profile);
    setText(sourceHint,selected.country?copy('Geographic names come from a modern country corpus. Invented names follow the selected cultural palette.','Les noms géographiques viennent d’un corpus national moderne. Les noms inventés suivent la palette culturelle choisie.'):copy('This profile uses an invented cultural palette. No geographic corpus or original script is supplied for this profile.','Ce profil utilise une palette culturelle inventée. Aucun corpus géographique ni écriture originale n’est fourni pour ce profil.'));
    regenerate.disabled=b.busy()||!b.getWorld();
    const settlements = b.getWorld()?.settlements ?? [], nextKeys = JSON.stringify(settlements.map(place => place.key));
    if (nextKeys !== keys) {
      keys = nextKeys; places.replaceChildren(); inputs = [];
      if (!settlements.length) { const empty = document.createElement('p'); empty.className = 'hint'; setText(empty, T.empty); places.append(empty); }
      for (const place of settlements) {
        const label = document.createElement('label'); label.className = 'parameter-field';
        const caption = document.createElement('span'); caption.className = 'parameter-caption';
        if (place.main) setText(caption, T.main); else { caption.dataset.l10nKeep = ''; caption.textContent = place.name ?? place.key; }
        const input = document.createElement('input'); input.type = 'text'; input.maxLength = 200; input.dataset.placeName = place.key;
        input.onchange = () => {
          const settings = b.getSettings(); settings.naming ??= {}; settings.naming.places ??= {};
          if (input.value.trim()) settings.naming.places[place.key] = input.value.trim(); else delete settings.naming.places[place.key];
          b.onNames();
        };
        label.append(caption, input); places.append(label); inputs.push({ key: place.key, input });
      }
    }
    for (const { key, input } of inputs) {
      if (document.activeElement !== input) input.value = b.getSettings().naming?.places?.[key] ?? '';
      const generated = settlements.find(place => place.key === key)?.name;
      input.placeholder = generated ?? translate(T.generated); input.setAttribute('aria-label', generated ?? key); input.disabled = b.busy();
    }
    apply.disabled = b.busy() || !b.getWorld(); exportButton.disabled = b.busy();
  }
  sync(); return { sync };
}
