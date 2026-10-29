"""Compare upstream samplers on an actual retained Magna FP32 heightfield.

Uses the sibling Neural Earth environment, without loading model weights.
Outputs regional-context / local-detail figures, FP32 tiles and a JSON report.
The default measurements cover one local window, not regional convergence.
"""
from __future__ import annotations
import argparse
import hashlib
import heapq
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
EARTH = Path(os.environ.get('MAGNA_NEURAL_EARTH', ROOT.parent / 'infinite_map')).resolve()
sys.path[:0] = [str(EARTH), str(EARTH / 'backend'), str(EARTH / 'terrain-diffusion'), str(Path(__file__).parent)]
import numpy as np
import torch
import neural_refinement as refinement


def fill_metrics(height):
    """D8 minimum fill against open tile edges; diagnostic, not lake policy."""
    n = height.shape[0]
    filled, seen, queue = height.copy(), np.zeros_like(height, dtype=bool), []
    for y in range(n):
        for x in range(n):
            if y in (0, n-1) or x in (0, n-1):
                seen[y, x] = True
                heapq.heappush(queue, (float(height[y, x]), y, x))
    while queue:
        value, y, x = heapq.heappop(queue)
        for dy, dx in ((-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)):
            yy, xx = y+dy, x+dx
            if 0 <= yy < n and 0 <= xx < n and not seen[yy,xx]:
                seen[yy,xx] = True
                filled[yy,xx] = max(value, float(height[yy,xx]))
                heapq.heappush(queue, (float(filled[yy,xx]), yy, xx))
    delta = filled.astype(np.float64)-height
    return dict(fillFractionOver1cm=float(np.mean(delta > .01)), fillMaxM=float(delta.max()), fillMeanM=float(delta.mean()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--source-resolution', type=int, default=512)
    parser.add_argument('--width', type=float, default=50000)
    parser.add_argument('--seed', type=int, default=17)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--device', choices=['cpu','cuda'], default='cuda' if torch.cuda.is_available() else 'cpu')
    parser.add_argument('--modes', nargs='+', default=['classic','phasor','hybrid','mse'])
    parser.add_argument('--levels', nargs='+', type=int, default=[2,4])
    parser.add_argument('--resolution', type=int, default=128)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(2)
    values = np.fromfile(args.source, dtype='<f4').reshape(args.source_resolution,args.source_resolution)
    # Select a rugged interior location in the real generated regional DEM.
    gy,gx = np.gradient(values.astype(np.float64),args.width/args.source_resolution)
    strength = gx*gx+gy*gy
    border = args.source_resolution//5
    strength[:border] = strength[-border:] = 0
    strength[:,:border] = strength[:,-border:] = 0
    y,x = np.unravel_index(np.argmax(strength),values.shape)
    center = ((x+.5)*args.width/args.source_resolution,(y+.5)*args.width/args.source_resolution)
    report = dict(format='magna-upstream-amplification-benchmark-v1',
        upstreamCommit=subprocess.check_output(['git','-C',str(EARTH),'rev-parse','HEAD'],text=True).strip(),
        sourceSHA256=hashlib.sha256(args.source.read_bytes()).hexdigest(),
        sourceResolution=args.source_resolution,sourceWidthM=args.width,centerM=center,
        hardware=dict(cpu=platform.processor(),torch=torch.__version__,device=args.device,
                      gpu=torch.cuda.get_device_name(0) if args.device=='cuda' else None),
        decoderUsed=False,scope='Actual Magna TerrainGenerator source; local refinement only, no neural weights; open-window fill is not global hydrology',
        records=[])
    tiles = {}
    def sync():
        if args.device == 'cuda': torch.cuda.synchronize()
    for mode in args.modes:
        body=dict(n=args.source_resolution,width=args.width,seed=args.seed,heights=values.ravel().tolist(),amplification=mode)
        registration=refinement.register(body)
        source=refinement._SOURCES[registration['id']]
        # Registration chooses the available device; explicitly honor CPU runs.
        if str(source.device) != args.device:
            source.device=torch.device(args.device)
            source.values=source.values.to(source.device)
            source.world.device=source.device
            source.world._terrain_refinement_fields[1]=refinement._ZeroDetail(source.device)
        for level in args.levels:
            n=args.resolution
            step=30/2**level
            width=step*n
            request=dict(id=registration['id'],x=center[0]-width/2,y=center[1]-width/2,width=width,resolution=n)
            sync(); start=time.perf_counter()
            data,meta=refinement.tile(request)
            sync(); first_ms=(time.perf_counter()-start)*1000
            h=np.frombuffer(data,dtype='<f4').reshape(n,n).copy()
            sync(); start=time.perf_counter()
            replay,_=refinement.tile(request)
            sync(); replay_ms=(time.perf_counter()-start)*1000
            # Same coordinates sampled in four quadrants: detect tile-local seams.
            chunks=[]
            for row in (0,1):
                columns=[]
                for col in (0,1):
                    part=dict(request,x=request['x']+col*width/2,y=request['y']+row*width/2,width=width/2,resolution=n//2)
                    raw,_=refinement.tile(part)
                    columns.append(np.frombuffer(raw,dtype='<f4').reshape(n//2,n//2))
                chunks.append(np.concatenate(columns,axis=1))
            mosaic=np.concatenate(chunks,axis=0)
            # Warm new request is distinct from a cached replay.
            sync(); start=time.perf_counter()
            refinement.tile(dict(request,x=request['x']+step*3))
            sync(); warm_ms=(time.perf_counter()-start)*1000
            xx=torch.as_tensor(request['x']+(np.arange(n)+.5)*step,device=source.device)
            yy=torch.as_tensor(request['y']+(np.arange(n)+.5)*step,device=source.device)
            bare=source.sample(xx,yy).cpu().numpy()
            delta=h-bare
            record=dict(mode=mode,level=level,cellM=step,widthM=width,resolution=n,firstMs=first_ms,
                warmDistinctMs=warm_ms,cachedReplayMs=replay_ms,deterministic=data==replay,
                mosaicMaxM=float(np.max(np.abs(h-mosaic))),finite=bool(np.isfinite(h).all()),
                landSeaPreserved=bool(np.all((h>0)==(bare>0))),deltaRmsM=float(np.sqrt(np.mean(delta**2))),
                deltaMaxM=float(np.abs(delta).max()),metadata=meta,**fill_metrics(h))
            tiles[mode,level]=(h,delta)
            h.astype('<f4').tofile(args.out/f'{mode}-level{level}.f32')
            report['records'].append(record)
            print(json.dumps(record),flush=True)
            (args.out/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        refinement.release(dict(id=registration['id']))
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        from matplotlib.colors import LightSource
        fig,axes=plt.subplots(len(args.levels)*2,len(args.modes),figsize=(4*len(args.modes),6*len(args.levels)),squeeze=False)
        for k,level in enumerate(args.levels):
            span=max(np.max(np.abs(tiles[mode,level][1])) for mode in args.modes)
            for j,mode in enumerate(args.modes):
                h,delta=tiles[mode,level]
                step=30/2**level
                shade=LightSource(315,45).hillshade(h,dx=step,dy=step)
                axes[2*k,j].imshow(shade,cmap='gray',vmin=0,vmax=1)
                axes[2*k,j].set_title(f'{mode} | {step:g} m/cell')
                axes[2*k+1,j].imshow(delta,cmap='RdBu_r',vmin=-span,vmax=span)
                axes[2*k+1,j].set_title(f'delta vs retained spline | +/-{span:.2f} m')
                axes[2*k,j].axis('off'); axes[2*k+1,j].axis('off')
        fig.suptitle('Actual Magna regional terrain, local enhancement without neural decoder')
        fig.tight_layout()
        fig.savefig(args.out/'comparison.png',dpi=130)
        plt.close(fig)
    except ImportError:
        print('matplotlib unavailable; JSON and heightfields saved',file=sys.stderr)
    failures=[r for r in report['records'] if not r['finite'] or not r['deterministic'] or not r['landSeaPreserved'] or r['mosaicMaxM'] > .001]
    if failures: raise RuntimeError(f'{len(failures)} refinement invariant failures; see report.json')


if __name__ == '__main__':
    main()
