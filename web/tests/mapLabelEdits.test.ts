import { describe, expect, it } from 'vitest';
import { applyLabelEdits, labelCandidates } from '../src/v2/mapLabels';
import type { World } from '../src/gen/types';
describe('authored map labels', () => {
  it('overwrites generated labels and adds free and native parcel labels', () => {
    const world = { names: { family: 'english', town: 'Town', entries: [{ id:'n1', kind:'river', text:'River', rank:0, anchor:{x:1,y:2}, path:[{x:1,y:2},{x:3,y:4}] }] }, debug:{v2RustCities:{main:{layouts:[],partitions:[{key:'main',parcels:[{id:'p1',shape:{outer:[{x:0,y:0},{x:2,y:0},{x:2,y:2}]}}]}]}}} } as unknown as World;
    const parcel = labelCandidates(world).find(c => c.kind === 'parcel')!;
    applyLabelEdits(world, { n1:{text:'New river',anchor:{x:5,y:6},style:{color:'#123456',size:1.5}}, [parcel.id]:{text:'Garden'}, 'free:one':{kind:'free',text:'Note',anchor:{x:7,y:8}} });
    expect(world.names!.entries.map(e => e.text)).toEqual(['New river','Garden','Note']);
    expect(world.names!.entries[0]).toMatchObject({anchor:{x:5,y:6},path:undefined,manual:true,labelStyle:{color:'#123456',size:1.5}});
    expect(world.names!.entries[1].anchor.x).toBeCloseTo(4/3);
  });
});
