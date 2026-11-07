/** V2 water types. Computation lives in magna-urbis-terrain::vector_water. */
export interface RiverMetrics {
  hack?: number;
  flint?: number;
  bifurcation?: number;
  /** Highest Strahler order. */
  order: number;
  /** Median meander wavelength, in channel widths. */
  wavelength?: number;
  /** Mean sinuosity of meandering runs. */
  sinuosity?: number;
  /** Median confluence angle, degrees. */
  confluence?: number;
}
