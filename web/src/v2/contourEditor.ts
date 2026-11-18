import type {Shape,Point} from '../../../rust/bridge/urban';
import type {View} from '../render/view';
import {screenToWorld} from '../render/view';
import {registerMessages,translate,onLanguageChange} from './i18n';
import {editableContours,contourAt,type ContourEdit,type ContourKind,type ContourState,type ContourTarget} from './contourEdits';
import {contourRings,copyContour,contourPointAt,nearestContour,insertContourPoint,translateContour,removeContourSelection,splitContour,contourProblem,type ContourSelection} from './contourGeometry';

const copy=(en:string,fr:string)=>{registerMessages({[en]:{en,fr}});return en;};
const T={
  quarter:copy('Edit quarter outlines','Modifier les contours des quartiers'),block:copy('Edit block outlines','Modifier les contours des îlots'),parcel:copy('Edit parcel outlines','Modifier les contours des parcelles'),
  hint:copy('Click an outline or a point. Double-click an edge to add a point, a point to select the outline. Hold to select an edge. Delete removes the selection.','Cliquez un contour ou un point. Double-cliquez un bord pour ajouter un point, un point pour choisir le contour. Appui long : segment. Suppr retire la sélection.'),
  pick:copy('Choose an area on the map.','Choisissez une zone sur la carte.'),finish:copy('Finish Editing','Terminer l’édition'),
  point:copy('Point selected','Point sélectionné'),segment:copy('Segment selected','Segment sélectionné'),line:copy('Outline selected','Contour sélectionné'),
  applied:copy('Outline applied.','Contour appliqué.'),removed:copy('Area removed.','Zone supprimée.'),split:copy('Area split into two closed surfaces.','Zone scindée en deux surfaces fermées.'),
  cut:copy('Split area from this point','Scinder la zone depuis ce point'),remove:copy('Delete selection','Supprimer la sélection'),
  cutHint:copy('Choose a second point on the outer boundary to split the area. Esc cancels the cut.','Choisissez un second point sur le bord extérieur pour scinder la zone. Échap annule la coupe.'),
  undo:copy('Undo outline edit','Annuler la modification du contour'),redo:copy('Redo outline edit','Rétablir la modification du contour'),
  working:copy('Applying the outline and its dependent objects…','Application du contour et des objets qui en dépendent…'),
  error:copy('The outline was not applied. The previous map is retained.','Le contour n’a pas été appliqué. La carte précédente est conservée.'),
};
export interface ContourEditorHost{
  map:HTMLElement;toolbar:HTMLElement;getView():View;capture():ContourState|undefined;
  apply(edit:ContourEdit):Promise<string|undefined>;restore(state:ContourState):Promise<void>;
  busy():boolean;toast(message:string,error?:boolean):void;
}
type Entry={before:ContourState;after:ContourState;beforeTarget?:ContourTarget;afterTarget?:ContourTarget;beforeSelection:ContourSelection;afterSelection:ContourSelection};
type Drag={pointer:number;start:Point;origin:Point;base:Shape;selection:ContourSelection;moved:boolean;index:number;tap:boolean};
const NS='http://www.w3.org/2000/svg';
const svg=(tag:string,attrs:Record<string,string|number>)=>{const e=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,String(v));return e;};
const path=(ring:Point[])=>ring.length?'M'+ring.map(p=>`${p.x},${p.y}`).join('L')+'Z':'';
export function mountContourEditor(host:ContourEditorHost){
  let kind:ContourKind|undefined,target:ContourTarget|undefined,selection:ContourSelection={kind:'line'},draft:Shape|undefined;
  let working=false,historyOwner=false,known=host.capture()?.world,feedback='',cutStart:Point|undefined;
  let drag:Drag|undefined,hold:ReturnType<typeof setTimeout>|undefined,tap:{time:number;point:Point;vertex:number;ring:number}|undefined,frame=0,lastBox='';
  const past:Entry[]=[],future:Entry[]=[];
  const layer=document.createElementNS(NS,'svg');layer.classList.add('v2-contour-overlay');layer.setAttribute('preserveAspectRatio','none');layer.toggleAttribute('hidden',true);host.map.append(layer);
  const panel=document.createElement('div');panel.className='v2-contour-session glass';panel.hidden=true;
  const finish=document.createElement('button'),undo=document.createElement('button'),redo=document.createElement('button'),hint=document.createElement('p'),message=document.createElement('p');
  finish.type=undo.type=redo.type='button';finish.dataset.contourFinish='';finish.className='primary';undo.dataset.contourUndo='';redo.dataset.contourRedo='';message.dataset.contourFeedback='';message.setAttribute('role','status');message.setAttribute('aria-live','polite');
  const actions=document.createElement('div');actions.append(undo,redo);panel.append(finish,actions,hint,message);(host.map.parentElement?.querySelector('.map-bottom')??host.map.parentElement)?.append(panel);
  const buttons=(['quarter','block','parcel'] as const).map(k=>{const b=document.createElement('button');b.type='button';b.dataset.contourTool=k;b.onclick=()=>{if(kind===k){stop();window.dispatchEvent(new CustomEvent('v2-edit-mode',{detail:'navigate'}));}else start(k);};host.toolbar.append(b);return b;});
  const styles=document.createElement('style');styles.textContent=`
.v2-contour-overlay{position:absolute;inset:0;width:100%;height:100%;z-index:6;pointer-events:none;overflow:hidden;touch-action:none}.v2-contour-overlay[hidden]{display:none}.v2-contour-overlay [data-contour-role]{pointer-events:all;cursor:move}.v2-contour-overlay [role=button]{cursor:pointer}.v2-contour-overlay [aria-disabled=true]{opacity:.4;cursor:default}
.v2-contour-session{position:absolute;left:0;bottom:calc(100% + 12px);z-index:7;width:290px;max-width:calc(100% - 24px);padding:10px;pointer-events:auto}.v2-contour-session[hidden]{display:none}.v2-contour-session>button{width:100%;padding:14px 12px;font-size:16px}.v2-contour-session>div{display:flex;gap:6px;margin:7px 0}.v2-contour-session p{font-size:11px;line-height:1.45;margin:7px 0}.v2-contour-session [data-contour-feedback]{color:#ffdc93}[data-contour-tool][aria-pressed=true]{border-color:#dcb86f;background:#665435;color:#ffdc93}#contour-tool-slot{display:inline-flex;gap:4px}#contour-tool-slot button{font-size:11px;padding:6px 8px}
`;document.head.append(styles);
  const clearHold=()=>{clearTimeout(hold);hold=undefined;};
  const point=(x:number,y:number)=>{const r=host.map.getBoundingClientRect(),[px,py]=screenToWorld(host.getView(),r.width,r.height,x-r.left,y-r.top);return {x:px,y:py};};
  const say=(text:string)=>{feedback=translate(text);message.textContent=feedback;};
  const error=(e:unknown)=>{const text=e instanceof Error?e.message:String(e);say(text);host.toast(text,true);};
  const currentShape=()=>draft??target?.shape;
  const historyState=()=>{const state=host.capture();return state?{world:state.world,settings:structuredClone(state.settings)}:undefined;};
  function refreshTarget(old:ContourTarget|undefined,preferred?:Shape):ContourTarget|undefined{
    const state=host.capture();if(!old||!state)return;
    const all=editableContours(state.world,old.kind,state.settings).filter(t=>t.town===old.town);
    return all.find(t=>t.id===old.id)??(preferred?all.map(t=>({t,d:nearestContour(t.shape,preferred.outer[0]).distance})).sort((a,b)=>a.d-b.d)[0]?.t:undefined);
  }
  function syncUI(){
    const state=host.capture(),busy=working||host.busy();
    buttons.forEach(b=>{const k=b.dataset.contourTool as ContourKind;b.textContent=translate(k==='quarter'?'Quarter':k==='block'?'Block':'Parcel');b.title=translate(T[k]);b.setAttribute('aria-label',translate(T[k]));b.disabled=busy||!state;b.setAttribute('aria-pressed',String(kind===b.dataset.contourTool));});
    panel.hidden=!kind;finish.textContent=translate(T.finish);finish.disabled=busy;
    undo.textContent='↶ '+translate(T.undo);redo.textContent='↷ '+translate(T.redo);undo.disabled=busy||!past.length;redo.disabled=busy||!future.length;
    hint.textContent=translate(working?T.working:cutStart?T.cutHint:target?T.hint:T.pick);message.textContent=feedback;message.hidden=!feedback;
    layer.setAttribute('aria-busy',String(working));panel.setAttribute('aria-busy',String(working));
  }
  function draw(){
    if(!kind)return;const shape=currentShape(),s=host.getView().scale,nodes:SVGElement[]=[];
    if(shape){
      nodes.push(svg('path',{d:contourRings(shape).map(path).join(' '),fill:'#e3b65b22','fill-rule':'evenodd',stroke:contourProblem(shape)?'#d35e47':'#e7b950','stroke-width':3,'vector-effect':'non-scaling-stroke','data-contour-role':'line'}));
      [shape.outer].forEach((ring,r)=>{
        ring.forEach((p,i)=>{
          const q=ring[(i+1)%ring.length],edge=selection.kind==='segment'&&selection.ring===r&&selection.index===i;
          nodes.push(svg('path',{d:`M${p.x},${p.y}L${q.x},${q.y}`,fill:'none',stroke:edge?'#fff2ad':'transparent','stroke-width':edge?7:16,'vector-effect':'non-scaling-stroke','data-contour-role':'segment','data-ring':r,'data-index':i}));
        });
        ring.forEach((p,i)=>{const chosen=selection.kind==='point'&&selection.ring===r&&selection.index===i;
          nodes.push(svg('circle',{cx:p.x,cy:p.y,r:(chosen?7:5)/s,fill:chosen?'#e7b950':'#fff5dd',stroke:'#8a6a2c','stroke-width':1.5,'vector-effect':'non-scaling-stroke','data-contour-role':'point','data-ring':r,'data-index':i,'data-selected':String(chosen)}));
        });
      });
      if(selection.kind==='point'&&!drag){const p=contourRings(shape)[selection.ring]?.[selection.index];if(p){
        const v=host.getView(),left=v.cx-host.map.clientWidth/2/s,top=v.cy-host.map.clientHeight/2/s,px=Math.max(left+36/s,Math.min(left+(host.map.clientWidth-36)/s,p.x)),py=Math.max(top+35/s,p.y-28/s);
        for(const [side,role,label,icon]of [[-1,'delete',T.remove,'M-5 0H5'],[1,'cut',T.cut,'M-5 -4L5 4M-5 4L5 -4M-5 -4a2 2 0 1 0 -4 0a2 2 0 1 0 4 0M-5 4a2 2 0 1 0 -4 0a2 2 0 1 0 4 0']] as const){
          const g=svg('g',{transform:`translate(${px+side*18/s} ${py}) scale(${1/s})`,'data-contour-role':role,role:'button',tabindex:working?-1:0,'aria-label':translate(label),'aria-disabled':String(working||role==='cut'&&selection.ring!==0)});
          g.append(svg('circle',{r:13,fill:'#fff5dd',stroke:'#8a6a2c','stroke-width':1.5}),svg('path',{d:icon,stroke:role==='cut'?'#9c3a2a':'#333',fill:'none','stroke-width':1.5,'pointer-events':'none'}));
          const title=svg('title',{});title.textContent=translate(label);g.append(title);g.addEventListener('keydown',e=>{if(['Enter',' '].includes((e as KeyboardEvent).key)){e.preventDefault();e.stopPropagation();if(role==='delete')void remove();else armCut();}});nodes.push(g);
        }
      }}
      if(cutStart)nodes.push(svg('circle',{cx:cutStart.x,cy:cutStart.y,r:10/s,fill:'none',stroke:'#d35e47','stroke-width':3,'vector-effect':'non-scaling-stroke'}));
    }
    layer.replaceChildren(...nodes);syncUI();
  }
  function follow(){if(!kind)return;const v=host.getView(),w=host.map.clientWidth,h=host.map.clientHeight,b=`${v.cx-w/2/v.scale} ${v.cy-h/2/v.scale} ${w/v.scale} ${h/v.scale}`;if(b!==lastBox){lastBox=b;layer.setAttribute('viewBox',b);draw();}frame=requestAnimationFrame(follow);}
  async function apply(edit:ContourEdit,afterSelection:ContourSelection,messageText:string){
    const before=historyState();if(!before||working||host.busy())return;
    if(edit.shape){const problem=contourProblem(edit.shape);if(problem){error(problem);draft=undefined;draw();return;}}
    const previous=target,previousSelection=selection;working=true;clearHold();tap=undefined;syncUI();
    try{
      const warning=await host.apply(edit),after=historyState();if(!after)throw new Error(T.error);
      known=after.world;target=refreshTarget(previous,edit.shape??edit.parts?.[0]);selection=target?afterSelection:{kind:'line'};
      if(target&&selection.kind!=='line'&&(!contourRings(target.shape)[selection.ring]?.[selection.index]))selection={kind:'line'};
      past.push({before,after,beforeTarget:previous,afterTarget:target,beforeSelection:previousSelection,afterSelection:selection});if(past.length>60)past.shift();future.length=0;
      say(warning??messageText);
    }catch(e){error(e);}finally{working=false;draft=undefined;cutStart=undefined;draw();}
  }
  async function history(redoing=false){
    if(working||host.busy())return;const from=redoing?future:past,to=redoing?past:future,entry=from.at(-1);if(!entry)return;
    const expected=redoing?entry.before:entry.after,state=redoing?entry.after:entry.before;
    if(host.capture()?.world!==expected.world){error('The map changed outside outline editing.');return;}
    working=true;clearHold();tap=undefined;syncUI();
    try{await host.restore(state);known=state.world;target=redoing?entry.afterTarget:entry.beforeTarget;selection=redoing?entry.afterSelection:entry.beforeSelection;from.pop();to.push(entry);if(!kind||target&&kind!==target.kind){const restored=selection;start(target?.kind??kind??'parcel',target);selection=restored;}say(redoing?T.redo:T.undo);}
    catch(e){error(e);}finally{working=false;draft=undefined;cutStart=undefined;draw();}
  }
  async function remove(){if(!target||working)return;const shape=removeContourSelection(target.shape,selection);await apply({target,shape},{kind:'line'},shape?T.applied:T.removed);}
  function armCut(){if(!target||selection.kind!=='point'||selection.ring!==0||working)return;cutStart={...target.shape.outer[selection.index]};say(T.cutHint);draw();}
  function finishCut(p:Point){
    if(!target||!cutStart)return;
    try{const inserted=insertContourPoint(target.shape,p),first=inserted.shape.outer.findIndex(q=>Math.hypot(q.x-cutStart!.x,q.y-cutStart!.y)<1e-5);
      if(inserted.selection.kind!=='point'||inserted.selection.ring!==0)throw new Error(T.cutHint);
      const parts=splitContour(inserted.shape,first,inserted.selection.index);void apply({target,parts},{kind:'line'},T.split);
    }catch(e){error(e);}
  }
  function down(e:PointerEvent){
    if(!kind||working||host.busy()||e.button!==0)return;
    const action=(e.target as Element).closest('[data-contour-role]')?.getAttribute('data-contour-role');
    if(action==='delete'||action==='cut'){e.stopPropagation();return;}
    const p=point(e.clientX,e.clientY),state=host.capture();if(!state)return;
    if(cutStart&&target){if(nearestContour(target.shape,p).distance<12/host.getView().scale)finishCut(p);e.stopPropagation();e.preventDefault();return;}
    const targets=editableContours(state.world,kind,state.settings),retained=target&&targets.find(t=>t.town===target!.town&&t.id===target!.id);
    const hit=retained&&nearestContour(retained.shape,p).distance<=10/host.getView().scale?retained:contourAt(targets,p,10/host.getView().scale);
    if(!hit){target=undefined;selection={kind:'line'};draft=undefined;draw();return;}
    const same=target?.id===hit.id&&target.town===hit.town,old=selection;target=hit;draft=undefined;
    const boundary={outer:hit.shape.outer,holes:[]},vertex=contourPointAt(boundary,p,8/host.getView().scale),edge=nearestContour(boundary,p);
    const keep=same&&old.kind==='segment'&&edge.ring===old.ring&&edge.index===old.index&&!vertex;
    selection=vertex?{kind:'point',...vertex}:keep?old:{kind:'line'};
    drag={pointer:e.pointerId,start:{x:e.clientX,y:e.clientY},origin:p,base:hit.shape,selection,moved:false,index:vertex?.index??-1,tap:true};
    clearHold();if(same&&selection.kind==='line')hold=setTimeout(()=>{if(!drag||drag.moved)return;selection={kind:'segment',ring:edge.ring,index:edge.index};drag.selection=selection;drag.tap=false;tap=undefined;say(T.segment);draw();},500);
    try{host.map.setPointerCapture(e.pointerId);}catch{}e.stopPropagation();draw();
  }
  function move(e:PointerEvent){if(!drag||e.pointerId!==drag.pointer)return;
    if(Math.hypot(e.clientX-drag.start.x,e.clientY-drag.start.y)>3){drag.moved=true;clearHold();}
    if(drag.moved){const p=point(e.clientX,e.clientY);draft=translateContour(drag.base,drag.selection,p.x-drag.origin.x,p.y-drag.origin.y);draw();}e.stopPropagation();
  }
  function up(e:PointerEvent){if(!drag||e.pointerId!==drag.pointer)return;
    clearHold();const done=drag;drag=undefined;try{host.map.releasePointerCapture(e.pointerId);}catch{}e.stopPropagation();
    if(e.type==='pointercancel'){draft=undefined;draw();return;}
    if(done.moved&&draft&&target){void apply({target,shape:draft},selection,T.applied);return;}
    const previous=tap;tap=done.tap?{time:e.timeStamp,point:done.start,vertex:done.index,ring:selection.kind==='point'?selection.ring:-1}:undefined;
    if(done.tap&&previous&&e.timeStamp-previous.time<420&&Math.hypot(previous.point.x-done.start.x,previous.point.y-done.start.y)<5){
      tap=undefined;
      if(done.selection.kind==='point'&&previous.vertex===done.index&&previous.ring===done.selection.ring){selection={kind:'line'};say(T.line);draw();}
      else if(target){const inserted=insertContourPoint({outer:target.shape.outer,holes:[]},done.origin);void apply({target,shape:{...inserted.shape,holes:target.shape.holes}},inserted.selection,T.applied);}return;
    }say(selection.kind==='point'?T.point:selection.kind==='segment'?T.segment:T.line);draw();
  }
  function click(e:MouseEvent){if(!kind)return;e.stopPropagation();const action=(e.target as Element).closest('[data-contour-role]')?.getAttribute('data-contour-role');if(action==='delete')void remove();else if(action==='cut')armCut();}
  function double(e:MouseEvent){if(kind){e.preventDefault();e.stopPropagation();}}
  function wheel(e:WheelEvent){if(!kind)return;const canvas=host.map.querySelector('canvas');if(!canvas)return;e.preventDefault();canvas.dispatchEvent(new WheelEvent('wheel',{clientX:e.clientX,clientY:e.clientY,deltaX:e.deltaX,deltaY:e.deltaY,deltaMode:e.deltaMode,cancelable:true}));}
  function key(e:KeyboardEvent){
    if(e.defaultPrevented||(!kind&&!historyOwner)||document.querySelector('dialog[open]')||(e.target as Element)?.closest?.('input,textarea,select,[contenteditable=true]'))return;
    if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();e.stopImmediatePropagation();void history(e.key.toLowerCase()==='y'||e.shiftKey);}
    else if(kind&&['Delete','Backspace'].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();void remove();}
    else if(kind&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();if(drag){clearHold();drag=undefined;draft=undefined;}else if(cutStart)cutStart=undefined;else {target=undefined;selection={kind:'line'};}draw();}
    else if(kind&&e.key==='Enter'){e.preventDefault();finish.click();}
  }
  function start(next:ContourKind,chosen?:ContourTarget){
    if(host.busy()||!host.capture())return;window.dispatchEvent(new CustomEvent('v2-edit-mode',{detail:'contours'}));
    kind=next;historyOwner=true;target=chosen;selection={kind:'line'};draft=undefined;cutStart=undefined;layer.toggleAttribute('hidden',false);lastBox='';cancelAnimationFrame(frame);frame=requestAnimationFrame(follow);say(chosen?T.line:T.pick);draw();
  }
  function stop(){if(working)return;clearHold();cancelAnimationFrame(frame);kind=undefined;drag=undefined;draft=undefined;cutStart=undefined;layer.toggleAttribute('hidden',true);panel.hidden=true;syncUI();}
  function sync(){const state=host.capture();if(state?.world!==known&&!working){stop();past.length=future.length=0;target=undefined;historyOwner=false;}known=state?.world;syncUI();}
  const mode=(e:Event)=>{const next=(e as CustomEvent<string>).detail;if(next==='navigate'){stop();return;}if(next!=='contours'&&next!=='family'){stop();historyOwner=false;}};
  host.map.addEventListener('pointerdown',down,true);host.map.addEventListener('pointermove',move,true);host.map.addEventListener('pointerup',up,true);host.map.addEventListener('pointercancel',up,true);host.map.addEventListener('click',click,true);host.map.addEventListener('dblclick',double,true);
  layer.addEventListener('wheel',wheel,{passive:false});
  window.addEventListener('keydown',key,true);window.addEventListener('v2-edit-mode',mode);finish.onclick=()=>{stop();window.dispatchEvent(new CustomEvent('v2-edit-mode',{detail:'navigate'}));};undo.onclick=()=>void history();redo.onclick=()=>void history(true);
  const off=onLanguageChange(()=>{syncUI();draw();});syncUI();
  return {start,stop,sync,active:()=>!!kind,edit:(chosen:ContourTarget)=>start(chosen.kind,chosen),destroy(){stop();off();layer.removeEventListener('wheel',wheel);layer.remove();panel.remove();styles.remove();buttons.forEach(b=>b.remove());host.map.removeEventListener('pointerdown',down,true);host.map.removeEventListener('pointermove',move,true);host.map.removeEventListener('pointerup',up,true);host.map.removeEventListener('pointercancel',up,true);host.map.removeEventListener('click',click,true);host.map.removeEventListener('dblclick',double,true);window.removeEventListener('keydown',key,true);window.removeEventListener('v2-edit-mode',mode);}};
}
