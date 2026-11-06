/** Detailed erosion budgets are only exposed inside the super advanced controls. */
export function isTerrainExpertControl(path: string): boolean {
  return path === 'terrain.erosion' || path === 'terrain.phasor.quality'
    || path.startsWith('terrain.erosionTuning.')
    || /^terrain\.procedural\.(regionalN|surfaceN|uplift|regionalThermal|regionalDiffusion|erosionTuning|coastIterations|coastIncision|coastThermal|coastDiffusion|posterior|wind)(\.|$)/.test(path)
    || /^terrain\.hydrology\.(erosionEnabled|showErosion|condMode|condStrength|condDepth|condLength)$/.test(path);
}
