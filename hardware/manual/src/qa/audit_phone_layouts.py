import runpy,json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
g=runpy.run_path(str(root/'render_manual.py'),run_name='layout_audit');g=g['collect_layout'].__globals__
ids=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else list(g['SCENES'])
g['build_phone_layouts'](ids)
path=root/'qa'/'projected_extents.json'
rows=json.loads(path.read_text()) if path.exists() else {}
for n,(fn,_) in g['SCENES'].items():
 if n not in ids:continue
 if n=='parts_printed' or n.startswith('icon_'):continue
 fn();s=g['collect_layout'](n);l=g['CAMERA_LAYOUTS'][n]
 if l['focused']:continue
 w=l['width'];pts=[(p.x,p.y) for p in s['points']]
 for _,poly,_,_ in g['projected_arrows'](s,w):pts.extend((p.x,p.y) for p in poly)
 for a in s['arcs']:pts.extend((p.x,p.y) for p in g['arc_points'](s,a,w))
 ext=max((max(p[0] for p in pts)-min(p[0] for p in pts))/w,(max(p[1] for p in pts)-min(p[1] for p in pts))/(w/s['aspect']))
 rows[n]={'extent':round(ext,3),'family':l['family']}
print('LOW MAIN EXTENTS',json.dumps({n:v for n,v in rows.items() if v['extent']<.72}),flush=True)
(root/'qa'/'projected_extents.json').write_text(json.dumps(rows,indent=2))
