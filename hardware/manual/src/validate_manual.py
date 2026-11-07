#!/usr/bin/env python3
"""Check required images, canvas sizes, captions and parts-sheet anchors."""
from pathlib import Path
from PIL import Image
import json,re,sys,hashlib
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'img'
needed=set((ROOT/'NEEDED_IMAGES.txt').read_text().split())
front_aliases={
'b2_t2_test_front':'b2_t2_test','b6_01_shell_front':'b6_01_shell','b6_04_phone_front':'b6_04_phone',
'b6_05_align_front':'b6_05_align','b6_05_align_front_zoom':'b6_05_align_zoom',
'b6_05_plate_front':'b6_05_plate','b6_05_plate_front_zoom':'b6_05_plate_zoom',
'b6_05_plate_front_ok':'b6_05_plate_ok','b6_05_plate_front_no':'b6_05_plate_no',
'b6_06_buckle_front':'b6_06_buckle','b6_06_buckle_front_zoom':'b6_06_buckle_zoom',
'b6_05_strap_front':'b6_05_strap','b6_05_strap_front_zoom':'b6_05_strap_zoom',
'b6_05_strap_second_front':'b6_05_strap_second','b6_05_strap_second_front_zoom':'b6_05_strap_second_zoom'}
needed.update(front_aliases)
actual={p.stem for p in OUT.glob('*.png')};missing=sorted(needed-actual)
errors=[]
if missing:errors.append('Missing: '+', '.join(missing))
terra=set()
for line in (OUT/'MANIFEST_TERRA.md').read_text().splitlines():
 cells=line.split('|')
 if len(cells)>2 and cells[1].strip().endswith('.png'):terra.add(Path(cells[1].strip()).stem)
for n in sorted((needed|{p.stem for p in OUT.glob('*release*.png')} )&actual):
 # Terra owns and validates its own provided canvas/export settings.
 if n in terra:continue
 size=(600,600) if n.startswith('icon_') else (1200,1200) if n.endswith('_zoom') else (1600,1200)
 with Image.open(OUT/(n+'.png')) as im:
  if im.size!=size:errors.append(f'{n}: {im.size}, expected {size}')
for n in sorted(needed):
 if n.endswith('_ok') and n[:-3]+'_no' in needed:
  other=n[:-3]+'_no'
  if n in actual and other in actual and hashlib.sha256((OUT/(n+'.png')).read_bytes()).digest()==hashlib.sha256((OUT/(other+'.png')).read_bytes()).digest():errors.append('Identical comparison pair: '+n)
manifest=(OUT/'MANIFEST.md').read_text()
for n in needed:
 if n+'.png' not in manifest:errors.append('Not in manifest: '+n)
for line in manifest.splitlines():
 cells=line.split('|')
 if len(cells)>=4 and '.png' in cells[1] and len(cells[2].strip().split())>15:errors.append('Long caption: '+cells[1])
anchors=json.loads((OUT/'parts_printed.json').read_text())
if set(anchors['anchors'])!=set('ABCDFG')|{'T1','T2'}:errors.append('Wrong parts-sheet letters')
for key,p in anchors['anchors'].items():
 if not(0<p['x']<1600 and 0<p['y']<1200):errors.append('Anchor out of canvas: '+key)
for old in ('b5_06_pi_rivet','b5_06_pi_rivet_zoom','icon_E','icon_h1','icon_h2','icon_h3','icon_O','icon_Q1','b5_12_finger','icon_J','icon_T3','b2_bed_coupon','coupon_test','coupon_test_zoom','b5_06_pi_click','b5_22_click'):
 if old in actual:errors.append('Obsolete icon remains: '+old)
audit_file=ROOT/'src/qa/framing_audit.json'
if audit_file.exists():
 audit=json.loads(audit_file.read_text())
 for n,record in audit.items():
  for a in record['arrows']:
   if a['kind']=='motion' and (a['length_fraction']<.15 or a['shaft_fraction']<.025):errors.append('Undersized motion arrow: '+n)
 for f,r in front_aliases.items():
  if f in audit and r in audit:
   if abs(audit[f]['width_mm']-audit[r]['width_mm'])>.001 or max(abs(a-b) for a,b in zip(audit[f]['center'],audit[r]['center']))>1e-6:errors.append('Front/rear camera mismatch: '+f)
else:errors.append('Missing framing audit')
print('\n'.join(errors) if errors else f'PASS: all {len(needed)} required images, sizes, captions and label anchors.')
sys.exit(bool(errors))
