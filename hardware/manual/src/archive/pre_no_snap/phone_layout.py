"""Screen-space motion glyphs and shared orthographic framing for phone reading.
Executed inside render_manual.py. Printed/reference meshes are never altered.
"""
from mathutils import Vector

# Consecutive states use one measured camera envelope. A fully separated rail-start
# shot is deliberately its own wide shot; rail motion/closed loading views stay tight.
CAMERA_FAMILIES=[
 ['b6_01_shell','b6_04_phone','b6_05_plate'],
 ['b6_06_buckle','b6_06_thumb'],
 ['b4_04_clip_front','b4_04_clip_rear'],
 ['b4_06_strap','b4_06_finger','b4_06_strap_ok','b4_06_strap_no'],
 ['b5_04_strap_one','b5_04_straps','b5_06_pi','b5_06_pi_click'],
 ['b5_07_peel','b5_07_breadboard'],
 ['b5_08_cable_in','b5_12_finger_shim','b5_12_finger_slack'],
 ['b5_22_close','b5_22_click','b5_release_lid'],
 ['b5_23_bank','b5_23_strap_one','b5_23_straps'],
 ['b2_t1_test_ok','b2_t1_test_no'],
 ['b6_release','b6_slide_open'],
 ['b5_23_usb_c','b5_06_usb_dryfit','b5_06_usb_dryfit_ok','b5_06_usb_dryfit_no'],
]
FOCUSED_MAIN={'b4_05_tape_ok','b4_05_tape_no','b4_07_thread','b4_07_ziptie','b6_07_tighten','b5_23_usb_a','b5_23_usb_c','b5_06_usb_dryfit','b5_06_usb_dryfit_ok','b5_06_usb_dryfit_no'}

def canvas_for(name):
 return (600,600) if name.startswith('icon_') else (1200,1200) if name.endswith('_zoom') else (1600,1200)

def group_for(name):
 name=FRONT_ALIASES.get(name,name)
 for i,items in enumerate(CAMERA_FAMILIES):
  if name in items:return 'sequence_'+str(i)
 if name.endswith(('_ok','_no')):return name.rsplit('_',1)[0]+'_comparison'
 return name

def collect_layout(name):
 bpy.context.view_layer.update();sc=bpy.context.scene;cam=sc.camera;inv=cam.rotation_euler.to_matrix().transposed()
 size=canvas_for(name);aspect=size[0]/size[1]
 focused=name.endswith('_zoom') or name in FOCUSED_MAIN or (sc.render.resolution_x==1200 and not name.startswith('icon_'))
 points=[];arrows=[];arcs={}
 for o in sc.objects:
  if o.type not in ('MESH','CURVE','FONT') or o.name=='chest plane':continue
  if 'arrow_tail' in o:
   arrows.append({'obj':o.name,'a':inv@(o.matrix_world@Vector(o['arrow_tail'])),'b':inv@(o.matrix_world@Vector(o['arrow_tip'])),'kind':o['arrow_kind'],'arc':o.get('arc_object')})
  elif o.get('motion_arc'):
   arcs[o.name]=[inv@(o.matrix_world@Vector(p.co[:3])) for p in o.data.splines[0].points]
  else:points.extend(inv@(o.matrix_world@Vector(v)) for v in o.bound_box)
 pos=inv@cam.location
 original_width=cam.data.ortho_scale*aspect/(sc.render.resolution_x/sc.render.resolution_y)
 return {'name':name,'points':points,'arrows':arrows,'arcs':arcs,'aspect':aspect,'focused':focused,'center':Vector((pos.x,pos.y)),'width':original_width,'rotation':tuple(round(x,5) for x in cam.rotation_euler)}

def arc_points(spec,key,width):
 pts=spec['arcs'][key];center=sum((Vector((p.x,p.y)) for p in pts),Vector((0,0)))/len(pts)
 extent=max(max(p.x for p in pts)-min(p.x for p in pts),max(p.y for p in pts)-min(p.y for p in pts))
 factor=max(1,width*MOTION_ARROW_LENGTH_FRACTION/max(extent,1e-9))
 return [center+(Vector((p.x,p.y))-center)*factor for p in pts]

def arrow_polygon(a,b,width,kind):
 a=Vector((a[0],a[1]));b=Vector((b[0],b[1]));v=b-a
 if v.length<1e-8:v=Vector((0,-1))
 d=v.normalized();side=Vector((-d.y,d.x))
 length=max(v.length,width*MOTION_ARROW_LENGTH_FRACTION) if kind=='motion' else max(v.length,width*.065) if kind=='turn_head' else v.length
 a=b-d*length
 shaft=width*MOTION_ARROW_SHAFT_FRACTION/2 if kind!='dimension' else width*.004
 head=width*MOTION_ARROW_HEAD_FRACTION/2 if kind!='dimension' else min(width*.017,length*.28)
 hl=min(length*.4,width*.065)
 return [a-side*shaft,a+side*shaft,b-d*hl+side*shaft,b-d*hl+side*head,b,b-d*hl-side*head,b-d*hl-side*shaft],length,2*shaft

def projected_arrows(spec,width):
 out=[]
 for a in spec['arrows']:
  start,end=a['a'],a['b']
  if a['arc'] in spec['arcs']:
   pts=arc_points(spec,a['arc'],width);start,end=pts[-3],pts[-1]
  poly,length,shaft=arrow_polygon(start,end,width,a['kind']);out.append((a,poly,length,shaft))
 return out

def calculate_layout(specs):
 first=specs[0];aspect=first['aspect']
 if first['focused']:return {'center':first['center'],'width':first['width'],'focused':True}
 pts=[Vector((p.x,p.y)) for s in specs for p in s['points']]
 if not pts:return {'center':first['center'],'width':first['width'],'focused':True}
 def fitted(ps):
  low=Vector((min(p.x for p in ps),min(p.y for p in ps)));high=Vector((max(p.x for p in ps),max(p.y for p in ps)))
  return (low+high)/2,max(high.x-low.x,(high.y-low.y)*aspect)*FRAMING_MARGIN
 center,width=fitted(pts)
 for _ in range(24):
  expanded=list(pts)
  for s in specs:
   for _,poly,_,_ in projected_arrows(s,width):expanded.extend(poly)
   for key in s['arcs']:
    for p in arc_points(s,key,width):expanded.extend([p+Vector((width*.014,width*.014)),p-Vector((width*.014,width*.014))])
  center,next_width=fitted(expanded)
  if abs(next_width-width)<1e-8:width=next_width;break
  width=next_width
 return {'center':center,'width':width,'focused':False}

def build_phone_layouts(ids):
 CAMERA_LAYOUTS.clear();groups={};specs={}
 # Build all members of any selected family, so selective exports keep the same camera.
 selected=set(ids)
 selected.update(FRONT_ALIASES[n] for n in ids if n in FRONT_ALIASES)
 for family in CAMERA_FAMILIES:
  if selected.intersection(family):selected.update(family)
 selected.update(n for n,rear in FRONT_ALIASES.items() if rear in selected)
 for name in SCENES:
  if name not in selected or name=='parts_printed':continue
  SCENES[name][0]();spec=collect_layout(name);specs[name]=spec
  key=(group_for(name),spec['rotation'],spec['aspect'],spec['focused'])
  groups.setdefault(key,[]).append(spec)
 for key,items in groups.items():
  layout=calculate_layout(items)
  for item in items:CAMERA_LAYOUTS[item['name']]={**layout,'family':key[0]}
 print('PHONE LAYOUTS',len(CAMERA_LAYOUTS),flush=True)

def apply_phone_layout(name):
 if name=='parts_printed':return
 spec=collect_layout(name);layout=CAMERA_LAYOUTS.get(name) or {**calculate_layout([spec]),'family':group_for(name)}
 cam=bpy.context.scene.camera;rot=cam.rotation_euler.to_matrix();inv=rot.transposed();p=inv@cam.location
 center,width=layout['center'],layout['width'];cam.location+=rot@Vector((center.x-p.x,center.y-p.y,0));cam.data.ortho_scale=width
 aspect=spec['aspect'];screen_y=width/aspect
 def overlay(v):return cam.location+rot@Vector((v.x-center.x,v.y-center.y,-.02))
 audit=[]
 for a,poly,length,shaft in projected_arrows(spec,width):
  obj=bpy.data.objects.get(a['obj'])
  tip=poly[4]
  if layout['focused'] and (abs(tip.x-center.x)>width*.55 or abs(tip.y-center.y)>screen_y*.55):
   if obj:bpy.data.objects.remove(obj,do_unlink=True)
   continue
  # Detail crops retain their target; keep the entire glyph inside the visible canvas.
  if layout['focused']:
   minx,maxx=min(v.x for v in poly),max(v.x for v in poly);miny,maxy=min(v.y for v in poly),max(v.y for v in poly)
   dx=max(0,center.x-width*.46-minx)-max(0,maxx-center.x-width*.46)
   dy=max(0,center.y-screen_y*.46-miny)-max(0,maxy-center.y-screen_y*.46)
   poly=[v+Vector((dx,dy)) for v in poly]
  me=bpy.data.meshes.new('phone-readable arrow');me.from_pydata([overlay(v) for v in poly],[],[tuple(range(len(poly)))]);me.update();obj.data=me;obj.matrix_world=Matrix.Identity(4);assign(obj,'accent',True,True)
  audit.append({'kind':a['kind'],'length_fraction':round(length/width,4),'shaft_fraction':round(shaft/width,4)})
 for key in spec['arcs']:
  o=bpy.data.objects.get(key);pts=arc_points(spec,key,width);sp=o.data.splines[0]
  for p,v in zip(sp.points,pts):p.co=(*overlay(v),1)
  o.matrix_world=Matrix.Identity(4);o.data.bevel_depth=width*MOTION_ARROW_SHAFT_FRACTION/2
 LAYOUT_AUDIT[name]={'family':layout['family'],'focused_crop':layout['focused'],'width_mm':round(width/S,3),'center':list(center),'arrows':audit}
