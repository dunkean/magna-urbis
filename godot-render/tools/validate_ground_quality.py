"""Measure repetition and mean/contrast drift on the isolated GPU material test."""
import json
from pathlib import Path
import numpy as np
from PIL import Image


def validate(directory):
    report={}
    for name in ('periodic-reference','stochastic'):
        image=np.asarray(Image.open(directory/('ground-quality-'+name+'.png')).convert('RGB'),dtype=float)/255
        luminance=image.mean(axis=2);values=[]
        for axis in (0,1):
            a=np.take(luminance,range(luminance.shape[axis]-160),axis=axis).ravel()
            b=np.take(luminance,range(160,luminance.shape[axis]),axis=axis).ravel()
            values.append(float(np.corrcoef(a,b)[0,1]))
        report[name]={'correlationsAtOneSourcePeriod':values,'meanRgb':image.mean(axis=(0,1)).tolist(),'std':float(luminance.std())}
    before,after=report['periodic-reference'],report['stochastic']
    assert min(before['correlationsAtOneSourcePeriod'])>.9,'Reference must isolate actual source repetition'
    assert max(abs(x) for x in after['correlationsAtOneSourcePeriod'])<.35,'Source repetition still visible in stochastic synthesis'
    assert max(abs(a-b) for a,b in zip(before['meanRgb'],after['meanRgb']))<.04,'Mean drifts during synthesis'
    assert .65<after['std']/before['std']<1.65,'Unacceptable contrast loss/amplification'
    report['status']='passed'
    (directory/'ground-quality-periodicity.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report),flush=True)


if __name__=='__main__':validate(Path(__file__).resolve().parents[1]/'evidence')
