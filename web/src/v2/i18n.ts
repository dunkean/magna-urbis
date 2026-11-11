import { interfaceEnglish, interfaceFrench } from './interfaceMessages';
import { translateRuntimeMessage } from './runtimeMessages';
import { LANGUAGES, isLanguage, type Language } from './languages';
import { localeMessages } from './localeMessages';
import { onUnitsChange } from './units';

export type { Language } from './languages';
export { LANGUAGES } from './languages';
export const LANGUAGE_STORAGE_KEY = 'magna-urbis-v2-language';
const supported = isLanguage;
export function resolveLanguage(search:string,stored?:string|null):Language {
  const explicit=new URLSearchParams(search).get('lang');
  return supported(explicit)?explicit:supported(stored)?stored:'en';
}
let retained:string|null=null;
try{retained=globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY)??null;}catch{/* Storage is optional. */}
let language:Language=resolveLanguage(typeof location==='undefined'?'':location.search,retained);
const listeners=new Set<()=>void>();
const dynamicBindings=new Map<Element,()=>string>();
const registeredMessages:Record<string,{en:string;fr:string}>=Object.create(null);
/** Feature modules register intentional UI copy without translating user values. */
export function registerMessages(messages:Record<string,{en:string;fr:string}>):void{
  for (const [key, message] of Object.entries(messages)) {
    const normalized={en:message.en.trim(),fr:message.fr.trim()};
    registeredMessages[key.trim()]=normalized;registeredMessages[normalized.en]=normalized;registeredMessages[normalized.fr]=normalized;
  }
}
registerMessages({
  'Magna Urbis · V2 Workshop': { en: 'Magna Urbis · V2 Workshop', fr: 'Magna Urbis · Atelier V2' },
  'Magna Urbis V2: a procedural mapmaking workshop, from terrain to individual houses.': { en: 'Magna Urbis V2: a procedural mapmaking workshop, from terrain to individual houses.', fr: 'Magna Urbis V2 : du relief à la maison, un atelier de cartographie procédurale.' },
});
export const getLanguage=():Language=>language;
export const numberLocale=():string=>LANGUAGES.find(item=>item.code===language)!.locale;
export function translate(source:string,target:Language=language):string{
  const leading=source.match(/^\s*/)?.[0]??'',trailing=source.match(/\s*$/)?.[0]??'',body=source.trim();
  if(!body)return source;
  let translated:string;
  const bilingualTarget = target === 'fr' ? 'fr' : 'en';
  if(Object.hasOwn(registeredMessages,body))translated=registeredMessages[body][bilingualTarget];
  else if(Object.hasOwn(interfaceEnglish,body))translated=target==='fr'?body:interfaceEnglish[body];
  else if(Object.hasOwn(interfaceFrench,body))translated=target==='fr'?interfaceFrench[body]:body;
  else {
    if(target!=='en'&&target!=='fr'&&Object.hasOwn(localeMessages[target],body))return leading+localeMessages[target][body]+trailing;
    translated=translateRuntimeMessage(body,target);
    if(target!=='en'&&target!=='fr'&&translated!==body)return leading+translated+trailing;
  }
  if(target!=='en'&&target!=='fr')translated=localeMessages[target][translated]??translateCatalogTemplate(translated,target);
  return leading+translated+trailing;
}
/** Match complete registered UI templates and preserve every interpolated user value. */
const templateCache = new Map<string, { pattern: RegExp; keys: string[] }>();
const catalogTemplates = Object.fromEntries(Object.entries(localeMessages).map(([language, dictionary])=>[language,Object.entries(dictionary).filter(([source])=>source.includes('{'))]));
function translateCatalogTemplate(source: string, target: Exclude<Language, 'en'|'fr'>): string {
  for (const [template, translated] of catalogTemplates[target]) {
    let compiled = templateCache.get(template);
    if (!compiled) {
      const keys: string[] = [], parts = template.split(/(\{[a-zA-Z][a-zA-Z0-9_]*\})/g);
      const pattern = parts.map(part=>/^\{/.test(part)?(keys.push(part.slice(1,-1)),'([\\s\\S]+?)'):part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('');
      compiled={pattern:new RegExp(`^${pattern}$`,'u'),keys};templateCache.set(template,compiled);
    }
    const match=compiled.pattern.exec(source);if(!match)continue;
    const values=Object.fromEntries(compiled.keys.map((key,index)=>[key,match[index+1]]));
    return translated.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g,(placeholder,key:string)=>values[key]??placeholder);
  }
  return source;
}
function isTranslatable(source:string):boolean{
  const text=source.trim();
  return !!text&&(Object.hasOwn(registeredMessages,text)||Object.hasOwn(interfaceEnglish,text)||Object.hasOwn(interfaceFrench,text)||Object.hasOwn(localeMessages.es,text)||translateRuntimeMessage(text,'en')!==text||translateRuntimeMessage(text,'fr')!==text);
}
const protectedContent='[data-l10n-keep],textarea,pre,code,script,style';
/** Register only intentional UI copy; user content, form values and technical JSON stay untouched. */
export function bindTree(root:ParentNode):void{
  const walker=document.createTreeWalker(root as Node,NodeFilter.SHOW_TEXT);
  const nodes:Text[]=[];while(walker.nextNode())nodes.push(walker.currentNode as Text);
  for(const node of nodes){
    const parent=node.parentElement;if(!parent||parent.closest(protectedContent)||parent.closest('[data-i18n]')||!isTranslatable(node.data))continue;
    const source=node.data;
    if(parent.childNodes.length===1){parent.setAttribute('data-i18n',source);parent.textContent=translate(source);}
    else{const span=document.createElement('span');span.setAttribute('data-i18n',source);span.textContent=translate(source);node.replaceWith(span);}
  }
  const elements=Array.from(root.querySelectorAll<HTMLElement>('*'));
  if(root instanceof HTMLElement)elements.unshift(root);
  for(const element of elements){
    if(element.closest(protectedContent))continue;
    for(const attr of ['aria-label','title','placeholder','alt']){
      const source=element.getAttribute(attr);if(source&&isTranslatable(source)){element.setAttribute(`data-i18n-${attr}`,source);element.setAttribute(attr,translate(source));}
    }
  }
}
/** The renderers provide controlled HTML; binding markers survive insertion and support live switching. */
export function localeHTML(source:string):string{
  const template=document.createElement('template');template.innerHTML=source;bindTree(template.content);return template.innerHTML;
}
export function setHTML(element:Element,source:string):void{
  dynamicBindings.delete(element);element.removeAttribute('data-i18n');element.innerHTML=localeHTML(source);
}
export function insertHTML(element:Element,position:InsertPosition,source:string):void{element.insertAdjacentHTML(position,localeHTML(source));}
export function setText(element:Element,source:string):void{
  dynamicBindings.delete(element);
  element.removeAttribute('data-l10n-keep');
  element.setAttribute('data-i18n',source);element.textContent=translate(source);
}
export function setUserText(element:Element,value:string|undefined,fallback:string):void{
  dynamicBindings.delete(element);
  if(value){element.removeAttribute('data-i18n');element.setAttribute('data-l10n-keep','');element.textContent=value;}
  else setText(element,fallback);
}
export function nameHTML(value:string|undefined,fallback:string):string{
  const span=document.createElement('span');if(value){span.setAttribute('data-l10n-keep','');span.textContent=value;}
  else{span.setAttribute('data-i18n',fallback);span.textContent=translate(fallback);}return span.outerHTML;
}
export function numberHTML(value:number):string{return `<span data-i18n-number="${value}">${value.toLocaleString(numberLocale())}</span>`;}
export function setDynamicText(element:Element,source:()=>string):void{
  element.removeAttribute('data-i18n');dynamicBindings.set(element,source);element.textContent=translate(source());
}
export function atlasUrl(href='./scientific/index.html'):string{
  const url=new URL(href,document.baseURI);url.pathname=url.pathname.replace(/\/(?:index|fr)\.html$/,language==='fr'?'/fr.html':'/index.html');url.searchParams.set('lang',language);return url.href;
}
function applyDocumentLanguage():void{
  document.documentElement.lang=language;
  document.documentElement.dir=language==='ar'?'rtl':'ltr';
  document.title=translate('Magna Urbis · V2 Workshop');
  document.querySelector('meta[name="description"]')?.setAttribute('content',translate('Magna Urbis V2: a procedural mapmaking workshop, from terrain to individual houses.'));
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(element=>{if(!element.closest(protectedContent))element.textContent=translate(element.getAttribute('data-i18n')!);});
  for(const attr of ['aria-label','title','placeholder','alt'])document.querySelectorAll(`[data-i18n-${attr}]`).forEach(element=>element.setAttribute(attr,translate(element.getAttribute(`data-i18n-${attr}`)!)));
  for(const [element,value] of dynamicBindings){if(!element.isConnected){dynamicBindings.delete(element);continue;}element.textContent=translate(value());}
  document.querySelectorAll<HTMLAnchorElement>('a[href*="scientific/"]').forEach(link=>link.href=atlasUrl(link.href));
  const select=document.querySelector<HTMLSelectElement>('#language-select');if(select)select.value=language;
  document.querySelectorAll('[data-i18n-number]').forEach(element=>{element.textContent=Number(element.getAttribute('data-i18n-number')).toLocaleString(numberLocale());});
}
export function setLanguage(next:Language):void{
  if(!supported(next))return;
  language=next;
  try{localStorage.setItem(LANGUAGE_STORAGE_KEY,next);}catch{/* Private mode remains usable. */}
  if(typeof history!=='undefined'){const url=new URL(location.href);url.searchParams.set('lang',next);history.replaceState(history.state,'',url);}
  applyDocumentLanguage();listeners.forEach(listener=>listener());
}
export function onLanguageChange(listener:()=>void):()=>void{listeners.add(listener);return()=>listeners.delete(listener);}
export function initializeLanguage():void{
  applyDocumentLanguage();
  try{if(new URLSearchParams(location.search).has('lang'))localStorage.setItem(LANGUAGE_STORAGE_KEY,language);}catch{/* Optional preference. */}
}
onUnitsChange(()=>{if(typeof document!=='undefined')applyDocumentLanguage();});
