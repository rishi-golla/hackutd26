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
PARTS += [(f'p2_{p}','p2_relay.scad',{'part':p,'with_oled':False}) for p in ('base','lid')]
PARTS += [(f'p3_{p}','p3_finger_clip.scad',{'part':p}) for p in ('tray','hood','joint_clips')]
PARTS += [('snap_coupon','snap_coupon.scad',{})]

def run_scad(source,out,defines=None):
    out.unlink(missing_ok=True)
    args=[SCAD,'--backend=manifold','--export-format','binstl','-D','$fn=64','-o',str(out)]
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
    r['passed']=all((r['watertight'],r['winding_consistent'],r['positive_volume'],len(components)==(8 if name=='snap_coupon' else 2 if name=='p3_joint_clips' else 1),abs(m.bounds[0,2])<0.03))
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
    for c in ('pi','shim','button','bread','usb_plug','finger_route'):
        pair(f'p2_{p}_{c}','p2_relay.scad',f'p2_{p}();',f'p2_{c}();')
for a,b in [('base','lid'),('pi','button'),('bread','button')]:
    pair(f'p2_{a}_{b}','p2_relay.scad',f'p2_{a}();',f'p2_{b}();')
pair('p2_base_bank','p2_relay.scad','p2_base();','p2_bank();')
for p in ('base','bank','pi','bread'):
    pair(f'p2_bank_straps_{p}','p2_relay.scad','p2_bank_straps();',f'p2_{p}();')
for c in ('base',):
    pair(f'p2_flat_bottom_{c}','p2_relay.scad',f'p2_{c}();','p2_underside_exclusion();')
for c in ('tray','hood','board'):
    pair(f'p3_strap_{c}','p3_finger_clip.scad','p3_strap();',f'p3_{c}();')
pair('p3_finger_cradle','p3_finger_clip.scad','p3_finger();','p3_hood();')
for p in ('tray','hood'):pair(f'p3_{p}_board','p3_finger_clip.scad',f'p3_{p}();','p3_board();')
pair('p3_tray_hood','p3_finger_clip.scad','p3_tray();','p3_hood();')

# The former M2.5 checks are retired with the removed hardware, not treated as empty passes.
# New clips must clear every component and each other in the seated state.
for p in ('tray','hood','board','strap','finger'):
    pair(f'p3_clips_{p}','p3_finger_clip.scad','p3_clips();',f'p3_{p}();')
for p in ('pi','shim','bread','usb_plug'):
    pair(f'p2_pi_clips_{p}','p2_relay.scad','p2_pi_clips();',f'p2_{p}();')
for mode in ('rear','front'):
    pair(f'p1_{mode}_latch_shoulders','p1_bodycam.scad','p1_latch_shoulders();','p1_frame_assembled();',{'camera_mode':mode},operation='difference')
    for dz in (-15,-5):
        pair(f'p1_{mode}_phone_insertion_{abs(dz)}','p1_bodycam.scad','p1_frame_assembled();',f'translate([0,0,{dz}])p1_phone();',{'camera_mode':mode})
# Pull-direction witnesses MUST intersect: positive retention after designed running play.
for mode in ('rear','front'):
    pair(f'engagement_p1_{mode}_withdrawal','p1_bodycam.scad','p1_frame_assembled();','translate([1,0,0])p1_back_assembled();',{'camera_mode':mode},operation='engagement')
    pair(f'engagement_p1_{mode}_normal_load','p1_bodycam.scad','p1_frame_assembled();','translate([0,0,-1])p1_back_assembled();',{'camera_mode':mode},operation='engagement')
pair('engagement_p2_lid','p2_relay.scad','p2_base();','translate([0,0,1])p2_lid();',operation='engagement')
pair('engagement_pi_hold_down','p2_relay.scad','p2_base();','translate([0,0,1.35])p2_pi();',operation='engagement')
pair('engagement_p3_clips_withdrawal','p3_finger_clip.scad','union(){p3_tray();p3_hood();}','translate([-1,0,0])p3_clips();',operation='engagement')
pair('engagement_p3_clamp','p3_finger_clip.scad','p3_clips();','translate([0,0,0.5])p3_hood();',operation='engagement')

# Conservative positive clearances verified by Minkowski box expansion.
# Offset is 0.01 mm below reported nominal gap to avoid touching-face noise.
for name,a,b,gap in [
 ('pi_lid_ge3p0','p2_pi();','p2_lid();',2.99),
 ('button_pi_ge3p0','p2_button();','p2_pi();',2.99),
 ('button_bread_ge4p9','p2_button();','p2_bread();',4.89),
]:
 pair('clearance_'+name,'p2_relay.scad',f'minkowski(){{ {a} cube([{2*gap},{2*gap},{2*gap}],center=true); }}',b)

# Optional legacy display is checked explicitly with with_oled=true, never as an empty pass.
for a,b in [('base','oled'),('lid','oled'),('pi','oled'),('shim','oled')]:
 pair(f'optional_oled_{a}_{b}','p2_relay.scad',f'p2_{a}();',f'p2_{b}();',{'with_oled':True})
pair('optional_oled_pi_lid_3mm','p2_relay.scad','minkowski(){p2_pi();cube([5.98,5.98,5.98],center=true);}','p2_lid();',{'with_oled':True})
pair('optional_oled_pi_3p8','p2_relay.scad','minkowski(){p2_pi();cube([7.58,7.58,7.58],center=true);}','p2_oled();',{'with_oled':True})
pair('screen_free_full_skin','p2_relay.scad','p2_closed_window();','p2_lid();',operation='difference')
pair('screen_free_no_pads_guides','p2_relay.scad','p2_lid();','translate([23,12,20])cube([42,43,16.99]);')
for c in ('pi','shim','bread','button','pi_clips','lid_beams'):
 pair(f'finger_route_{c}','p2_relay.scad','p2_finger_route();',f'p2_{c}();')
# Cable stays at least 3 mm below lid features with slack kept to the shown route.
pair('finger_route_lid_3mm','p2_relay.scad','p2_finger_route_clearance();','p2_lid();')
for c in ('base','pi','lid'):
 pair(f'straight_usb_max_{c}','p2_relay.scad','p2_usb_plug([17,24,12]);',f'p2_{c}();')
for clearance in (0.2,0.4):
    for mode in ('rear','front'):
        pair(f'tolerance_{clearance}_p1_{mode}','p1_bodycam.scad','p1_frame_assembled();','p1_back_assembled();',{'camera_mode':mode,'snap_clearance':clearance})
    pair(f'tolerance_{clearance}_p2','p2_relay.scad','p2_base();','p2_lid();',{'snap_clearance':clearance})
    pair(f'tolerance_{clearance}_p3','p3_finger_clip.scad','p3_clips();','union(){p3_tray();p3_hood();}',{'snap_clearance':clearance})

def collision(job):
    name,file,a,b,defs,operation=job
    source=CHECK/f'{name}.scad';out=CHECK/f'{name}.stl'
    source.write_text(f'use <../{file}>\n{'intersection' if operation=='engagement' else operation}(){{\n{a}\n{b}\n}}\n')
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
    if operation=='engagement': r['passed']=out.exists() and r.get('overlap_mm3',0)>0.001 and 'ERROR:' not in log
    if not r['passed']:r['log']=log[-1200:]
    return r

def joint_metrics():
    rows=[]
    for prefix,file in [('p1','p1_bodycam.scad'),('p2','p2_relay.scad'),('p3','p3_finger_clip.scad')]:
        source=CHECK/f'{prefix}_strain.scad';out=CHECK/f'{prefix}_strain.echo'
        source.write_text(f'use <../{file}>\necho({prefix}_snap_metrics());\n')
        run=subprocess.run([SCAD,'-o',str(out),str(source)],capture_output=True,text=True)
        for line in out.read_text().splitlines():
            if line.startswith('ECHO: '):
                for name,t,delta,length,engagement in json.loads(line[6:]):
                    strain=1.5*t*delta/length**2
                    rows.append(dict(name=name,thickness_mm=t,deflection_mm=delta,length_mm=length,engagement_mm=engagement,nominal_strain_pct=round(100*strain,3),limit_pct=1.5,passed=strain<0.015 and engagement>0.4))
    assert len(rows)==4,'Missing joint metrics'
    return rows

def fit_metrics():
    src=CHECK/'p2_fit_metrics.scad';out=CHECK/'p2_fit_metrics.echo'
    src.write_text('use <../p2_relay.scad>\necho(p2_fit_metrics());\n')
    subprocess.run([SCAD,'-o',str(out),str(src)],capture_output=True,text=True,check=True)
    rows=json.loads(out.read_text().split('ECHO: ')[1])
    return [dict(name=n,value_mm=v,minimum_mm=lo,passed=v>=lo) for n,v,lo in rows]

def legacy_lid_regression():
    from scipy.spatial import cKDTree
    target=CHECK/'legacy_oled_lid.stl'
    code,log=run_scad(ROOT/'p2_relay.scad',target,{'part':'lid','with_oled':True})
    (CHECK/'legacy_oled_lid.log').write_text(log)
    a=trimesh.load_mesh(ROOT/'archive/oled_revision/p2_lid_oled.stl')
    b=trimesh.load_mesh(target)
    delta=max(float(cKDTree(a.vertices).query(b.vertices)[0].max()),float(cKDTree(b.vertices).query(a.vertices)[0].max()))
    return {'name':'with_oled_true_matches_previous_lid','vertex_delta_mm':delta,'volume_delta_mm3':abs(float(a.volume-b.volume)),
            'passed':code==0 and delta<1e-6 and abs(a.volume-b.volume)<1e-6 and len(a.faces)==len(b.faces)}

if __name__=='__main__':
    report={'parts':[],'intersections':[],'joint_metrics':joint_metrics(),'regressions':[legacy_lid_regression()],'fit_metrics':fit_metrics()}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for r in pool.map(export,PARTS):
            report['parts'].append(r);print(('PASS' if r['passed'] else 'FAIL'),r['name'],r.get('dimensions_mm',r.get('error','')),flush=True)
        for r in pool.map(collision,COLLISIONS):
            report['intersections'].append(r);print(('PASS' if r['passed'] else 'FAIL'),r['name'],r.get('overlap_mm3','empty' if r['empty'] else r.get('log','')),flush=True)
    report['passed']=all(r['passed'] for group in report.values() if isinstance(group,list) for r in group)
    (CHECK/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print('ALL CHECKS PASSED' if report['passed'] else 'FAILURES: see cad/checks/report.json',flush=True)
    sys.exit(0 if report['passed'] else 1)
