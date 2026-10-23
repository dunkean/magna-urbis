"""Two gains with/without retained entrance, preserving their actual batch prefix."""
from pathlib import Path
import json,hashlib,subprocess
ROOT=Path(__file__).resolve().parents[2]
P=ROOT/'web/out/initial-terrain-v2-isolated-proof/java-full'
OUT=P/'audit-detail/details'
CLI=ROOT/'web/out/initial-terrain-v2-isolated-proof/plan_replay.exe'
EXPECTED='9f11cd2f66f27141f40e9755f628573202468d00c1c60bc9e63896cb43ed3791'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p,x):
    with p.open('x',encoding='utf8') as f:json.dump(x,f,ensure_ascii=False,indent=2);f.write('\n')
def array_parts(text,key):
    decoder=json.JSONDecoder();start=text.index('[',text.index(json.dumps(key)))
    at=start+1;parts=[]
    while True:
        while text[at].isspace() or text[at]==',':at+=1
        if text[at]==']':return start,at+1,parts
        value,end=decoder.raw_decode(text,at);parts.append((value,text[at:end]));at=end
assert sha(CLI)==EXPECTED
OUT.mkdir()
rp,bp=P/'after/005-request.json',P/'after/005-plans.json'
text=rp.read_text(encoding='utf8');start,end,parts=array_parts(text,'requests')
prefix=text[:start]+'['+','.join(fragment for _,fragment in parts[:5])+']'+text[end:]
input_path,output_path,detail_path=OUT/'005-prefix-request.json',OUT/'005-prefix-plans.json',OUT/'005-prefix-details.json'
input_path.write_bytes(prefix.encode('utf8'))
command=[str(CLI),str(input_path),str(output_path),'--details',str(detail_path)]
result=subprocess.run(command,cwd=ROOT,capture_output=True,timeout=120,check=False)
(OUT/'stdout.log').write_bytes(result.stdout);(OUT/'stderr.log').write_bytes(result.stderr)
assert result.returncode==0,result.stderr.decode('utf8')
assert sha(CLI)==EXPECTED
new=json.loads(output_path.read_bytes());old=json.loads(bp.read_bytes());ids={v['id'] for v,_ in parts[:5]}
comparisons={}
for key in ['buildings','refusals','open_spaces']:
    originals=[v for v in old[key] if v['id'] in ids]
    comparisons[key]=originals==new[key]
old_fragments={v['id']:fragment.encode('utf8') for v,fragment in array_parts(bp.read_text(encoding='utf8'),'buildings')[2]}
new_fragments={v['id']:fragment.encode('utf8') for v,fragment in array_parts(output_path.read_text(encoding='utf8'),'buildings')[2]}
byte_identical={rid:raw==old_fragments[rid] for rid,raw in new_fragments.items()}
report=dict(version='initial-terrain-v2-gain-detail-proof-1',command=command,cliSha256=EXPECTED,
    sourceRequestSha256=sha(rp),sourcePlansSha256=sha(bp),inputSha256=sha(input_path),outputSha256=sha(output_path),
    detailsSha256=sha(detail_path),scriptSha256=sha(Path(__file__)),prefixCount=5,selectedOriginalIndices=[320,324],
    context='Exact first5 raw request tokens of actual enriched batch005; earlier requests in that batch retained. Native inter-batch neighbors unchanged. Two accepted gains only.',
    outcomesEqualToFrozenBatch=comparisons,buildingFragmentsByteIdentical=byte_identical,
    details=json.loads(detail_path.read_bytes()),limits='Two exact gains, not all recovered interiors or population capacity. No timing claim.')
save(OUT/'manifest.json',report)
print(json.dumps(report,ensure_ascii=False),flush=True)
assert all(comparisons.values()) and all(byte_identical.values()),'Prefix did not reproduce retained plans; detail proof cannot be applied to archives.'
