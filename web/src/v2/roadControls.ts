import type { Polyline, Vec2 } from '../gen/types';

/** Screen-space handles are a view of the path; no geometry is simplified or lost. */
export function roadControlIndices(path: readonly Vec2[], scale: number, active = -1): number[] {
  if (path.length < 2) return path.map((_, i) => i);
  const tolerance = 10 / Math.max(scale, 1e-9), keep = new Set([0, path.length - 1]);
  if (active > 0 && active < path.length - 1) keep.add(active);
  // Keep sharp, visible turns even when they are close to the simplified chord.
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1], b = path[i], c = path[i + 1];
    const ux = b.x-a.x, uy = b.y-a.y, vx = c.x-b.x, vy = c.y-b.y;
    const la = Math.hypot(ux,uy), lb = Math.hypot(vx,vy);
    if (la * scale >= 4 && lb * scale >= 4 && (ux*vx+uy*vy)/(la*lb) < .34) keep.add(i);
  }
  // Iterative Ramer–Douglas–Peucker, seeded by the required sharp turns.
  const anchors = [...keep].sort((a,b)=>a-b), stack: [number,number][] = [];
  for (let i=1;i<anchors.length;i++) stack.push([anchors[i-1],anchors[i]]);
  while (stack.length) {
    const [a,b]=stack.pop()!, p=path[a], q=path[b], dx=q.x-p.x, dy=q.y-p.y, den=dx*dx+dy*dy;
    let best=tolerance, index=-1;
    for(let i=a+1;i<b;i++) {
      const t=den?Math.max(0,Math.min(1,((path[i].x-p.x)*dx+(path[i].y-p.y)*dy)/den)):0;
      const d=Math.hypot(path[i].x-p.x-dx*t,path[i].y-p.y-dy*t);
      if(d>best){best=d;index=i;}
    }
    if(index>=0){keep.add(index);stack.push([a,index],[index,b]);}
  }
  return [...keep].sort((a,b)=>a-b);
}

/** Point halfway by length between displayed controls and its original segment. */
export function roadControlMidpoint(path: readonly Vec2[], left: number, right: number): { point: Vec2; segment: number; length: number } {
  let length=0; for(let i=left+1;i<=right;i++) length+=Math.hypot(path[i].x-path[i-1].x,path[i].y-path[i-1].y);
  let remain=length/2;
  for(let i=left+1;i<=right;i++) {
    const a=path[i-1],b=path[i],d=Math.hypot(b.x-a.x,b.y-a.y);
    if(remain<=d && d>0){const t=remain/d;return {point:{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},segment:i-1,length};}
    remain-=d;
  }
  return {point:{...path[left]},segment:left,length};
}

/** Move a handle with smooth falloff to the adjacent displayed controls. */
export function deformRoadControl(path: readonly Vec2[], index: number, left: number, right: number, target: Vec2): Polyline {
  const distances = new Float64Array(path.length);
  for(let i=left+1;i<=right;i++) distances[i]=distances[i-1]+Math.hypot(path[i].x-path[i-1].x,path[i].y-path[i-1].y);
  const dx=target.x-path[index].x,dy=target.y-path[index].y;
  return path.map((p,i)=>{
    if(i<left||i>right)return {...p};
    let t = i===index ? 1 : i<index ? (distances[index]>distances[left] ? (distances[i]-distances[left])/(distances[index]-distances[left]) : 0)
      : (distances[right]>distances[index] ? (distances[right]-distances[i])/(distances[right]-distances[index]) : 0);
    t=Math.max(0,Math.min(1,t));t=t*t*(3-2*t);
    return {x:p.x+dx*t,y:p.y+dy*t};
  });
}

/** Removing a handle replaces just the interval between adjacent handles. */
export function removeRoadControl(path: readonly Vec2[], controls: readonly number[], index: number): Polyline {
  const pos=controls.indexOf(index);
  if(pos<=0 || pos>=controls.length-1) return path.map(p=>({...p}));
  const left=controls[pos-1],right=controls[pos+1];
  return [...path.slice(0,left+1),...path.slice(right)].map(p=>({...p}));
}
