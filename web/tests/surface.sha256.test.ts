import{describe,it,expect}from'vitest';
import{createHash}from'node:crypto';
import{SurfaceSha256}from'../src/surface/sha256';
describe('synchronous streamed ground-response SHA256',()=>{
  it('matches known empty/abc vectors and rejects writes after finalization',()=>{
    const empty=new SurfaceSha256();expect(empty.hex()).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');expect(empty.hex()).toBe(empty.hex());
    expect(new SurfaceSha256().update(new TextEncoder().encode('abc')).hex()).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(()=>empty.update(new Uint8Array())).toThrow(/finalized/);
  });
  it('matches Node crypto at every padding boundary and random split/offset, including the real512 column-byte count',()=>{
    let random=753;const next=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random;};
    for(const length of [0,1,2,55,56,57,63,64,65,119,120,127,128,129,1001,6815744]){
      const storage=Uint8Array.from({length:length+29},()=>next()&255),data=storage.subarray(13,13+length),expected=createHash('sha256').update(data).digest('hex');
      expect(new SurfaceSha256().update(data).hex()).toBe(expected);
      for(let pass=0;pass<(length>10000?1:10);pass++){
        const context=new SurfaceSha256();for(let p=0;p<data.length;){const end=Math.min(data.length,p+1+next()%(length>10000?4096:67));context.update(data.subarray(p,end));if(next()%7===0)context.update(new Uint8Array());p=end;}
        expect(context.hex()).toBe(expected);
      }
    }
  });
});
