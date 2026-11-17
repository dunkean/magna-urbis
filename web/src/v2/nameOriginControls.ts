import type { V2Settings } from './contracts';
import type { NamingPolicy } from '../gen/names/types';
import { namingPolicy } from '../gen/names/policy';
import { generateToponymRecord } from '../gen/names/toponyms';
import { resolveToponymProfile, TOPONYM_PROFILES } from '../gen/names/profiles';
import { presentName } from '../gen/names/displayNames';
import { formatToponym } from '../gen/names/syntax';
import { namePresentation } from './mapPresentation';
import { nameProfileLabels } from './mapControls';
import { mountParameterForm } from './parameterForm';
import { LANGUAGES } from './languages';
import { registerMessages, setText, translate } from './i18n';

registerMessages({
  'Names are independent of building styles.': { en:'Names are independent of building styles.', fr:'Les noms sont indépendants du style des constructions.' },
});

/** The same naming policy as the full editor, available before map/town generation. */
export function mountNameOriginControls(host: HTMLElement, id: string, b: {
  getSettings(): V2Settings; busy(): boolean; changed(): void; city?: string; getCulture?(): string;
}) {
  host.classList.add('name-origin-controls');
  const heading = document.createElement('h4'); setText(heading, 'Place names');
  const fields = document.createElement('div'), preview = document.createElement('p'), hint = document.createElement('p');
  preview.className = hint.className = 'hint'; preview.dataset.l10nKeep = '';
  setText(hint, 'Names are independent of building styles.'); host.append(heading, fields, preview, hint);
  const policy = (): NamingPolicy => b.city ? b.getSettings().naming?.local?.[b.city] ?? {} : b.getSettings().naming ?? {};
  const form = mountParameterForm(fields, [
    { path:'profile', id:`${id}-profile`, label:'Name profile', type:'select', optional:true, emptyLabel:b.city ? 'Inherit' : 'Inherit from culture', options:TOPONYM_PROFILES.map(p=>({value:p.id,label:nameProfileLabels[p.id]})) },
    { path:'source', id:`${id}-source`, label:'Name source', type:'select', optional:true, emptyLabel:'Inherit', options:[{value:'auto',label:'Profile default'},{value:'geographic',label:'Real geographic names'},{value:'invented',label:'Invented names'},{value:'mixed',label:'Real and invented names'}] },
    ...(!b.city ? [{ path:'presentation', id:`${id}-language`, label:'Map language', type:'select' as const, options:[{value:'ui',label:'Interface language'},...LANGUAGES.map(l=>({value:l.code,label:l.name})),{value:'cultural',label:'Full cultural names'}] }] : []),
  ], {
    getValue:path=>path==='presentation' ? b.getSettings().naming?.mode==='cultural' ? 'cultural' : b.getSettings().naming?.mapLanguage ?? 'ui' : policy()[path as keyof NamingPolicy] ?? '',
    setValue:(path,value)=>{
      const s=b.getSettings(); s.naming??={};
      if(path==='presentation') {
        s.naming.mode=value==='cultural' ? 'cultural' : 'localized';
        if(value!=='cultural')s.naming.mapLanguage=value as NonNullable<V2Settings['naming']>['mapLanguage'];
      } else {
        let p:NamingPolicy=s.naming;
        if(b.city){s.naming.local??={};p=s.naming.local[b.city]??={};}
        if(value)Object.assign(p,{[path]:value});else delete p[path as keyof NamingPolicy];
      }
      sync(); b.changed();
    }, disabled:b.busy,
  });
  function sync():void {
    form.sync();
    const s=b.getSettings(), p=b.city ? namingPolicy(s.naming,b.city) : s.naming ?? {};
    const culture=b.getCulture?.() ?? (b.city ? s.local[b.city]?.culture : undefined) ?? s.options.culture;
    const profile=resolveToponymProfile(culture,s.naming?.toponymCulture ? resolveToponymProfile(s.naming.toponymCulture).id : p.profile ?? s.options.language);
    const sample=generateToponymRecord({seed:s.options.seed,key:'naming-preview',kind:'place',culture,language:profile.id,source:p.source ?? s.options.nameSource});
    const parts={kind:'gate' as const,proper:sample.proper,cultural:formatToponym(profile,'gate',sample.proper),opaque:false};
    preview.textContent=`${translate(nameProfileLabels[profile.id])} · ${presentName(parts,namePresentation(s))}`;
  }
  sync(); return {sync,dispose:form.dispose};
}
