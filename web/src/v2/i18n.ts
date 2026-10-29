import { interfaceEnglish, interfaceFrench } from './interfaceMessages';
import { translateRuntimeMessage } from './runtimeMessages';

export type Language = 'en' | 'fr';
export const LANGUAGE_STORAGE_KEY = 'magna-urbis-v2-language';
const supported = (value:unknown):value is Language => value==='en'||value==='fr';
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
  Object.assign(registeredMessages,messages);
}
export const getLanguage=():Language=>language;
export const numberLocale=():string=>language==='en'?'en-GB':'fr-FR';
export function translate(source:string,target:Language=language):string{
  const leading=source.match(/^\s*/)?.[0]??'',trailing=source.match(/\s*$/)?.[0]??'',body=source.trim();
  if(!body)return source;
  let translated:string;
  if(Object.hasOwn(registeredMessages,body))translated=registeredMessages[body][target];
  else if(Object.hasOwn(interfaceEnglish,body))translated=target==='en'?interfaceEnglish[body]:body;
  else if(Object.hasOwn(interfaceFrench,body))translated=target==='fr'?interfaceFrench[body]:body;
  else translated=translateRuntimeMessage(body,target);
  return leading+translated+trailing;
}
function isTranslatable(source:string):boolean{
  const text=source.trim();
  return !!text&&(Object.hasOwn(registeredMessages,text)||Object.hasOwn(interfaceEnglish,text)||Object.hasOwn(interfaceFrench,text)||translateRuntimeMessage(text,'en')!==text||translateRuntimeMessage(text,'fr')!==text);
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
  document.title=language==='en'?'Magna Urbis · V2 Workshop':'Magna Urbis · Atelier V2';
  document.querySelector('meta[name="description"]')?.setAttribute('content',language==='en'?'Magna Urbis V2: a procedural mapmaking workshop, from terrain to individual houses.':'Magna Urbis V2 : du relief à la maison, un atelier de cartographie procédurale.');
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(element=>{if(!element.closest(protectedContent))element.textContent=translate(element.getAttribute('data-i18n')!);});
  for(const attr of ['aria-label','title','placeholder','alt'])document.querySelectorAll(`[data-i18n-${attr}]`).forEach(element=>element.setAttribute(attr,translate(element.getAttribute(`data-i18n-${attr}`)!)));
  for(const [element,value] of dynamicBindings){if(!element.isConnected){dynamicBindings.delete(element);continue;}element.textContent=translate(value());}
  document.querySelectorAll<HTMLAnchorElement>('a[href*="scientific/"]').forEach(link=>link.href=atlasUrl(link.href));
  const select=document.querySelector<HTMLSelectElement>('#language-select');if(select)select.value=language;
  document.querySelectorAll('[data-i18n-number]').forEach(element=>{element.textContent=Number(element.getAttribute('data-i18n-number')).toLocaleString(numberLocale());});
}
export function setLanguage(next:Language):void{
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
