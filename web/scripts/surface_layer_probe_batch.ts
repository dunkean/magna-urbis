export function parseLayerProbeWidths(value = '10000'): number[] {
  const words=value.split(',').map(v=>v.trim());
  if(!words.length||words.length>8||words.some(v=>!v))throw new Error('Layer probe widths require1..8 comma-separated values');
  const widths=words.map(Number);
  if(widths.some(v=>!Number.isFinite(v)||v<10||v>40000)||new Set(widths).size!==widths.length)throw new Error('Layer probe widths must be unique finite metres in10..40000');
  return widths;
}

/** The old single-view result may remain as a compatibility alias. Global
 * success depends on the full declared batch, never that first result alone. */
export function assertCompletedLayerProbeBatch(value:unknown,widths:readonly number[]):void {
  if(!Array.isArray(value)||value.length!==widths.length)throw new Error('Missing requested layer-probe views');
  for(let i=0;i<widths.length;i++){
    const phase=value[i];
    if(!phase||phase.status!=='complete'||phase.widthM!==widths[i]||phase.result?.status!=='complete'||!Number.isFinite(phase.result.widthM)
      ||Math.abs(phase.result.widthM-widths[i])>1e-9*widths[i]||phase.result.requireInstances!==(widths[i]<=160))throw new Error('Layer probe batch contains incomplete, misrouted or unqualified view');
  }
}
