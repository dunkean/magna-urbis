import { describe, expect, it } from 'vitest';
import { roadControlIndices, roadControlMidpoint, deformRoadControl, removeRoadControl } from '../../src/v2/roadControls';

describe('road edit handles',()=>{
  it('shows a few handles for a sampled straight route without changing its points',()=>{
    const path=Array.from({length:201},(_,i)=>({x:i,y:0})), original=structuredClone(path);
    expect(roadControlIndices(path,1)).toEqual([0,200]);
    expect(path).toEqual(original);
    expect(roadControlIndices(path,1,100)).toEqual([0,100,200]);
  });
  it('retains visible sharp turns and updates with zoom',()=>{
    const path=[{x:0,y:0},{x:40,y:0},{x:40,y:40},{x:80,y:40}];
    expect(roadControlIndices(path,1)).toEqual([0,1,2,3]);
    expect(roadControlIndices(path,.01)).toEqual([0,3]);
  });
  it('deforms just the neighboring interval smoothly without flattening samples',()=>{
    const path=Array.from({length:9},(_,i)=>({x:i,y:i%2*.1}));
    const moved=deformRoadControl(path,4,2,6,{x:4,y:2});
    expect(moved.length).toBe(path.length);expect(moved[4]).toEqual({x:4,y:2});
    expect(moved[0]).toEqual(path[0]);expect(moved[2]).toEqual(path[2]);expect(moved[6]).toEqual(path[6]);expect(moved[8]).toEqual(path[8]);
    expect(moved[3].y).toBeGreaterThan(path[3].y);expect(moved[5].y).toBeGreaterThan(path[5].y);
  });
  it('finds a midpoint on the original route and removes only an explicit interval',()=>{
    const path=[{x:0,y:0},{x:3,y:0},{x:3,y:4},{x:7,y:4},{x:10,y:4}];
    expect(roadControlMidpoint(path,0,4)).toEqual({point:{x:3,y:4},segment:1,length:14});
    expect(removeRoadControl(path,[0,2,4],2)).toEqual([path[0],path[4]]);
    expect(removeRoadControl(path,[0,2,4],0)).toEqual(path);
  });
});
