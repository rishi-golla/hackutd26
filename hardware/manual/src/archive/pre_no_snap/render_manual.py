#!/usr/bin/env python3
"""CAD-derived instructional colour renders. Run with Blender -b -P thisfile -- <ids>.
Printed meshes are imported unchanged. New-part colouring and arrows are render-only.
"""
import bpy,math,sys,json
from pathlib import Path
from mathutils import Vector,Matrix
ROOT=Path(__file__).resolve().parent
HW=ROOT.parents[1];CAD=HW/'cad';OUT=HW/'manual/img';ASSETS=ROOT/'assets'
S=.001
# Phone readability: fractions refer to the final canvas width, independent of model size.
MOTION_ARROW_LENGTH_FRACTION=.155  # Minimum visible tail-to-tip length.
MOTION_ARROW_SHAFT_FRACTION=.026   # Full shaft width; 41.6 px on a 1600 px canvas.
MOTION_ARROW_HEAD_FRACTION=.080    # Full triangular head width.
FRAMING_MARGIN=1.22               # Subject plus arrows occupy about 82% of a limiting dimension.
CAMERA_LAYOUTS={}
LAYOUT_AUDIT={}
BG='f4f6f8';ACCENT='ff5a36'
COLORS={'marker':'151b20','blue':'285b91','yellow':'debb3a','wireblue':'366eb5','wirered':'bd3838','graphite':'5b6670','pcb':'277846','shim':'c83232','sensor':'c83232','metal':'c3c9ce','gold':'d4b35c','black':'252b30','white':'eee9d9','skin':'d6a57f','accent':ACCENT}
MATS={};OLD=NEW=ARROWS=TEXT=None;CAM=None;INVENTORY=False

def srgb(c):return c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4
def rgb(h):return tuple(int(h[i:i+2],16)/255 for i in (0,2,4))
def linear(h):return tuple(srgb(c) for c in rgb(h))
def material(key,new=False):
 tag=(key,new,INVENTORY)
 if tag in MATS:return MATS[tag]
 c=rgb(COLORS.get(key,key));bg=rgb(BG)
 if not INVENTORY and key not in ('accent','marker'):
  c=tuple(.6*a+.4*b for a,b in zip(c,rgb(ACCENT) if new else bg))
 col=tuple(srgb(v) for v in c)
 m=bpy.data.materials.new(str(tag));m.diffuse_color=(*col,1);m.use_nodes=True
 n=m.node_tree.nodes;n.clear();out=n.new('ShaderNodeOutputMaterial');emit=n.new('ShaderNodeEmission');emit.inputs['Color'].default_value=(*col,1)
 if key=='accent':emit.inputs['Strength'].default_value=1
 else:
  g=n.new('ShaderNodeNewGeometry');dot=n.new('ShaderNodeVectorMath');dot.operation='DOT_PRODUCT';dot.inputs[1].default_value=(-.35,-.45,.82)
  value=n.new('ShaderNodeMath');value.operation='MULTIPLY_ADD';value.inputs[1].default_value=.14;value.inputs[2].default_value=.86
  m.node_tree.links.new(g.outputs['Normal'],dot.inputs[0]);m.node_tree.links.new(dot.outputs['Value'],value.inputs[0]);m.node_tree.links.new(value.outputs[0],emit.inputs['Strength'])
 m.node_tree.links.new(emit.outputs[0],out.inputs['Surface']);MATS[tag]=m;return m

def reset(inventory=False):
 global OLD,NEW,ARROWS,TEXT,INVENTORY
 INVENTORY=inventory
 fs=bpy.context.view_layer.freestyle_settings
 for ls in list(fs.linesets):
  ls.collection=None
  fs.linesets.remove(ls)
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 cols=[]
 for name in ('Neutral','New','Motion','Text'):
  c=bpy.data.collections.get(name)
  if not c:c=bpy.data.collections.new(name);bpy.context.scene.collection.children.link(c)
  cols.append(c)
 OLD,NEW,ARROWS,TEXT=cols

def assign(obj,key,new=False,motion=False):
 for c in list(obj.users_collection):c.objects.unlink(obj)
 (ARROWS if motion else NEW if new else OLD).objects.link(obj)
 obj.data.materials.clear();obj.data.materials.append(material(key,new))
 for f in getattr(obj.data,'polygons',[]):f.material_index=0
 return obj

def mesh(name,key='graphite',new=False,offset=(0,0,0),source='detail'):
 folder=ASSETS if source=='cad' and name in ('p2_base','p2_lid') else {'detail':ASSETS,'cad':CAD/'render_assets','print':CAD/'stl'}[source]
 bpy.ops.wm.stl_import(filepath=str(folder/(name+'.stl')));o=bpy.context.object;o.name=name;o.scale=(S,S,S);o.location=Vector(offset)*S
 return assign(o,key,new)
def box(name,center,size,key='graphite',new=False):
 bpy.ops.mesh.primitive_cube_add(size=1,location=Vector(center)*S);o=bpy.context.object;o.name=name;o.dimensions=Vector(size)*S;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return assign(o,key,new)
def line(points,key='accent',r=.6,new=True):
 cv=bpy.data.curves.new('motion','CURVE');cv.dimensions='3D';cv.bevel_depth=r*S;cv.bevel_resolution=2
 sp=cv.splines.new('POLY');sp.points.add(len(points)-1)
 for p,v in zip(sp.points,points):p.co=(*[a*S for a in v],1)
 o=bpy.data.objects.new('guide',cv);bpy.context.collection.objects.link(o);return assign(o,key,new,motion=key=='accent')
def arrow(a,b,r=.85,head=3.2,kind='motion'):
 a=Vector(a);b=Vector(b);v=b-a;L=v.length;d=v.normalized();cam=bpy.context.scene.camera
 view=(cam.location/S-(a+b)/2).normalized() if cam else Vector((1,-1,1.6)).normalized()
 side=d.cross(view)
 if side.length<.05:side=d.cross(Vector((0,1,0)))
 side.normalize();normal=d.cross(side).normalized();h=min(head*2/max(.35,d.cross(view).length),L*.4)
 poly=[a-side*r,a+side*r,b-d*h+side*r,b-d*h+side*head,b,b-d*h-side*head,b-d*h-side*r]
 vs=[tuple((p+normal*z)*S) for z in (-.15,.15) for p in poly];n=len(poly);fs=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 me=bpy.data.meshes.new('arrow');me.from_pydata(vs,[],fs);me.update();o=bpy.data.objects.new('motion arrow',me);bpy.context.collection.objects.link(o);assign(o,'accent',True,True)
 o['arrow_tail']=tuple(a*S);o['arrow_tip']=tuple(b*S);o['arrow_kind']=kind
 return o
def dotted(a,b,dash=1.1):
 a=Vector(a);b=Vector(b);v=b-a;n=max(1,int(v.length/(dash*2)))
 for i in range(n):line([a+v*(i/n),a+v*((i+.45)/n)],r=.17)
def label(body,at,size=2):
 cv=bpy.data.curves.new('pin marker','FONT');cv.body=body;cv.size=size*S;cv.align_x='CENTER';cv.align_y='CENTER'
 o=bpy.data.objects.new('pin marker',cv);bpy.context.collection.objects.link(o);o.location=Vector(at)*S;o.rotation_euler=CAM.rotation_euler;assign(o,'marker',False);OLD.objects.unlink(o);TEXT.objects.link(o);return o

def camera(target,view,scale,zoom=False,size=None):
 global CAM
 sc=bpy.context.scene;bpy.ops.object.camera_add();CAM=bpy.context.object;CAM.location=Vector(target)*S+Vector(view).normalized()*.6
 CAM.rotation_euler=(Vector(target)*S-CAM.location).to_track_quat('-Z','Y').to_euler();CAM.data.type='ORTHO';CAM.data.ortho_scale=scale*S;sc.camera=CAM;CAM.data.clip_start=.001
 sc.render.resolution_x=1200 if zoom else 1600;sc.render.resolution_y=1200;sc.render.resolution_percentage=100
 if size:sc.render.resolution_x,sc.render.resolution_y=size

def styles():
 scene=bpy.context.scene;scene.render.use_freestyle=True;fs=bpy.context.view_layer.freestyle_settings;fs.crease_angle=math.radians(130);fs.use_culling=True
 for ls in list(fs.linesets):
  ls.collection=None
  fs.linesets.remove(ls)
 for name,col,color,thickness,contour,crease in [('neutral',OLD,'30373e',2.5,True,True),('new details',NEW,'30373e',1.8,False,True),('new accent',NEW,ACCENT,4.0,True,False)]:
  if not col.objects:continue
  ls=fs.linesets.new(name);ls.select_by_collection=True;ls.collection=col;ls.collection_negation='INCLUSIVE'
  ls.select_silhouette=contour;ls.select_contour=contour;ls.select_external_contour=False;ls.select_border=contour;ls.select_crease=crease;ls.select_material_boundary=False
  ls.linestyle.color=linear(color);ls.linestyle.alpha=1;ls.linestyle.thickness=thickness;ls.linestyle.caps='ROUND'

def render(name):
 sc=bpy.context.scene
 old_aspect=sc.render.resolution_x/sc.render.resolution_y
 target=(600,600) if name.startswith('icon_') else (1200,1200) if name.endswith('_zoom') else (1600,1200)
 new_aspect=target[0]/target[1]
 if new_aspect!=old_aspect:sc.camera.data.ortho_scale*=new_aspect/old_aspect
 sc.render.resolution_x,sc.render.resolution_y=target
 apply_phone_layout(name)
 sc.render.engine='CYCLES';sc.cycles.samples=8;sc.cycles.use_denoising=True
 sc.world.use_nodes=True;sc.world.node_tree.nodes['Background'].inputs['Color'].default_value=(*linear(BG),1);sc.world.node_tree.nodes['Background'].inputs['Strength'].default_value=1
 sc.view_settings.view_transform='Standard';sc.view_settings.look='None';sc.view_settings.exposure=0;sc.view_settings.gamma=1
 sc.render.image_settings.file_format='PNG';sc.render.image_settings.color_mode='RGB';sc.render.film_transparent=False
 styles();sc.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True);print('RENDERED',name,flush=True)

def pi(offset=(0,0,0),new=False,heatsinks=True):
 for n,k in [('pi_board','pcb'),('pi_ports','metal'),('pi_header_base','black'),('pi_pins','gold')]:mesh(n,k,new,offset)
 if heatsinks:mesh('pi_cpu_sink','black',new,offset)
def shim(offset=(0,0,0),new=False):
 for n,k in [('shim_pcb','shim'),('shim_pads','gold'),('shim_connector','black')]:mesh(n,k,new,offset)

def shim_scene(zoom=False):
 reset();camera((11,47,15) if zoom else (42,29,10),(-1,-1.25,1.8),40 if zoom else 132,zoom)
 pi();shim((0,0,15),True)
 arrow((0,44,30),(0,44,11),r=.45 if zoom else .7,head=1.5 if zoom else 2.2)
 for x in (8.77,11.31,13.85):
  for y in (49.98,52.52):dotted((x,y,10.2),(x,y,23.6),dash=.8)
 if zoom:
  label('1',(7.7,47.3,10.8),2.3);label('1',(7.7,47.3,25.4),2.3)
  for i in range(1,6):
   x=8.77+(i//2)*2.54;y=49.98+(i%2)*2.54
   label(str(i+1),(x,y+(.85 if i%2 else -1),25.1),1.0)
 else:label('1',(5,50,10.8),3)

SCENES={}
def register(name,fn,caption):
 if len(caption.split())>15:raise ValueError('Caption too long: '+name)
 SCENES[name]=(fn,caption)
exec((ROOT/'scenes_inventory.py').read_text(),globals())
if (ROOT/'scenes_steps.py').exists():exec((ROOT/'scenes_steps.py').read_text(),globals())
exec((ROOT/'scenes_network.py').read_text(),globals())
exec((ROOT/'scenes_backups.py').read_text(),globals())
exec((ROOT/'phone_layout.py').read_text(),globals())
if __name__=='__main__':
 ids=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
 ids=ids or list(SCENES)
 build_phone_layouts(ids)
 for name in ids:
  if name not in SCENES:raise ValueError('Unknown image: '+name)
  SCENES[name][0]();render(name)
 lines=['# Assembly image manifest','', 'Captions describe visible actions; words and check/cross marks belong in the HTML.', '', 'Only the processor heatsink is installed in these pictures. Breadboard row 1 is nearest the Pi; holes a–e face the header/FINGER wall, and f–j face the USB-C wall.', '', 'The current build has no OLED or short Qwiic cable. Two removable exterior finger-clip glue dots and two Pi mounting-hole glue caps supplement the clips. The 500 mm finger cable connects directly to the SHIM. The bank, straight USB-C cable and black straps are generic examples, supplied by the builder.', '', 'Printed shapes come from the final screw-free CAD. Reference components and flexible cable routes are simplified. The wrong J-clip view illustrates elastic deflection; it is not a strain simulation.', '', 'The parts sheet shows A, B, C, D, F, G, two J clips, T1, T2 and T3. Label anchors are in [parts_printed.json](parts_printed.json). Re-render AST images from hardware/ with `manual/src/render_all.sh`.', '', '| File | Caption |','|---|---|']
 for n,(_,caption) in SCENES.items():
  if (OUT/(n+'.png')).exists():lines.append(f'| [{n}.png]({n}.png) | {caption} |')
 other=OUT/'MANIFEST_TERRA.md'
 if other.exists():
  lines += ['', '## Terra images', '', 'Generated by Terra; see [its source manifest](MANIFEST_TERRA.md).', '', '| File | Caption |','|---|---|']
  for row in other.read_text().splitlines():
   cells=[x.strip() for x in row.split('|')]
   if len(cells)>=4 and cells[1].endswith('.png') and Path(cells[1]).stem not in SCENES:lines.append(f'| [{cells[1]}]({cells[1]}) | {cells[2]} |')
 audit_path=ROOT/'qa'/'framing_audit.json'
 prior=json.loads(audit_path.read_text()) if audit_path.exists() else {}
 prior.update(LAYOUT_AUDIT)
 audit_path.write_text(json.dumps(prior,indent=2)+'\n')
 (OUT/'MANIFEST.md').write_text('\n'.join(lines)+'\n')
