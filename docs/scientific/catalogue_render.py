"""SVG reading diagrams driven by native recipe parameters (not a renderer capture)."""
import math,html
E=lambda s:html.escape(str(s))
def building(recipe):
 p=recipe['parameters']; w=sum(p['width_m'])/2; d=sum(p['depth_m'])/2
 floors=round(sum(p['floors'])/2); height=floors*p.get('level_height_m',2.8)
 roof=p['roof_system']; layout=p['layout']; roundish=p.get('footprint_family') in ['FP-ROUND','FP-OVAL']
 scale=min(150/(w+d),115/max(height,2)); base=240
 support=p.get('support') or {}; st=sum(support.get('height_m',[0,0]))/2
 def point(x,y,z=0):return (490+(x-y)*scale,base-(x+y)*scale*.42-z*scale)
 def points(vs):return ' '.join(f'{x:.1f},{y:.1f}' for x,y in vs)
 z=[]
 material=p.get('materials',{}).get('frame','');color='#c7a77a'
 if 'STONE' in material:color='#aaa99b'
 elif 'WOOD' in material or 'TIMBER' in material:color='#b28c60'
 elif 'BRICK' in material:color='#be8566'
 elif 'ADOBE' in material or 'COB' in material:color='#c6ab7c'
 def poly(corners,color):z.append(f'<polygon points="{points([point(*v) for v in corners])}" fill="{color}" stroke="#655f50" stroke-width="1.1"/>')
 def line(a,b,color='#776c59',sw=1):
  x,y=point(*a);u,v=point(*b);z.append(f'<path d="M{x:.1f} {y:.1f}L{u:.1f} {v:.1f}" stroke="{color}" stroke-width="{sw}" fill="none"/>')
 if st:
  for x in [0,w*.5,w]:
   for y in [0,d]:line((x,y,0),(x,y,st),'#776347',3)
 bottom=st; top=height+st
 def block(x,y,bw,bd,h):
  poly([(x,y,bottom),(x+bw,y,bottom),(x+bw,y,h),(x,y,h)],color)
  poly([(x,y,bottom),(x,y+bd,bottom),(x,y+bd,h),(x,y,h)],'#aa9173')
  poly([(x,y,h),(x+bw,y,h),(x+bw,y+bd,h),(x,y+bd,h)],'#d8c19a')
 court=layout in ['courtyard','peristyle','atrium','siheyuan','iwan_court','kancha','multiyard','kraal']
 if court:
  t=min(w,d)*.22
  for x,y,bw,bd in [(0,0,w,t),(0,d-t,w,t),(0,t,t,d-2*t),(w-t,t,t,d-2*t)]:block(x,y,bw,bd,top)
  # Open court and its circulation remain visible in the drawing.
  poly([(t,t,bottom),(w-t,t,bottom),(w-t,d-t,bottom),(t,d-t,bottom)],'#e9e5ce')
 elif roundish:
  low=[point(w/2+w/2*math.cos(a*math.pi/16),d/2+d/2*math.sin(a*math.pi/16),bottom) for a in range(32)]
  high=[point(w/2+w/2*math.cos(a*math.pi/16),d/2+d/2*math.sin(a*math.pi/16),top) for a in range(32)]
  z.append(f'<polygon points="{points(low+list(reversed(high)))}" fill="{color}" stroke="#655f50"/>')
 else:block(0,0,w,d,top)
 pitch=sum(p.get('roof_pitch_deg',[25,25]))/2
 rise=max(.6,min(w,d)*math.tan(math.radians(min(pitch,60)))/2)
 if not court:
  if roof in ['RF-FLAT','uncovered']:
   if p.get('roof_spec',{}).get('parapet_height_m',0):
    for a,b in [((0,0,top+.3),(w,0,top+.3)),((w,0,top+.3),(w,d,top+.3))]:line(a,b,'#e1d1af',3)
  elif roof in ['RF-CONE','RF-TENT','RF-DOME','RF-DOME-CONE','RF-SNOW']:
   for k in range(20):
    a=k*math.pi/10;b=(k+1)*math.pi/10
    poly([(w/2+w*.55*math.cos(a),d/2+d*.55*math.sin(a),top),(w/2+w*.55*math.cos(b),d/2+d*.55*math.sin(b),top),(w/2,d/2,top+max(rise,w*.6))], '#9c9470' if k%2 else '#b4a87b')
  elif roof in ['RF-HIP','RF-REED-HIP','RF-EAVES']:
   for vs in [[(0,0,top),(w,0,top),(w*.7,d*.5,top+rise),(w*.3,d*.5,top+rise)],[(w,0,top),(w,d,top),(w*.7,d*.5,top+rise)],[(0,d,top),(w,d,top),(w*.7,d*.5,top+rise),(w*.3,d*.5,top+rise)]]:poly(vs,'#99805b')
  elif roof in ['RF-TIERED','RF-MULTIPAV']:
   for tier in range(3):
    inset=tier*.13;h=top+tier*rise*.6
    poly([(w*inset,d*inset,h),(w*(1-inset),d*inset,h),(w*.5,d*.5,h+rise)],'#77917a')
    poly([(w*(1-inset),d*inset,h),(w*(1-inset),d*(1-inset),h),(w*.5,d*.5,h+rise)],'#53755e')
  else:
   poly([(0,0,top),(w,0,top),(w,d*.5,top+rise),(0,d*.5,top+rise)],'#af7d52')
   poly([(0,d,top),(w,d,top),(w,d*.5,top+rise),(0,d*.5,top+rise)],'#8d6146')
   if roof=='RF-STEEP-STEP':
    steps=6
    for k in range(steps):
     y=d/2*k/steps;h=top+rise*k/steps
     line((w,y,h),(w,y+d/2/steps,h),'#d2bb9b',4)
     line((w,d-y,h),(w,d-y-d/2/steps,h),'#d2bb9b',4)
 for level in range(floors):
  h=bottom+(level+.5)*p.get('level_height_m',2.8)
  for x in [w*.25,w*.55,w*.8]:
   u,v=point(x,0,h);z.append(f'<rect x="{u-2:.1f}" y="{v-3:.1f}" width="4" height="6" fill="#5d6556"/>')
  if level:line((0,0,bottom+level*p.get('level_height_m',2.8)),(w,0,bottom+level*p.get('level_height_m',2.8)))
 if 'post' in p.get('structure_system',''):
  for x in [0,w/3,2*w/3,w]:line((x,0,bottom),(x,0,top),'#675441',2)
 z.append(f'<text x="350" y="278" font-family="system-ui" font-size="11" fill="#304c41">{E(recipe["id"])} · {floors} niveaux · {w:g} × {d:g} m</text>')
 return ''.join(z)
