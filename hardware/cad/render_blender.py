"""Blender 5.x: /Applications/Blender.app/Contents/MacOS/Blender -b -P cad/render_blender.py
Uses CAD-generated STL layers; does not change deliverable geometry.
"""
import bpy,math,json,sys
from pathlib import Path
from mathutils import Vector,Matrix
ROOT=Path(__file__).resolve().parent
OUT=ROOT.parent/'renders';OUT.mkdir(exist_ok=True)
ASSETS=ROOT/'render_assets'
S=.001
PALETTE={'graphite':(.012,.019,.027,1),'red':(.55,.004,.008,1),'green':(.035,.29,.105,1),'black':(.003,.005,.008,1),'silver':(.43,.48,.52,1),'glass':(.001,.005,.009,1),'cream':(.75,.74,.68,1),'blue':(.03,.14,.22,1),'skin':(.42,.26,.16,1),'chest':(.10,.13,.16,1)}
MATS={}
def material(key):
 if key not in MATS:
  mat=bpy.data.materials.new(key);mat.diffuse_color=PALETTE[key];mat.use_nodes=True
  bs=mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=PALETTE[key];bs.inputs['Specular IOR Level'].default_value=.18
  bs.inputs['Roughness'].default_value=.5 if key not in ('silver','glass') else .22
  bs.inputs['Metallic'].default_value=.65 if key=='silver' else .05
  MATS[key]=mat
 return MATS[key]
def reset():
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def mesh(name,key='graphite',offset=(0,0,0),printable=False):
 path=(ROOT/'stl' if printable else ASSETS)/(name+'.stl')
 bpy.ops.wm.stl_import(filepath=str(path));obj=bpy.context.object;obj.name=name;obj.scale=(S,S,S);obj.location=Vector(offset)*S
 obj.data.materials.clear();obj.data.materials.append(material(key))
 for face in obj.data.polygons:face.material_index=0
 bevel=obj.modifiers.new('Fine edge highlight','BEVEL');bevel.width=.16;bevel.segments=2;bevel.limit_method='ANGLE'
 bevel.angle_limit=.6
 return obj
# STL mesh is in mm, and object scale converts it to metres. Modifier widths are local mm.
def text(body,position,size=2.4,key='cream',rotation=(0,0,0)):
 curve=bpy.data.curves.new('display type','FONT');curve.body=body;curve.size=size*S;curve.align_x='CENTER';curve.align_y='CENTER';curve.extrude=.01*S
 obj=bpy.data.objects.new(body,curve);bpy.context.collection.objects.link(obj);obj.location=Vector(position)*S;obj.rotation_euler=rotation;obj.data.materials.append(material(key));return obj
def box(name,location,size,key,bevel=.1):
 bpy.ops.mesh.primitive_cube_add(size=1,location=Vector(location)*S);obj=bpy.context.object;obj.name=name;obj.dimensions=Vector(size)*S;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);obj.data.materials.append(material(key))
 if bevel:
  b=obj.modifiers.new('Edge','BEVEL');b.width=bevel*S;b.segments=2
 return obj
def cable(points,key='black',radius=.65):
 curve=bpy.data.curves.new('Cable','CURVE');curve.dimensions='3D';curve.bevel_depth=radius*S;curve.bevel_resolution=3
 spl=curve.splines.new('BEZIER');spl.bezier_points.add(len(points)-1)
 for p,co in zip(spl.bezier_points,points):p.co=Vector(co)*S;p.handle_left_type='AUTO';p.handle_right_type='AUTO'
 ob=bpy.data.objects.new('Illustrative cable',curve);bpy.context.collection.objects.link(ob);ob.data.materials.append(material(key));return ob

def p1(explode=0):
 objs=[]
 for name,key,off in [('frame','graphite',explode),('back','graphite',-explode),('phone','black',0),('bar','black',0),('lenses','glass',0),('brand','red',explode),('screen','glass',0)]:objs.append(mesh('p1_'+name,key,(0,0,off)))
 return objs

def p2(mode='assembly'):
 e=25 if mode=='exploded' else 0
 meshes=[('base','graphite',0),('bank','black',-e),('pi','green',2.2*e),('ports','silver',2.2*e),('header','black',2.2*e),('heatsinks','graphite',2.2*e),('shim','red',3.1*e),('bread','cream',2.2*e)]
 if mode!='exploded':meshes.append(('straps','black',0))
 if mode!='open':meshes += [('lid','graphite',5.2*e),('brand','red',5.2*e),('oled','blue',4*e),('oledscreen','glass',4*e),('button','silver',4.4*e),('buttonring','red',4.4*e)]
 for name,key,off in meshes:mesh('p2_'+name,key,(0,0,off))
 if mode!='open':mesh('p2_glue','cream',(0,0,4*e))
 if mode!='open':
  text('HANDOFF', (43.78,36.8,35.75+4*e),2.4)
  text('RELAY READY',(43.78,31.6,35.75+4*e),1.7)
 # Render-only breadboard perforations on reference model.
 for xx in range(17):
  for yy in list(range(5))+list(range(6,11)):
   box('Breadboard socket',(107.2+xx*2.4,13.5+yy*2.75,12.52+2.2*e),(.65,.65,.07),'black',0)
 if mode=='open':
  # Lid subassembly parked beside base, leaving Pi, SHIM and breadboard visible.
  for name,key in [('lid','graphite'),('brand','red'),('oled','blue'),('oledscreen','glass'),('button','silver'),('buttonring','red'),('glue','cream')]:mesh('p2_'+name,key,(0,100,-25))
  text('HANDOFF',(43.78,136.8,10.75),2.4)
  text('RELAY READY',(43.78,131.6,10.75),1.7)
  cable([(20,52,21.6),(23,69,28),(70,71,28),(82,80,29)],'black')

def p3(explode=0,strapped=False):
 for n,k,z in [('tray','graphite',0),('hood','graphite',2*explode),('board','red',explode),('sensor','glass',explode),('connectors','black',explode),('clips','graphite',0)]:mesh('p3_'+n,k,(0,0,z))
 if strapped:mesh('p3_finger','skin');mesh('p3_strap','black')
 if not explode:cable([(-1,12.7,5.8),(-9,12.7,5.8),(-19,3,4),(-26,-9,2)],'black',.6)

def look_at(obj,point):obj.rotation_euler=(Vector(point)-obj.location).to_track_quat('-Z','Y').to_euler()
def render(name,view=(1,-1.45,1.25),margin=1.25):
 scene=bpy.context.scene
 content=[o for o in scene.objects if o.type in ('MESH','FONT','CURVE')]
 bpy.context.view_layer.update()
 coords=[o.matrix_world@Vector(c) for o in content for c in o.bound_box]
 lo=Vector([min(v[i] for v in coords) for i in range(3)]);hi=Vector([max(v[i] for v in coords) for i in range(3)]);center=(lo+hi)/2
 bpy.ops.object.camera_add();cam=bpy.context.object;cam.location=center+Vector(view).normalized()*.6;look_at(cam,center);cam.data.type='ORTHO';cam.data.lens=50;scene.camera=cam
 # Fit projected bounds, preserving generous whitespace and all exploded layers.
 inv=cam.rotation_euler.to_matrix().transposed();proj=[inv@(v-center) for v in coords]
 width=max(p.x for p in proj)-min(p.x for p in proj);height=max(p.y for p in proj)-min(p.y for p in proj)
 cam.data.ortho_scale=max(width,height*4/3)*margin
 bpy.ops.mesh.primitive_plane_add(size=200,location=(center.x,center.y,lo.z-.002));ground=bpy.context.object;ground.name='Studio floor'
 mat=bpy.data.materials.get('Backdrop') or bpy.data.materials.new('Backdrop');mat.diffuse_color=(.77,.79,.81,1);ground.data.materials.append(mat)
 for pos,power,size in [((-.22,-.32,.45),8,.32),((.26,.12,.3),5,.27),((-.08,.28,.15),3,.22)]:
  bpy.ops.object.light_add(type='AREA',location=center+Vector(pos));light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=size;look_at(light,center)
 scene.world.color=(.65,.65,.65)
 scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
 scene.render.resolution_x=1600;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
 scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False
 scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
 print('RENDERED',name,flush=True)

names=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
# Every printable component in its exact supplied bed orientation.
for path in sorted((ROOT/'stl').glob('*.stl')):
 name=path.stem
 if names and name not in names:continue
 reset();mesh(name,printable=True);render(name)
for name in ('bodycam_assembled','bodycam_exploded','bodycam_worn','bodycam_front_assembled','relay_assembled','relay_open','relay_exploded','finger_clip_assembled','finger_clip_exploded','finger_clip_strapped'):
 if names and name not in names:continue
 reset()
 if name.startswith('bodycam'):
  if name=='bodycam_front_assembled':
   for n,k in [('frame','graphite'),('back','graphite'),('phone','black'),('screen','glass'),('brand','red')]:mesh('p1front_'+n,k)
   text('HANDOFF',(0,7,8.62),7);text('CAMERA LIVE',(0,-7,8.62),3.5)
   render(name,view=(1,-1.5,1.5));continue
  parts=p1(28 if name.endswith('exploded') else 0)
  if name=='bodycam_worn':
   # CAD XY phone plane -> upright world XZ. Outward normal points -Y and 15° down.
   bpy.context.view_layer.update();axis_z=-2.2-12
   upright=Matrix.Rotation(math.radians(90),4,'X')
   tilt=Matrix.Translation(Vector((0,0,axis_z*S)))@Matrix.Rotation(math.radians(15),4,'X')@Matrix.Translation(Vector((0,0,-axis_z*S)))
   for ob in parts:ob.matrix_world=upright@tilt@ob.matrix_world
   buck=mesh('p1_buckle','black',(0,0,axis_z-15));bpy.context.view_layer.update();buck.matrix_world=upright@buck.matrix_world
   bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=2.45*S,depth=27*S,location=(0,0,axis_z*S),rotation=(0,math.pi/2,0));screw=bpy.context.object;screw.data.materials.append(material('silver'));bpy.context.view_layer.update();screw.matrix_world=upright@screw.matrix_world
   box('Simple chest plane',(0,33.2,0),(220,8,180),'chest',7)
   for xx in [-75,75]:box('Harness webbing',(xx,28.7,0),(18,1,180),'black',.3)
   render(name,view=(1,-2.2,.8),margin=1.15)
  else:render(name,view=(1,-1.5,1.5 if name=='bodycam_assembled' else 1.0))
 elif name.startswith('relay'):
  p2('open' if name.endswith('open') else 'exploded' if name.endswith('exploded') else 'assembly');render(name,view=(1,-1.45,1.55 if name!='relay_exploded' else .9))
 else:p3(15 if name.endswith('exploded') else 0,strapped=name.endswith('strapped'));render(name,view=(1,-1.8,1.6))
