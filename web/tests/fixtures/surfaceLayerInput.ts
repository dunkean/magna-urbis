import { DEFAULT_ROCK_UNITS } from '../../src/surface/materials';
import { Occupation,WaterClass,type SurfaceCompileInput } from '../../src/surface/model';

/** Same explicit terrain/context used to record the frozen pre-layer baseline. */
export function surfaceLayerInput():SurfaceCompileInput {
  const width=17,spacingM=32,n=width*width;
  const heights=Float32Array.from({length:n},(_,i)=>{const x=(i%width)*spacingM,z=Math.floor(i/width)*spacingM;return 120+x*.015+z*.01+Math.max(0,x-256)*1.2;});
  const classes=new Uint8Array(n),waterClass=new Uint8Array(n),waterLevelM=new Float32Array(n).fill(NaN);
  classes[6*width+3]=Occupation.Road;classes[4*width+5]=Occupation.Built;classes[9*width+4]=Occupation.Meadow;
  classes[11*width+4]=Occupation.Orchard;classes[13*width+4]=Occupation.Crop;
  waterClass[width+1]=WaterClass.Lake;waterLevelM[width+1]=heights[width+1]+1;
  return{seed:37,terrain:{width,height:width,spacingM,originX:0,originZ:0,heights,
    source:{id:'layer-fixture-heightfield',version:'v1',sourceLOD:0,sourceLODKnown:true,nativeSpacingM:32}},
    geology:{version:'mapped-contact',provenance:'Authored test map: granite west, basalt east',units:[DEFAULT_ROCK_UNITS[0],DEFAULT_ROCK_UNITS[4]],
      bedrock:Uint16Array.from({length:n},(_,i)=>i%width<8?1:5)},
    climate:{version:'same-humid-climate',meanAnnualTempC:14,annualPrecipMm:1500,elevationCorrected:true},
    occupation:{version:'declared-test-parcels',classes},
    hydrology:{version:'declared-lake',provenance:'One real wet support test cell',waterClass,waterLevelM}};
}
