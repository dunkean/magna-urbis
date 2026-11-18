import type { World, Settlement } from '../gen/types';
import {confirmAction} from './actionDialog';
import type { View } from '../render/view';
import { screenToWorld, worldToScreen } from '../render/view';
import { PALETTES } from '../render/styles';
import { applyRenderColors } from '../render/customColors';
import { applyComposition } from '../render/composition';
import { kindStyles } from '../render/labelStyles';
import { DEFAULT_TEXT, textStyle } from '../render/textLayer';
import { pointInRing } from '../gen/geo/poly';
import { moveTown } from './townMove';
import type { V2Settings } from './contracts';
import { mountTownMoveSelection } from './townMoveSelection';
import { registerMessages, setText, translate } from './i18n';

registerMessages({
  'Move towns':{en:'Edit positions',fr:'Modifier les positions'},
  'Apply positions & rebuild roads':{en:'Apply positions & rebuild roads',fr:'Valider et recalculer les routes'},
  'Cancel':{en:'Cancel',fr:'Annuler'},
  'Moving positions resets generated cities when you apply. Continue?':{en:'Moving positions resets generated cities when you apply. Continue?',fr:'Valider les positions réinitialisera les villes déjà générées et recalculera les routes. Continuer ?'},
  'Select a place on the map or in Places, then drag it or click its new position. Esc exits.':{en:'Select a place on the map or in Places, then drag it or click its new position. Esc exits.',fr:'Sélectionnez une localité sur la carte ou dans Lieux, puis glissez-la ou cliquez sur sa nouvelle position. Échap pour terminer.'},
});
export function mountTownMoveEditor(api:{map:HTMLElement;toolbar:HTMLElement;places:HTMLElement;getWorld():World|undefined;getView():View;setView(view:View):void;getSettings?():V2Settings;getName?(key:string):string|undefined;busy():boolean;commit(world:World,key:string,dx:number,dy:number):Promise<void>;error(error:unknown):void;deferred?:{commit(positions:ReadonlyMap<string,{x:number;y:number}>):Promise<void>}}){
  const button=document.createElement('button');button.type='button';button.id='move-towns';setText(button,'Move towns');api.toolbar.prepend(button);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('v2-edit-overlay');svg.toggleAttribute('hidden',true);api.map.append(svg);
  const hint=document.createElement('div');hint.className='glass v2-town-move-hint';setText(hint,'Select a place on the map or in Places, then drag it or click its new position. Esc exits.');hint.hidden=true;api.map.parentElement!.append(hint);
  const pending=new Map<string,{x:number;y:number}>();
  const validate=document.createElement('button'),cancel=document.createElement('button');
  validate.type=cancel.type='button';validate.id='town-positions-apply';cancel.id='town-positions-cancel';
  setText(validate,'Apply positions & rebuild roads');setText(cancel,'Cancel');
  if(api.deferred)api.toolbar.append(validate,cancel);validate.hidden=cancel.hidden=true;
  let enabled=false,working=false,frame=0;
  const selection=mountTownMoveSelection({panel:api.places,busy:()=>working||api.busy(),exists:key=>!!api.getWorld()?.settlements?.some(town=>town.key===key),changed:draw,
    focus:key=>{const town=api.getWorld()?.settlements?.find(town=>town.key===key);if(!town)return;const center=pending.get(key)??town.center,v=api.getView(),width=api.map.clientWidth,height=api.map.clientHeight;
      const [x,y]=worldToScreen(v,width,height,center.x,center.y);if(x<24||y<24||x>width-24||y>height-24)api.setView({...v,cx:center.x,cy:center.y});},
  });
  validate.onclick=async()=>{if(!pending.size||working)return;working=true;validate.disabled=true;try{await api.deferred!.commit(pending);stop();}catch(error){api.error(error);}finally{working=false;validate.disabled=false;}};
  cancel.onclick=()=>stop();
  let drag:{town:Settlement;x:number;y:number;dx:number;dy:number;id:number}|undefined;
  const at=(x:number,y:number)=>{const r=api.map.getBoundingClientRect();const [wx,wy]=screenToWorld(api.getView(),r.width,r.height,x-r.left,y-r.top);return{x:wx,y:wy};};
  function draw(){
    validate.disabled=working||!pending.size||api.busy();svg.replaceChildren();const w=api.getWorld();if(!enabled||!w)return;
    const v=api.getView(),width=api.map.clientWidth,height=api.map.clientHeight;
    svg.setAttribute('viewBox',`${v.cx-width/2/v.scale} ${v.cy-height/2/v.scale} ${width/v.scale} ${height/v.scale}`);
    const settings=api.getSettings?.(),configured=settings?.appearance,appearance=configured?.composition?applyComposition(configured,configured.composition,w.options.biome==='underdark'):configured;
    const style=appearance?.style??w.options.style,pal=applyRenderColors(PALETTES[style],appearance?.colors),styles=kindStyles(style,pal);
    const labels=document.createElementNS(svg.namespaceURI,'g');
    for(const town of w.settlements??[]){
      const selected=selection.key()===town.key,dragging=drag?.town.key===town.key,saved=pending.get(town.key),dx=dragging?drag!.dx:saved?saved.x-town.center.x:0,dy=dragging?drag!.dy:saved?saved.y-town.center.y:0;
      const urban=town.main?w.urban:town.urban;
      const rings=urban?.footprint?.length?urban.footprint:[town.extent];
      const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',rings.map(r=>r.map((p,i)=>`${i?'L':'M'}${p.x+dx},${p.y+dy}`).join(' ')+'Z').join(' '));
      p.setAttribute('fill',selected?'#dcb86f33':'#dcb86f0d');p.setAttribute('stroke','#c48a25');p.setAttribute('stroke-width','2');p.setAttribute('vector-effect','non-scaling-stroke');p.setAttribute('stroke-dasharray','6 4');svg.append(p);
      const c=document.createElementNS(svg.namespaceURI,'circle');c.setAttribute('cx',String(town.center.x+dx));c.setAttribute('cy',String(town.center.y+dy));c.setAttribute('r',String((selected?10:7)/v.scale));c.setAttribute('fill',selected?'#fff7e4':'#dcb86f');c.setAttribute('stroke',selected?'#9b3f1d':'#29281f');c.setAttribute('stroke-width',String((selected?3:2)/v.scale));c.setAttribute('data-town-handle',town.key);c.setAttribute('data-selected',String(selected));svg.append(c);
      // Screen-sized labels bypass map visibility, zoom cutoffs and collision filtering in this mode.
      const entry=w.names?.entries.find(entry=>entry.id===`settlement:${town.key}`),st=textStyle(styles[entry?.kind??(town.main?'town':'village')],configured?.composition?.text??DEFAULT_TEXT,pal);
      const label=document.createElementNS(svg.namespaceURI,'text');label.setAttribute('data-town-label',town.key);label.setAttribute('data-l10n-keep','');
      label.setAttribute('transform',`translate(${town.center.x+dx} ${town.center.y+dy}) scale(${1/v.scale})`);label.setAttribute('x','14');label.setAttribute('y','-12');
      label.setAttribute('font-family',st.family??pal.fontFamily);label.setAttribute('font-size',String(Math.max(13,Math.min(18,entry?.labelStyle?.size??st.minPx))));label.setAttribute('font-weight',(entry?.labelStyle?.bold??st.bold)?'600':'400');label.setAttribute('font-style',(entry?.labelStyle?.italic??st.italic)?'italic':'normal');
      label.setAttribute('fill',entry?.labelStyle?.color??st.color);label.setAttribute('stroke',st.halo??pal.lab.halo);label.setAttribute('stroke-width','3');label.setAttribute('stroke-linejoin','round');label.setAttribute('paint-order','stroke');
      label.textContent=api.getName?.(town.key)??entry?.text??town.name??(town.main?translate('Main settlement'):town.key);labels.append(label);
    }
    svg.append(labels);
  }
  function follow(){draw();if(enabled)frame=requestAnimationFrame(follow);}
  function stop(){pending.clear();validate.hidden=cancel.hidden=true;enabled=false;if(drag)try{api.map.releasePointerCapture(drag.id);}catch{}drag=undefined;selection.setActive(false);cancelAnimationFrame(frame);svg.toggleAttribute('hidden',true);hint.hidden=true;button.setAttribute('aria-pressed','false');api.map.classList.remove('v2-moving-towns');}
  async function start(){if(api.busy()||!api.getWorld()?.settlements?.length)return;const source=api.getWorld();if(api.deferred&&source!.settlements!.some(s=>s.main?source!.urban:s.urban)&&!await confirmAction('Moving positions resets generated cities when you apply. Continue?',{id:'move-towns-dialog',title:'Move settlements',confirmLabel:'Continue'}))return;if(api.busy()||api.getWorld()!==source)return;validate.hidden=cancel.hidden=!api.deferred;window.dispatchEvent(new CustomEvent('v2-edit-mode',{detail:'town-move'}));enabled=true;selection.setActive(true);svg.toggleAttribute('hidden',false);hint.hidden=false;button.setAttribute('aria-pressed','true');api.map.classList.add('v2-moving-towns');follow();}
  button.onclick=()=>enabled?stop():start();
  api.map.addEventListener('pointerdown',event=>{
    if(!enabled||working||api.busy()||event.button!==0)return;const w=api.getWorld();if(!w)return;
    const p=at(event.clientX,event.clientY),tol=12/api.getView().scale;
    const distance=(s:Settlement)=>{const center=pending.get(s.key)??s.center;return Math.hypot(center.x-p.x,center.y-p.y);};
    const picked=w.settlements?.filter(s=>{const center=pending.get(s.key)??s.center;return pointInRing(s.extent,{x:p.x-center.x+s.center.x,y:p.y-center.y+s.center.y})||distance(s)<Math.max(15,s.radius)+tol;}).sort((a,b)=>distance(a)-distance(b))[0];
    const town=picked??w.settlements?.find(s=>s.key===selection.key());
    if(!town)return;selection.select(town.key);const saved=pending.get(town.key),dx=picked?(saved?saved.x-town.center.x:0):Math.max(0,Math.min(w.mapSize,p.x))-town.center.x,dy=picked?(saved?saved.y-town.center.y:0):Math.max(0,Math.min(w.mapSize,p.y))-town.center.y;drag={town,x:p.x-dx,y:p.y-dy,dx,dy,id:event.pointerId};event.preventDefault();event.stopImmediatePropagation();api.map.setPointerCapture(event.pointerId);draw();
  },true);
  api.map.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.id)return;const p=at(event.clientX,event.clientY),size=api.getWorld()!.mapSize;drag.dx=Math.max(0,Math.min(size,drag.town.center.x+p.x-drag.x))-drag.town.center.x;drag.dy=Math.max(0,Math.min(size,drag.town.center.y+p.y-drag.y))-drag.town.center.y;event.stopImmediatePropagation();draw();},true);
  async function finish(event:PointerEvent){
    if(!drag||event.pointerId!==drag.id)return;const done=drag;drag=undefined;event.stopImmediatePropagation();try{api.map.releasePointerCapture(event.pointerId);}catch{}
    if(event.type==='pointercancel'){draw();return;}if(Math.hypot(done.dx,done.dy)<.1){if(api.deferred)pending.delete(done.town.key);draw();return;}
    const w=api.getWorld();if(!w)return;if(api.deferred){pending.set(done.town.key,{x:done.town.center.x+done.dx,y:done.town.center.y+done.dy});draw();return;}working=true;
    try{await api.commit(moveTown(w,done.town.key,{x:done.town.center.x+done.dx,y:done.town.center.y+done.dy}),done.town.key,done.dx,done.dy);}catch(e){api.error(e);}finally{working=false;draw();}
  }
  api.map.addEventListener('pointerup',event=>void finish(event),true);api.map.addEventListener('pointercancel',event=>void finish(event),true);
  api.map.addEventListener('click',event=>{if(enabled)event.stopImmediatePropagation();},true);
  window.addEventListener('v2-edit-mode',event=>{if((event as CustomEvent).detail!=='town-move')stop();});
  window.addEventListener('keydown',event=>{if(event.key==='Escape'&&!document.querySelector('dialog[open]'))stop();});
  return {sync(){button.disabled=api.busy()||!api.getWorld()?.settlements?.length;draw();},stop};
}
