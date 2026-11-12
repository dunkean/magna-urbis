/** Scrollable 2D battlemap mosaic. Neighbours retain a measured 20% overlap. */
const directions = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
const labels = { north: '↑ Nord', south: 'Sud ↓', west: '← Ouest', east: 'Est →' };

export function neighbourView(job, direction) {
  const [dx, dy] = directions[direction] || [];
  const context = job.context, camera = context?.camera, extent = context?.extentMetres;
  if (dx === undefined || context?.projection !== 'orthographic' || !camera || !extent || !job.outputSize) throw Error('L’extension continue nécessite une battlemap 2D.');
  const [w, h] = job.outputSize;
  return { ...camera, cx: camera.cx + dx * extent.width * (w - Math.round(w * .2)) / w,
    cy: camera.cy + dy * extent.height * (h - Math.round(h * .2)) / h };
}

export function mountBattlemapAtlas({ host, requestNeighbour, requestMosaic, getRelated, onCurrent, onStatus }) {
  host.innerHTML = `<div class="illustration-actions">${Object.entries(labels).map(([direction,label])=>`<button type="button" data-move="${direction}">${label}</button>`).join('')}<a class="illustration-download" data-atlas-download>PNG de la tuile courante</a><button type="button" data-atlas-export>Exporter la carte globale PNG</button><a class="illustration-download" data-atlas-mosaic-download hidden>Télécharger la carte globale PNG</a></div><p data-atlas-current></p><label style="display:block"><input type="checkbox" data-atlas-auto checked style="width:auto;min-height:0"> Prolonger au défilement · une génération OpenAI par nouvelle tuile</label><small>Glissez pour explorer ou cliquez sur une tuile pour la sélectionner. Les voisins déjà générés sont réutilisés. Le PNG global réunit toutes les tuiles terminées à leur résolution d’origine ; les zones non générées restent transparentes.</small><div data-atlas-pane tabindex="0" aria-label="Battlemap continue, déplacer pour explorer" style="height:min(65vh,600px);overflow:auto;position:relative;cursor:grab;touch-action:none;background:#10191c;border:1px solid #5a707a;border-radius:6px;margin-top:8px"><div data-atlas-world style="position:relative"></div></div>`;
  const pane = host.querySelector('[data-atlas-pane]'), world = host.querySelector('[data-atlas-world]');
  const download = host.querySelector('[data-atlas-download]'), exportButton = host.querySelector('[data-atlas-export]');
  const globalDownload = host.querySelector('[data-atlas-mosaic-download]');
  let tiles = new Map(), root, rootServer, selected, notified;
  let origin = { x: 0, y: 0 }, tileWidth = 768, tileHeight = 512, stepX = 0, stepY = 0;
  let busy = false, loading = false, exporting = false, armed = false, timer, disposed = false, revision = 0;
  let drag, dragged = false;
  const key = (x, y) => `${x},${y}`;
  const complete = () => [...tiles.values()].filter(tile => tile.job);
  const centre = () => ({ x: pane.scrollLeft + pane.clientWidth/2 - origin.x, y: pane.scrollTop + pane.clientHeight/2 - origin.y });
  function current() {
    // Hidden panes have no usable scroll geometry: retain their selected parent.
    if (host.hidden || !pane.clientWidth) return tiles.get(selected) || complete()[0];
    const c = centre();
    return complete().sort((a,b) => Math.hypot(c.x-a.x*stepX-tileWidth/2,c.y-a.y*stepY-tileHeight/2)-Math.hypot(c.x-b.x*stepX-tileWidth/2,c.y-b.y*stepY-tileHeight/2))[0];
  }
  function syncControls() {
    const tile = current();
    if (tile) {
      selected = key(tile.x,tile.y);
      download.href = tile.originalUrl; download.download = `battlemap-${tile.job.id}.png`;
      host.querySelector('[data-atlas-current]').textContent = `Vue courante : ${tile.x}, ${tile.y} · ${complete().length} tuiles terminées`;
      if (notified !== tile.job.id) { notified = tile.job.id; onCurrent?.(tile.job,rootServer); }
    }
    for (const button of host.querySelectorAll('[data-move]')) {
      const [dx,dy] = directions[button.dataset.move];
      const neighbour = tile && tiles.get(key(tile.x+dx,tile.y+dy));
      button.disabled = loading || !tile || (busy && !neighbour?.job);
      button.title = neighbour?.job ? 'Voir la tuile déjà générée' : 'Générer depuis la vue courante';
    }
    exportButton.disabled = loading || exporting || !requestMosaic || !complete().length;
    exportButton.textContent = exporting ? 'Assemblage du PNG global…' : `Exporter la carte globale PNG (${complete().length} tuiles)`;
  }
  function render(centreTile) {
    const all = [...tiles.values()];
    if (!all.length) { world.replaceChildren(); syncControls(); return; }
    const before = origin;
    const minX = Math.min(...all.map(t=>t.x)), minY = Math.min(...all.map(t=>t.y));
    const maxX = Math.max(...all.map(t=>t.x)), maxY = Math.max(...all.map(t=>t.y));
    origin = { x: -minX*stepX + tileWidth*.8, y: -minY*stepY + tileHeight*.8 };
    world.style.width = `${(maxX-minX)*stepX + tileWidth*2.6}px`;
    world.style.height = `${(maxY-minY)*stepY + tileHeight*2.6}px`;
    world.replaceChildren();
    for (const tile of all) {
      const element = document.createElement(tile.url ? 'img' : 'div');
      element.style.cssText = `position:absolute;left:${origin.x+tile.x*stepX}px;top:${origin.y+tile.y*stepY}px;width:${tileWidth}px;height:${tileHeight}px;user-select:none;max-width:none;`;
      if (tile.url) {
        element.src=tile.url; element.alt=`Battlemap ${tile.x}, ${tile.y}`;
        element.draggable=false; element.loading='lazy'; element.decoding='async';
        element.onclick=()=>{if(!dragged)focus(tile);};
      } else {
        element.textContent='Génération de la zone voisine…'; element.style.background='#25413b'; element.style.padding='20px';
      }
      world.append(element);
    }
    pane.scrollLeft += origin.x-before.x; pane.scrollTop += origin.y-before.y;
    if (centreTile) {
      selected=key(centreTile.x,centreTile.y);
      pane.scrollLeft=origin.x+centreTile.x*stepX+tileWidth/2-pane.clientWidth/2;
      pane.scrollTop=origin.y+centreTile.y*stepY+tileHeight/2-pane.clientHeight/2;
    }
    syncControls();
  }
  function focus(tile) { armed=false; render(tile); }
  async function preview(blob) {
    const bitmap=await createImageBitmap(blob), scale=Math.min(1,1536/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
    const reduced=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    return URL.createObjectURL(reduced || blob);
  }
  async function extend(parent,direction,move=false) {
    if(!parent?.job || disposed || loading)return;
    const [dx,dy]=directions[direction],x=parent.x+dx,y=parent.y+dy,id=key(x,y),existing=tiles.get(id);
    // An existing neighbour stays navigable even while a new tile is generating.
    if(existing?.job){if(move)focus(existing);return;}
    if(busy || existing)return;
    if(tiles.size>=128){armed=false;onStatus('Cette mosaïque contient 128 tuiles. Démarrez une autre mosaïque pour explorer une nouvelle zone.');return;}
    busy=true;const ticket=revision;tiles.set(id,{x,y});render();
    try {
      const result=await requestNeighbour(parent.job,direction,complete().map(tile=>tile.job.id),rootServer),url=await preview(result.blob);
      if(disposed || revision!==ticket){URL.revokeObjectURL(url);return;}
      const tile={x,y,job:result.job,url,originalUrl:URL.createObjectURL(result.blob)};
      const follow=move && selected===key(parent.x,parent.y);
      tiles.set(id,tile);globalDownload.hidden=true;render(follow?tile:undefined);
    } catch(error) {
      if(ticket===revision){tiles.delete(id);render();armed=false;onStatus(error.message,true);}
    } finally {if(ticket===revision){busy=false;syncControls();}}
  }
  function maybeExtend() {
    if(!root || busy || loading || !armed || host.hidden || !host.querySelector('[data-atlas-auto]').checked)return;
    const c=centre(),x=Math.round((c.x-tileWidth/2)/stepX),y=Math.round((c.y-tileHeight/2)/stepY);
    if(tiles.get(key(x,y))?.job)return;
    const candidates=[];
    for(const tile of complete())for(const [direction,[dx,dy]]of Object.entries(directions))if(!tiles.has(key(tile.x+dx,tile.y+dy)))candidates.push({tile,direction,d:Math.abs(tile.x+dx-x)+Math.abs(tile.y+dy-y)});
    candidates.sort((a,b)=>a.d-b.d);
    if(candidates[0])void extend(candidates[0].tile,candidates[0].direction);
  }
  pane.addEventListener('scroll',()=>{syncControls();clearTimeout(timer);timer=setTimeout(maybeExtend,300);});
  pane.addEventListener('wheel',()=>{armed=true;},{passive:true});
  pane.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;armed=true;dragged=false;drag={x:event.clientX,y:event.clientY,left:pane.scrollLeft,top:pane.scrollTop};
    pane.setPointerCapture(event.pointerId);pane.style.cursor='grabbing';
  });
  pane.addEventListener('pointermove',event=>{
    if(!drag)return;if(Math.hypot(drag.x-event.clientX,drag.y-event.clientY)>4)dragged=true;
    pane.scrollLeft=drag.left+drag.x-event.clientX;pane.scrollTop=drag.top+drag.y-event.clientY;
  });
  const end=()=>{drag=undefined;pane.style.cursor='grab';};
  pane.addEventListener('pointerup',end);pane.addEventListener('pointercancel',end);
  pane.addEventListener('keydown',()=>{armed=true;});
  for(const button of host.querySelectorAll('[data-move]'))button.onclick=()=>void extend(current(),button.dataset.move,true);
  exportButton.onclick=async()=>{
    if(exporting || !requestMosaic)return;
    exporting=true;const ticket=revision,ids=complete().map(tile=>tile.job.id);syncControls();onStatus(`Assemblage de ${ids.length} tuiles à leur résolution d’origine…`);
    try {
      const result=await requestMosaic(ids,rootServer);if(disposed || revision!==ticket)return;
      const url=new URL(result.url,rootServer);
      if(url.origin!==new URL(rootServer).origin || !url.pathname.startsWith('/v1/illustrations/mosaics/'))throw Error('Adresse d’export invalide.');
      globalDownload.href=url.href;globalDownload.download=result.filename;globalDownload.hidden=false;
      globalDownload.textContent=`Télécharger le PNG global · ${result.width} × ${result.height} px`;globalDownload.click();
      onStatus(`PNG global prêt · ${result.width} × ${result.height} px · ${result.tiles} tuiles. Le lien de téléchargement reste disponible.`);
    } catch(error){if(ticket===revision)onStatus(error.message,true);}
    finally{if(ticket===revision){exporting=false;syncControls();}}
  };
  function clear(){
    for(const tile of tiles.values())for(const url of [tile.url,tile.originalUrl])if(url?.startsWith('blob:'))URL.revokeObjectURL(url);
    tiles=new Map();root=undefined;selected=undefined;notified=undefined;
  }
  syncControls();
  return {
    async setRoot(job,blob,server){
      const existing=complete().find(tile=>tile.job.id===job.id);
      if(existing && rootServer===server){focus(existing);return;}
      const ticket=++revision;clear();armed=false;busy=false;exporting=false;loading=true;root=job;rootServer=server;globalDownload.hidden=true;syncControls();
      tileHeight=tileWidth*job.outputSize[1]/job.outputSize[0];
      const xStepPixels=job.outputSize[0]-Math.round(job.outputSize[0]*.2),yStepPixels=job.outputSize[1]-Math.round(job.outputSize[1]*.2);
      stepX=tileWidth*xStepPixels/job.outputSize[0];stepY=tileHeight*yStepPixels/job.outputSize[1];
      try {
        const url=await preview(blob);if(disposed || revision!==ticket){URL.revokeObjectURL(url);return;}
        const tile={x:0,y:0,job,url,originalUrl:URL.createObjectURL(blob)};tiles.set(key(0,0),tile);
        if(getRelated){
          const related=await getRelated(job,server);if(disposed || revision!==ticket)return;
          const metresX=job.context.extentMetres.width*xStepPixels/job.outputSize[0],metresY=job.context.extentMetres.height*yStepPixels/job.outputSize[1];
          for(const other of related.jobs || []){
            if(other.id===job.id || other.status!=='succeeded')continue;
            const x=(other.context.camera.cx-job.context.camera.cx)/metresX,y=(other.context.camera.cy-job.context.camera.cy)/metresY;
            if(Math.abs(x-Math.round(x))>.001 || Math.abs(y-Math.round(y))>.001)continue;
            tiles.set(key(Math.round(x),Math.round(y)),{x:Math.round(x),y:Math.round(y),job:other,url:`${server}/v1/illustrations/jobs/${other.id}/preview.png`,originalUrl:`${server}/v1/illustrations/jobs/${other.id}/result.png?download=1`});
          }
        }
        loading=false;render(tile);
      }catch(error){if(ticket===revision){loading=false;render(tiles.get(key(0,0)));throw error;}}
      finally{if(ticket===revision){loading=false;syncControls();}}
    },
    move(direction){return extend(current(),direction,true);},
    current(){const tile=current();return tile && {job:tile.job,server:rootServer};},
    dispose(){disposed=true;++revision;clearTimeout(timer);clear();host.replaceChildren();}
  };
}
