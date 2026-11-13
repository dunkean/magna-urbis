/** Independent sculpt layer: offsets in metres, never a replacement generation source. */
export interface TerrainModification { version: 1; resolution: number; width: number; delta: number[] }
export function validateTerrainModification(value: unknown): asserts value is TerrainModification {
  const m=value as TerrainModification;
  if(!m||m.version!==1||!Number.isInteger(m.resolution)||m.resolution<16||m.resolution>8192||!Number.isFinite(m.width)||m.width<500||m.width>200000||!Array.isArray(m.delta)||m.delta.length!==m.resolution**2||m.delta.some(v=>!Number.isFinite(v)||Math.abs(v)>24000))throw Error('Invalid relief modification layer.');
}
export function applyTerrainModification(base: Float32Array, n: number, modification: TerrainModification): Float32Array {
  validateTerrainModification(modification);
  const m=modification.resolution,out=base.slice();
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const sx=Math.max(0,Math.min(m-1,(x+.5)*m/n-.5)),sy=Math.max(0,Math.min(m-1,(y+.5)*m/n-.5)),ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;
    const a=modification.delta[iy*m+ix]*(1-fx)+modification.delta[iy*m+Math.min(m-1,ix+1)]*fx;
    const b=modification.delta[Math.min(m-1,iy+1)*m+ix]*(1-fx)+modification.delta[Math.min(m-1,iy+1)*m+Math.min(m-1,ix+1)]*fx;
    out[y*n+x]=Math.max(-12000,Math.min(12000,base[y*n+x]+a*(1-fy)+b*fy));
  }
  return out;
}
