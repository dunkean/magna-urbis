import type { World, Settlement } from '../gen/types';
import type { View } from '../render/view';
import { screenToWorld } from '../render/view';
import { pointInRing } from '../gen/geo/poly';
import { moveTown } from './townMove';
import { registerMessages, setText, translate } from './i18n';

registerMessages({
  'Move towns':{en:'Move towns',fr:'Déplacer les villes'},
  'Drag a town or its centre. Esc exits.':{en:'Drag a town or its centre. Esc exits.',fr:'Glissez une ville ou son centre. Échap pour terminer.'},
});
export function mountTownMoveEditor(api:{map:HTMLElement;toolbar:HTMLElement;getWorld():World|undefined;getView():View;busy():boolean;commit(world:World,key:string,dx:number,dy:number):Promise<void>;error(error:unknown):void}){
  const button=document.createElement('button');button.type='button';button.id='move-towns';setText(button,'Move towns');api.toolbar.prepend(button);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('v2-edit-overlay');svg.toggleAttribute('hidden',true);api.map.append(svg);
  const hint=document.createElement('div');hint.className='glass v2-town-move-hint';setText(hint,'Drag a town or its centre. Esc exits.');hint.hidden=true;api.map.parentElement!.append(hint);
  let enabled=false,working=false,frame=0;
  let drag:{town:Settlement;x:number;y:number;dx:number;dy:number;id:number}|undefined;
  const at=(x:number,y:number)=>{const r=api.map.getBoundingClientRect();const [wx,wy]=screenToWorld(api.getView(),r.width,r.height,x-r.left,y-r.top);return{x:wx,y:wy};};
  function draw(){
    svg.replaceChildren();const w=api.getWorld();if(!enabled||!w)return;
    const v=api.getView(),width=api.map.clientWidth,height=api.map.clientHeight;
    svg.setAttribute('viewBox',`${v.cx-width/2/v.scale} ${v.cy-height/2/v.scale} ${width/v.scale} ${height/v.scale}`);
    for(const town of w.settlements??[]){
      const selected=drag?.town.key===town.key,dx=selected?drag!.dx:0,dy=selected?drag!.dy:0;
      const urban=town.main?w.urban:town.urban;
      const rings=urban?.footprint?.length?urban.footprint:[town.extent];
      const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',rings.map(r=>r.map((p,i)=>`${i?'L':'M'}${p.x+dx},${p.y+dy}`).join(' ')+'Z').join(' '));
      p.setAttribute('fill',selected?'#dcb86f33':'#dcb86f0d');p.setAttribute('stroke','#c48a25');p.setAttribute('stroke-width','2');p.setAttribute('vector-effect','non-scaling-stroke');p.setAttribute('stroke-dasharray','6 4');svg.append(p);
      const c=document.createElementNS(svg.namespaceURI,'circle');c.setAttribute('cx',String(town.center.x+dx));c.setAttribute('cy',String(town.center.y+dy));c.setAttribute('r',String(7/v.scale));c.setAttribute('fill','#dcb86f');c.setAttribute('stroke','#29281f');c.setAttribute('stroke-width',String(2/v.scale));svg.append(c);
    }
  }
  function follow(){draw();if(enabled)frame=requestAnimationFrame(follow);}
  function stop(){enabled=false;drag=undefined;cancelAnimationFrame(frame);svg.toggleAttribute('hidden',true);hint.hidden=true;button.setAttribute('aria-pressed','false');api.map.classList.remove('v2-moving-towns');}
  function start(){if(api.busy()||!api.getWorld()?.settlements?.length)return;window.dispatchEvent(new CustomEvent('v2-edit-mode',{detail:'town-move'}));enabled=true;svg.toggleAttribute('hidden',false);hint.hidden=false;button.setAttribute('aria-pressed','true');api.map.classList.add('v2-moving-towns');follow();}
  button.onclick=()=>enabled?stop():start();
  api.map.addEventListener('pointerdown',event=>{
    if(!enabled||working||api.busy()||event.button!==0)return;const w=api.getWorld();if(!w)return;
    const p=at(event.clientX,event.clientY),tol=12/api.getView().scale;
    const town=w.settlements?.filter(s=>pointInRing(s.extent,p)||Math.hypot(s.center.x-p.x,s.center.y-p.y)<Math.max(15,s.radius)+tol).sort((a,b)=>Math.hypot(a.center.x-p.x,a.center.y-p.y)-Math.hypot(b.center.x-p.x,b.center.y-p.y))[0];
    if(!town)return;drag={town,x:p.x,y:p.y,dx:0,dy:0,id:event.pointerId};event.preventDefault();event.stopImmediatePropagation();api.map.setPointerCapture(event.pointerId);draw();
  },true);
  api.map.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.id)return;const p=at(event.clientX,event.clientY),size=api.getWorld()!.mapSize;drag.dx=Math.max(0,Math.min(size,drag.town.center.x+p.x-drag.x))-drag.town.center.x;drag.dy=Math.max(0,Math.min(size,drag.town.center.y+p.y-drag.y))-drag.town.center.y;event.stopImmediatePropagation();draw();},true);
  async function finish(event:PointerEvent){
    if(!drag||event.pointerId!==drag.id)return;const done=drag;drag=undefined;event.stopImmediatePropagation();try{api.map.releasePointerCapture(event.pointerId);}catch{}
    if(event.type==='pointercancel'||Math.hypot(done.dx,done.dy)<.1){draw();return;}
    const w=api.getWorld();if(!w)return;working=true;
    try{await api.commit(moveTown(w,done.town.key,{x:done.town.center.x+done.dx,y:done.town.center.y+done.dy}),done.town.key,done.dx,done.dy);}catch(e){api.error(e);}finally{working=false;draw();}
  }
  api.map.addEventListener('pointerup',event=>void finish(event),true);api.map.addEventListener('pointercancel',event=>void finish(event),true);
  api.map.addEventListener('click',event=>{if(enabled)event.stopImmediatePropagation();},true);
  window.addEventListener('v2-edit-mode',event=>{if((event as CustomEvent).detail!=='town-move')stop();});
  window.addEventListener('keydown',event=>{if(event.key==='Escape')stop();});
  return {sync(){button.disabled=api.busy()||!api.getWorld()?.settlements?.length;draw();},stop};
}
