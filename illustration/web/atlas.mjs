/** Scrollable 2D battlemap mosaic. Every neighbouring tile retains a measured 20% overlap. */
const directions = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
export function neighbourView(job, direction) {
  const [dx, dy] = directions[direction] || [];
  const context = job.context, camera = context?.camera, extent = context?.extentMetres;
  if (dx === undefined || context?.projection !== 'orthographic' || !camera || !extent || !job.outputSize) throw Error('L’extension continue nécessite une battlemap 2D.');
  const [w, h] = job.outputSize;
  return { ...camera, cx: camera.cx + dx * extent.width * (w - Math.round(w * .2)) / w,
    cy: camera.cy + dy * extent.height * (h - Math.round(h * .2)) / h };
}

export function mountBattlemapAtlas({ host, requestNeighbour, onStatus }) {
  host.innerHTML = `<div class="illustration-actions"><button type="button" data-move="north">↑ Nord</button><button type="button" data-move="west">← Ouest</button><button type="button" data-move="east">Est →</button><button type="button" data-move="south">Sud ↓</button><a class="illustration-download" data-atlas-download>PNG de la tuile centrale</a></div><label style="display:block"><input type="checkbox" data-atlas-auto checked style="width:auto;min-height:0"> Prolonger au défilement · une génération OpenAI par nouvelle tuile</label><small>Glissez ou faites défiler pour explorer. Les tuiles gardent le style, l’échelle et la grille de la carte initiale. Les zones déjà générées sont réutilisées.</small><div data-atlas-pane tabindex="0" aria-label="Battlemap continue, déplacer pour explorer" style="height: min(65vh,600px);overflow:auto;position:relative;cursor:grab;touch-action:none;background:#10191c;border:1px solid #5a707a;border-radius:6px;margin-top:8px"><div data-atlas-world style="position:relative"></div></div>`;
  const pane = host.querySelector('[data-atlas-pane]'), world = host.querySelector('[data-atlas-world]');
  let tiles = new Map(), root, rootServer, origin = { x: 0, y: 0 }, tileWidth = 768, tileHeight = 512, stepX = 0, stepY = 0;
  let busy = false, armed = false, timer, disposed = false, revision = 0;
  const key = (x, y) => `${x},${y}`;
  const centre = () => ({ x: pane.scrollLeft + pane.clientWidth/2 - origin.x, y: pane.scrollTop + pane.clientHeight/2 - origin.y });
  function current() {
    const c = centre();
    return [...tiles.values()].filter(t => t.job).sort((a,b) => Math.hypot(c.x-a.x*stepX-tileWidth/2,c.y-a.y*stepY-tileHeight/2)-Math.hypot(c.x-b.x*stepX-tileWidth/2,c.y-b.y*stepY-tileHeight/2))[0];
  }
  function downloadLink() {
    const tile = current(), link = host.querySelector('[data-atlas-download]');
    if (!tile) return;
    link.href = tile.originalUrl; link.download = `battlemap-${tile.job.id}.png`;
  }
  function render(centreTile) {
    const before = origin, all = [...tiles.values()], minX = Math.min(...all.map(t=>t.x)), minY = Math.min(...all.map(t=>t.y)), maxX = Math.max(...all.map(t=>t.x)), maxY = Math.max(...all.map(t=>t.y));
    origin = { x: -minX*stepX + tileWidth*.8, y: -minY*stepY + tileHeight*.8 };
    world.style.width = `${(maxX-minX)*stepX + tileWidth*2.6}px`;
    world.style.height = `${(maxY-minY)*stepY + tileHeight*2.6}px`;
    world.replaceChildren();
    for (const tile of all) {
      const element = document.createElement(tile.url ? 'img' : 'div');
      element.style.cssText = `position:absolute;left:${origin.x+tile.x*stepX}px;top:${origin.y+tile.y*stepY}px;width:${tileWidth}px;height:${tileHeight}px;user-select:none;max-width:none;`;
      if (tile.url) { element.src = tile.url; element.alt = `Battlemap ${tile.x}, ${tile.y}`; element.draggable = false; }
      else { element.textContent = 'Génération de la zone voisine…'; element.style.background = '#25413b'; element.style.padding = '20px'; }
      world.append(element);
    }
    pane.scrollLeft += origin.x-before.x; pane.scrollTop += origin.y-before.y;
    if (centreTile) {
      pane.scrollLeft = origin.x + centreTile.x*stepX + tileWidth/2 - pane.clientWidth/2;
      pane.scrollTop = origin.y + centreTile.y*stepY + tileHeight/2 - pane.clientHeight/2;
    }
    downloadLink();
  }
  async function preview(blob) {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 1536 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width*scale); canvas.height = Math.round(bitmap.height*scale);
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close();
    const reduced = await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    return URL.createObjectURL(reduced || blob);
  }
  async function extend(parent, direction, focus=false) {
    if (busy || !parent?.job || disposed) return;
    const [dx,dy] = directions[direction], x = parent.x+dx, y = parent.y+dy, id = key(x,y);
    if (tiles.has(id)) { if(focus) render(tiles.get(id)); return; }
    if (tiles.size >= 128) { armed=false; onStatus('Cette mosaïque contient 128 tuiles. Démarrez une nouvelle mosaïque pour explorer une autre zone.'); return; }
    busy=true; const ticket=revision;
    tiles.set(id,{x,y}); render();
    for (const button of host.querySelectorAll('button')) button.disabled=true;
    try {
      const result = await requestNeighbour(parent.job,direction,[...tiles.values()].filter(t=>t.job).map(t=>t.job.id),rootServer);
      const url = await preview(result.blob);
      if(disposed || revision!==ticket){URL.revokeObjectURL(url);return;}
      const tile={x,y,job:result.job,url,originalUrl:URL.createObjectURL(result.blob)};tiles.set(id,tile); render(focus?tile:undefined);
    } catch(error) { if(ticket===revision){tiles.delete(id);render();armed=false;onStatus(error.message,true);} }
    finally { busy=false;for(const button of host.querySelectorAll('button'))button.disabled=false; }
  }
  function maybeExtend() {
    if (!root || busy || !armed || host.hidden || !host.querySelector('[data-atlas-auto]').checked) return;
    const c=centre(), x=Math.round((c.x-tileWidth/2)/stepX), y=Math.round((c.y-tileHeight/2)/stepY);
    if(tiles.get(key(x,y))?.job)return;
    const candidates=[];
    for(const tile of tiles.values())if(tile.job)for(const [direction,[dx,dy]]of Object.entries(directions))if(!tiles.has(key(tile.x+dx,tile.y+dy)))candidates.push({tile,direction,d:Math.abs(tile.x+dx-x)+Math.abs(tile.y+dy-y)});
    candidates.sort((a,b)=>a.d-b.d);
    if(candidates[0])void extend(candidates[0].tile,candidates[0].direction);
  }
  pane.addEventListener('scroll',()=>{downloadLink();clearTimeout(timer);timer=setTimeout(maybeExtend,300);});
  pane.addEventListener('wheel',()=>{armed=true;},{passive:true});
  let drag;
  pane.addEventListener('pointerdown',event=>{if(event.button!==0)return;armed=true;drag={x:event.clientX,y:event.clientY,left:pane.scrollLeft,top:pane.scrollTop};pane.setPointerCapture(event.pointerId);pane.style.cursor='grabbing';});
  pane.addEventListener('pointermove',event=>{if(!drag)return;pane.scrollLeft=drag.left+drag.x-event.clientX;pane.scrollTop=drag.top+drag.y-event.clientY;});
  const end=()=>{drag=undefined;pane.style.cursor='grab';};pane.addEventListener('pointerup',end);pane.addEventListener('pointercancel',end);
  pane.addEventListener('keydown',()=>{armed=true;});
  for(const button of host.querySelectorAll('[data-move]'))button.onclick=()=>void extend(current(),button.dataset.move,true);
  function clear(){for(const tile of tiles.values()){if(tile.url)URL.revokeObjectURL(tile.url);if(tile.originalUrl)URL.revokeObjectURL(tile.originalUrl);}tiles=new Map();root=undefined;}
  return {
    async setRoot(job,blob,server){
      if(root?.id===job.id)return;const ticket=++revision;clear();armed=false;root=job;rootServer=server;
      tileHeight=tileWidth*job.outputSize[1]/job.outputSize[0];
      stepX=tileWidth*(1-Math.round(job.outputSize[0]*.2)/job.outputSize[0]);stepY=tileHeight*(1-Math.round(job.outputSize[1]*.2)/job.outputSize[1]);
      const url=await preview(blob);if(disposed||revision!==ticket){URL.revokeObjectURL(url);return;}
      const tile={x:0,y:0,job,url,originalUrl:URL.createObjectURL(blob)};tiles.set(key(0,0),tile);render(tile);
    },
    dispose(){disposed=true;++revision;clearTimeout(timer);clear();host.replaceChildren();}
  };
}
