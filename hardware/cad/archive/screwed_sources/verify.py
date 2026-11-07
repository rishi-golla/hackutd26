#!/usr/bin/env python3
"""Re-export every printable STL and audit topology + assembly intersections.
Run from anywhere: cad/.venv/bin/python cad/verify.py
Requires trimesh and numpy; logs/JSON/witness SCAD live in cad/checks.
No empty STL is accepted as a printable part. An intersection passes when OpenSCAD reports empty, or every emitted contact
component is planar within 0.00001 mm and aggregate volume <0.00001 mm3.
Intentional mating surfaces may touch; penetration never passes.
"""
from pathlib import Path
import os, subprocess, json, concurrent.futures, sys
import numpy as np
import trimesh
ROOT=Path(__file__).resolve().parent
SCAD=os.environ.get('OPENSCAD','/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD')
OUT=ROOT/'stl'; CHECK=ROOT/'checks'
OUT.mkdir(exist_ok=True);CHECK.mkdir(exist_ok=True)
# This directory contains generated witnesses only. Discard stale failed runs.
for stale in CHECK.iterdir():
    if stale.suffix in ('.scad','.stl','.log') or stale.name=='report.json': stale.unlink()
PARTS=[]
for mode in ('rear','front'):
    for part in ('front_frame','back_plate','fit_ring'):
        PARTS.append((f'p1_{mode}_{part}','p1_bodycam.scad',{'camera_mode':mode,'part':part}))
PARTS += [('p1_mount_test','p1_bodycam.scad',{'part':'mount_test'})]
PARTS += [(f'p2_{p}','p2_relay.scad',{'part':p}) for p in ('base','lid','oled_retainer')]
PARTS += [(f'p3_{p}','p3_finger_clip.scad',{'part':p}) for p in ('tray','hood')]

def run_scad(source,out,defines=None):
    out.unlink(missing_ok=True)
    args=[SCAD,'--backend=manifold','--export-format','binstl','-o',str(out)]
    for k,v in (defines or {}).items(): args += ['-D',f'{k}={json.dumps(v)}']
    args += [str(source)]
    result=subprocess.run(args,capture_output=True,text=True)
    return result.returncode,result.stdout+result.stderr

def export(job):
    name,file,defs=job
    path=OUT/f'{name}.stl'
    code,log=run_scad(ROOT/file,path,defs)
    (CHECK/f'{name}.log').write_text(log)
    r={'name':name,'file':str(path.relative_to(ROOT)),'returncode':code}
    if code or not path.exists(): r.update(passed=False,error=log[-1500:]);return r
    m=trimesh.load_mesh(path,process=True)
    components=list(m.split(only_watertight=False,repair=False))
    r.update(watertight=bool(m.is_watertight),winding_consistent=bool(m.is_winding_consistent),
             positive_volume=bool(m.volume>0),components=len(components),
             dimensions_mm=np.round(m.extents,3).tolist(),bounds_mm=np.round(m.bounds,3).tolist(),
             volume_mm3=round(float(m.volume),2),triangles=len(m.faces))
    r['passed']=all((r['watertight'],r['winding_consistent'],r['positive_volume'],len(components)==1,abs(m.bounds[0,2])<0.03))
    return r

COLLISIONS=[]
def pair(name,file,a,b,defs=None,operation="intersection"): COLLISIONS.append((name,file,a,b,defs or {},operation))
for mode in ('rear','front'):
    pair(f'p1_{mode}_ring_phone','p1_bodycam.scad','p1_fit_ring_assembled();','p1_phone();',{'camera_mode':mode})
    pair(f'p1_{mode}_worn_buckle','p1_bodycam.scad','p1_worn_body();','p1_worn_buckle();',{'camera_mode':mode})
    for p in ('frame','back'):
        pair(f'p1_{mode}_{p}_phone','p1_bodycam.scad',f'p1_{p}_assembled();','p1_phone();',{'camera_mode':mode})
    pair(f'p1_{mode}_frame_back','p1_bodycam.scad','p1_frame_assembled();','p1_back_assembled();',{'camera_mode':mode})
for p in ('base','lid'):
    for c in ('pi','shim','oled','button','bread','usb_plug'):
        pair(f'p2_{p}_{c}','p2_relay.scad',f'p2_{p}();',f'p2_{c}();')
for a,b in [('base','lid'),('pi','oled'),('pi','button'),('bread','button'),('shim','oled')]:
    pair(f'p2_{a}_{b}','p2_relay.scad',f'p2_{a}();',f'p2_{b}();')
for c in ('pi_standoffs','pi_nuts','bottom_screws','retainer'):
    for p in ('base','lid','pi','oled','shim','button'):
        pair(f'p2_{c}_{p}','p2_relay.scad',f'p2_{c}();',f'p2_{p}();')
for a,b in [('base','bank'),('pi_standoffs','bank'),('pi_nuts','bank'),('bottom_screws','bank'),('bottom_screws','pi_standoffs'),('pi_nuts','pi_standoffs')]:
    pair(f'p2_{a}_{b}','p2_relay.scad',f'p2_{a}();',f'p2_{b}();')
for p in ('base','bank','pi','bread'):
    pair(f'p2_bank_straps_{p}','p2_relay.scad','p2_bank_straps();',f'p2_{p}();')
for c in ('base','pi_standoffs','pi_nuts','bottom_screws'):
    pair(f'p2_flat_bottom_{c}','p2_relay.scad',f'p2_{c}();','p2_underside_exclusion();')
for c in ('tray','hood','board'):
    pair(f'p3_strap_{c}','p3_finger_clip.scad','p3_strap();',f'p3_{c}();')
pair('p3_finger_cradle','p3_finger_clip.scad','p3_finger();','p3_hood();')
for p in ('tray','hood'):pair(f'p3_{p}_board','p3_finger_clip.scad',f'p3_{p}();','p3_board();')
pair('p3_tray_hood','p3_finger_clip.scad','p3_tray();','p3_hood();')

# Fastener load paths: missing bearing material is a failure, even with no collision.
for mode in ('rear','front'):
    pair(f'p1_{mode}_nut_bearing_web','p1_bodycam.scad','p1_nut_webs();','p1_frame_assembled();',{'camera_mode':mode},operation='difference')
    for p in ('frame','back','phone'):
        target=f'p1_{p}_assembled();' if p!='phone' else 'p1_phone();'
        pair(f'p1_{mode}_hardware_{p}','p1_bodycam.scad','p1_joint_hardware();',target,{'camera_mode':mode})
pair('p2_corner_nut_bearing_web','p2_relay.scad','p2_corner_nut_webs();','p2_base();',operation='difference')
pair('p2_retainer_nut_bearing_web','p2_relay.scad','p2_retainer_nut_webs();','p2_lid();',operation='difference')
for hardware in ('shell_hardware','retainer_hardware'):
    for p in ('base','lid','retainer','pi','oled','shim','button','bread'):
        pair(f'p2_{hardware}_{p}','p2_relay.scad',f'p2_{hardware}();',f'p2_{p}();')
pair('p3_nut_bearing_web','p3_finger_clip.scad','p3_nut_webs();','p3_tray();',operation='difference')
for p in ('tray','hood','board','strap','finger'):
    pair(f'p3_hardware_{p}','p3_finger_clip.scad','p3_joint_hardware();',f'p3_{p}();')

# Conservative positive clearances verified by Minkowski box expansion.
# Offset is 0.01 mm below reported nominal gap to avoid touching-face noise.
for name,a,b,gap in [
 ('pi_oled_3p8','p2_pi();','p2_oled();',3.79),
 ('pi_retainer_3p0','p2_pi();','p2_retainer();',2.99),
 ('pi_lid_ge3p0','p2_pi();','p2_lid();',2.99),
 ('button_pi_ge3p0','p2_button();','p2_pi();',2.99),
 ('button_bread_ge4p9','p2_button();','p2_bread();',4.89),
 ('shell_hardware_pi_ge3p0','p2_shell_hardware();','p2_pi();',2.99),
 ('retainer_hardware_pi_ge3p0','p2_retainer_hardware();','p2_pi();',2.99),
]:
 pair('clearance_'+name,'p2_relay.scad',f'minkowski(){{ {a} cube([{2*gap},{2*gap},{2*gap}],center=true); }}',b)

def collision(job):
    name,file,a,b,defs,operation=job
    source=CHECK/f'{name}.scad';out=CHECK/f'{name}.stl'
    source.write_text(f'use <../{file}>\n{operation}(){{\n{a}\n{b}\n}}\n')
    code,log=run_scad(source,out,defs)
    (CHECK/f'{name}.log').write_text(log)
    empty='Current top level object is empty.' in log
    r={'name':name,'operation':operation,'passed':empty and not out.exists() and 'ERROR:' not in log,'returncode':code,'empty':empty}
    if out.exists():
        m=trimesh.load_mesh(out)
        r['overlap_mm3']=round(float(m.volume),6)
        chunks=m.split(only_watertight=False,repair=False)
        planar=all(np.linalg.svd(c.vertices-c.vertices.mean(axis=0),compute_uv=False)[-1] < 1e-5*len(c.vertices)**0.5 for c in chunks)
        if abs(m.volume)<1e-5 and planar and 'Status:     NoError' in log:
            r['passed']=True;r['contact_only']=True
    if not r['passed']:r['log']=log[-1200:]
    return r

if __name__=='__main__':
    report={'parts':[],'intersections':[]}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for r in pool.map(export,PARTS):
            report['parts'].append(r);print(('PASS' if r['passed'] else 'FAIL'),r['name'],r.get('dimensions_mm',r.get('error','')),flush=True)
        for r in pool.map(collision,COLLISIONS):
            report['intersections'].append(r);print(('PASS' if r['passed'] else 'FAIL'),r['name'],r.get('overlap_mm3','empty' if r['empty'] else r.get('log','')),flush=True)
    report['passed']=all(r['passed'] for group in report.values() if isinstance(group,list) for r in group)
    (CHECK/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print('ALL CHECKS PASSED' if report['passed'] else 'FAILURES: see cad/checks/report.json',flush=True)
    sys.exit(0 if report['passed'] else 1)
