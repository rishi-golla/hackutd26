#!/usr/bin/env python3
"""Concept-only product scenes; read current CAD assets, never modify CAD/STLs.
Blender -b --python-exit-code 1 -P renders/src/render_product_demo.py -- <scene ids>
"""
import bpy,math,sys,json,runpy,hashlib
from pathlib import Path
from mathutils import Vector,Matrix
from bpy_extras.object_utils import world_to_camera_view
HERE=Path(__file__).resolve().parent;OUT=HERE.parent;HW=OUT.parent;S=.001
lib=runpy.run_path(str(HW/'manual/src/render_manual.py'),run_name='render_library')
lib=lib['reset'].__globals__
mesh=lib['mesh'];box0=lib['box'];line=lib['line'];cylinder=lib['cylinder'];transform=lib['transform'];assign=lib['assign']
BEZ=lib['hero_bezier'];FONT='/System/Library/Fonts/Supplemental/Arial.ttf'
CAM=None;R=1600;H=1000;LABELS=[]

def reset():
 global LABELS
 LABELS=[]
 lib['reset'](True)
 lib['COLORS'].update({'uniform':'376278','pants':'293f50','training':'d9b79b','volunteer':'788d91','foam':'454e55','cardboard':'b99f78','purple':'866aa2','rubber':'1b2229'})

def box(name,p,d,key='graphite',bevel=0):
 o=box0(name,p,d,key)
 if bevel:
  m=o.modifiers.new('soft edges','BEVEL');m.width=bevel*S;m.segments=3
 return o

def ellipsoid(name,p,d,key):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=20,location=Vector(p)*S);o=bpy.context.object;o.name=name;o.scale=Vector(d)*S
 for f in o.data.polygons:f.use_smooth=True
 return assign(o,key)

def limb(name,a,b,r,key):
 a=Vector(a);b=Vector(b);o=ellipsoid(name,(a+b)/2,(r,r,(b-a).length/2+r*.5),key);o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o

def text(body,p,size=5,key='white',rot=(0,0,0),align='CENTER'):
 cv=bpy.data.curves.new(body,'FONT');cv.body=body;cv.size=size*S;cv.align_x=align;cv.align_y='CENTER';cv.font=bpy.data.fonts.load(FONT,check_existing=True)
 o=bpy.data.objects.new(body,cv);bpy.context.collection.objects.link(o);o.location=Vector(p)*S;o.rotation_euler=rot;assign(o,key)
 lib['OLD'].objects.unlink(o);lib['TEXT'].objects.link(o);return o

def objects_since(before):return [o for o in bpy.context.scene.objects if o not in before]
def place(objs,at=(0,0,0),rot=0):transform(objs,Matrix.Translation(Vector(at)*S)@Matrix.Rotation(math.radians(rot),4,'Z'))
def smooth(points,key='black',r=1):
 cv=bpy.data.curves.new('flexible cable','CURVE');cv.dimensions='3D';cv.bevel_depth=r*S;cv.bevel_resolution=3
 sp=cv.splines.new('BEZIER');sp.bezier_points.add(len(points)-1)
 for p,co in zip(sp.bezier_points,points):p.co=Vector(co)*S;p.handle_left_type='AUTO';p.handle_right_type='AUTO'
 o=bpy.data.objects.new('flexible cable',cv);bpy.context.collection.objects.link(o);return assign(o,key)

def screen_plane(p,w,h,xf):
 me=bpy.data.meshes.new('monitor pixels');x,y,z=p;me.from_pydata([(x-w/2,y-h/2,z),(x+w/2,y-h/2,z),(x+w/2,y+h/2,z),(x-w/2,y+h/2,z)],[],[(0,1,2,3)]);me.update()
 o=bpy.data.objects.new('Illustrative patient monitor UI',me);bpy.context.collection.objects.link(o);o.scale=(S,S,S)
 uv=me.uv_layers.new()
 for poly in me.polygons:
  for loop,co in zip(poly.loop_indices,[(0,0),(1,0),(1,1),(0,1)]):uv.data[loop].uv=co
 m=bpy.data.materials.new('Dark monitor demo UI');m.use_nodes=True;n=m.node_tree.nodes;n.clear();out=n.new('ShaderNodeOutputMaterial');e=n.new('ShaderNodeEmission');im=n.new('ShaderNodeTexImage');im.image=bpy.data.images.load(str(OUT/'assets/monitor_ui.png'),check_existing=True);m.node_tree.links.new(im.outputs['Color'],e.inputs['Color']);m.node_tree.links.new(e.outputs[0],out.inputs[0]);o.data.materials.append(m)
 transform([o],xf);return o

MON_CENTER=Vector((4,184,111));MON_XF=Matrix.Translation(MON_CENTER*S)@Matrix.Rotation(math.radians(68),4,'X')
def mp(p):return MON_XF@ (Vector(p)*S)/S

def monitor():
 # Generic 250 x 175 mm Wi-Fi tablet. No cable joins it to the relay.
 before=set(bpy.context.scene.objects)
 box('wireless tablet housing',(0,0,0),(250,175,8),'black',7)
 box('tablet front glass',(0,0,4.3),(244,169,.6),'marker',6)
 cylinder((0,80,4.6),(0,80,4.8),1.5,'black')
 transform(objects_since(before),MON_XF)
 screen_plane((0,0,4.8),232,145,MON_XF)
 # Two hinged rigid arms form a simple folding A stand behind the tablet.
 box('folding stand foot',(4,192,-11.5),(112,106,6),'graphite',4)
 for x in (-37,45):
  hinge=mp((x-4,-4,-8))
  cylinder((x,160,-8),hinge,3.8,'metal')
  cylinder((x,235,-8),hinge,3.8,'metal')
 cylinder(mp((-45,-4,-8)),mp((45,-4,-8)),4.8,'black')
 # Small shelf under the bottom edge; stand and tablet details are schematic.
 before=set(bpy.context.scene.objects)
 box('tablet support shelf',(0,-89,0),(104,5,15),'graphite',1.5)
 transform(objects_since(before),MON_XF)
 return {'monitor':tuple(mp((-118,38,5)))}

def oled_and_temperature():
 # Approximate GME12864 module adhered flat; no alteration to the printed lid.
 ox,oy,z=123,29,41.2
 box('OLED adhesive pad',(ox,oy,40.0),(23,23,1.2),'black',.6)
 box('GME12864 blue PCB',(ox,oy,z),(27,27,1.6),'blue',.5)
 box('OLED glass',(ox,oy-2,z+1.3),(24,14,1),'black',.3)
 box('OLED active pixels',(ox,oy-2,z+1.84),(22,11,.12),'101921',.1)
 for dy,body in [(1.7,'HR 72  SpO2 97'),(-1.6,'T 36.4C'),(-4.9,'LINK OK')]:
  text(body,(ox-10.3,oy+dy,z+1.94),1.85,'white',align='LEFT')
 # Module-top header label order follows the request. Pin heights are illustrative.
 for i,(label,key) in enumerate([('GND','black'),('VCC','wirered'),('SCL','yellow'),('SDA','45a77d')]):
  x=ox+(i-1.5)*2.54
  box('OLED header insulator',(x,oy+10.3,z+1.7),(2.45,2.5,1.8),'black',.15)
  box('OLED header pin',(x,oy+10.3,z+4.3),(.65,.65,3.5),'gold')
  box('OLED female jumper',(x,oy+10.3,z+6.5),(2.35,2.45,5),'black',.15)
  # Labels are small on the real module; they are present without exaggerating its scale.
  text(label,(x,oy+6.6,z+.85),.78,'white')
  # The four distinct ends enter successive Y positions in the FIRST slot.
  smooth([(x,oy+10.3,z+9),(x-3,oy+15,54),(97-i*.75,43+i*1.6,49),(71,36+i*2.6,48),(64.6,27+i*3.5,44),(64.6,27+i*3.5,36)],key,.42)
 return dict(temperature_module(),oled=(ox,oy-2,z+2))

def temperature_module(vent_x=78.6):
 # Generic 18B20 module: vent 3 in historical OLED views, vent 2 with the LCD pod.
 tx,ty,tz=160,-27,-12.6
 box('18B20 temperature module PCB',(tx,ty,tz),(15,20,1.6),'blue',.6)
 box('18B20 sensor package',(tx,ty-3,tz+3),(4.7,3.5,4.4),'black',.7)
 for i,key in enumerate(['black','wirered','yellow']):
  x=tx+(i-1)*2.54
  box('temperature module connector',(x,ty+7,tz+2),(2.4,4,2.6),'black',.2)
  smooth([(vent_x,22+i*3,36),(vent_x,22+i*3,43),(vent_x,8+i*1.2,43),(114,8+i*1.2,45),(149,5+i*1.2,43),(169+i,-5,8),(x,ty+9,tz+3)],key,.42)
 return {'temperature':(vent_x,26,42)}

def lcd_pod_display():
 at=(0,10,39.4)
 for n,k in [('lcd_pod_base','graphite'),('lcd_pod_board','pcb'),('lcd_pod_bezel','black'),('lcd_pod_backpack','pcb'),('lcd_pod_pot','blue'),('lcd_pod_header','gold'),('lcd_pod_female_ends','black'),('lcd_pod_glue','gold')]:mesh(n,k,offset=at)
 before=set(bpy.context.scene.objects)
 box('LCD1602 blue backlight',(40,18,8.66),(64.5,14,.1),'174fc2')
 for row,body in enumerate(['HR  72  SpO2  97','pulse    LINK OK']):
  assert len(body)==16
  y=21.3-row*7
  for col,ch in enumerate(body):
   x=10.5+3.92*col
   box('LCD character cell',(x,y,8.73),(3.15,5.4,.03),'2051ba')
   if ch!=' ':text(ch,(x,y,8.78),4.8,'d0edff')
 xf=Matrix.Translation((Vector(at)+Vector((3.5,4,17)))*S)@Matrix.Rotation(math.radians(20),4,'X')
 transform(objects_since(before),xf)
 # Preserve the exact pod's established four-lead route through the third vent.
 data=json.loads((lib['ASSETS']/'lcd_routes.json').read_text())
 for i,route in enumerate(data[0]):line(route,('black','wirered','wireblue','yellow')[i],.55,False)
 return dict(temperature_module(71.6),lcd=(43.5,28,71),lcd_leads=(78.6,33,43))

def relay(with_finger=True,display='oled'):
 lib['relay_base'](with_bank=True);lib['lid_group']();lib['hero_power']()
 if display=='lcd':
  mesh('lcd_pod_second_strap','black');mesh('lcd_pod_stack_strap','black');parts=lcd_pod_display()
 else:
  mesh('p2_backup_strap','black');parts=oled_and_temperature()
 lib['finger_input'](tied=True)
 if with_finger:
  pts=BEZ((83,101,30),(117,145,6),(215,120,-9),(242,77,-9),60)
  lib['hero_ribbon'](pts)
 return dict(parts,mark=(128,61,44),finger=(96,113,22),straps=(36,23,41))

def setup_camera(target,view,scale):
 global CAM
 lib['camera'](target,view,scale,size=(R,H));CAM=lib['CAM'];CAM.location=Vector(target)*S+Vector(view).normalized()*max(.6,scale*S*2);CAM.data.clip_end=100

def pix(p):
 v=world_to_camera_view(bpy.context.scene,CAM,Vector(p)*S)
 return (R*v.x,H*(1-v.y))
def point(x,y,d=.025):return CAM.location+CAM.rotation_euler.to_matrix()@Vector(((x/R-.5)*CAM.data.ortho_scale,(.5-y/H)*CAM.data.ortho_scale*H/R,-d))
def overlay_mesh(name,verts,key):
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],[tuple(range(len(verts)))]);me.update();o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);assign(o,key);lib['OLD'].objects.unlink(o);lib['TEXT'].objects.link(o);return o

def callout(body,xy,target,width,side='bottom'):
 LABELS.append({'text':body,'xy':list(xy),'target':list(pix(target)),'width':width,'side':side})


def monitor_scene(labeled=False):
 reset();a=relay()
 before=set(bpy.context.scene.objects);tablet=monitor()
 # Independent table footprint to the left, not a backdrop to the relay.
 shift=Vector((-249,-84,-1))
 place(objects_since(before),shift)
 a.update({k:tuple(Vector(v)+shift) for k,v in tablet.items()})
 setup_camera((-66,100,55),(.2,-1,1.05),650)
 CAM.data.type='PERSP';CAM.data.lens=43
 CAM.location=Vector((80,-200,150))*S
 CAM.rotation_euler=(Vector((-45,70,50))*S-CAM.location).to_track_quat('-Z','Y').to_euler()
 bpy.context.view_layer.update()
 # Fit the two independent footprints together while preserving perspective scale.
 subjects=[o for o in bpy.context.scene.objects if o.type in ('MESH','CURVE','FONT')]
 def projected_bounds():
  pts=[pix((o.matrix_world@Vector(c))/S) for o in subjects for c in o.bound_box]
  return min(p[0] for p in pts),min(p[1] for p in pts),max(p[0] for p in pts),max(p[1] for p in pts)
 x0,y0,x1,y1=projected_bounds()
 CAM.data.lens*=min(1440/(x1-x0),730/(y1-y0))
 x0,y0,x1,y1=projected_bounds()
 CAM.data.shift_x+=((x0+x1)/2-R/2)/R
 CAM.data.shift_y+=(H/2-(y0+y1)/2)/R
 bpy.context.view_layer.update()
 if labeled:
  for body,xy,anchor,w,side in [
   ('Monitor page on a tablet\n(separate, Wi-Fi)',(45,42),'monitor',370,'bottom'),
   ('Temperature probe leads\n(vent 3)',(930,90),'temperature',355,'bottom'),
   ('OLED, 0.96 in\n(27 mm board)',(1260,490),'oled',290,'left'),
   ('MARK button',(1250,300),'mark',280,'left'),
   ('Finger clip cable',(1150,840),'finger',340,'top'),
   ('2 straps',(600,840),'straps',240,'top')]:callout(body,xy,a[anchor],w,side)

def relay_lcd_scene(labeled=False):
 reset();a=relay(display='lcd')
 a['finger']=(170.84,121.16,-3.56)
 a['lcd_leads']=(94,29,45)
 setup_camera((95,44,25),(.9,-1.6,1.75),360)
 bpy.context.view_layer.update()
 if labeled:
  for body,xy,anchor,w,side in [
   ('LCD1602 in the printed pod',(45,55),'lcd',395,'bottom'),
   ('LCD leads (vent 3)',(1140,65),'lcd_leads',320,'bottom'),
   ('Temperature probe leads\n(vent 2)',(540,840),'temperature',355,'top'),
   ('MARK button',(1250,320),'mark',280,'left'),
   ('Finger clip cable',(1140,825),'finger',340,'top'),
   ('2 straps',(45,735),'straps',240,'top')]:callout(body,xy,a[anchor],w,side)

def oled_closeup_scene():
 reset();lib['lid_group']();oled_and_temperature()
 # A near-top orthographic view keeps the 27 mm PCB and 19 mm button at true scale.
 setup_camera((102,38,40),(0,-.35,1.5),132)
 # The scale bar's length is projected from an actual 20 mm span in the lid plane.
 bpy.context.view_layer.update()
 a,b=pix((115,12,39.4)),pix((135,12,39.4))
 (OUT/'qa/oled_scale_bar.json').write_text(json.dumps({'millimetres':20,'pixels':math.dist(a,b),'xy':[1130,887]},indent=2))


def grove_board(name,p,size=(20,20),kind='generic'):
 x,y,z=p;box(name,(x,y,z),(size[0],size[1],1.6),'pcb',1)
 # White four-position Grove socket and visible black contact wells.
 box('Grove connector',(x,y-size[1]/2+3,z+2.4),(9,5,3.2),'white',.5)
 for u in [-3,-1,1,3]:box('socket well',(x+u,y-size[1]/2+.4,z+2.6),(1,1,1.2),'black')
 if kind=='ir':
  for u in [-4,4]:cylinder((x+u,y+3,z+.8),(x+u,y+3,z+4.7),2.7,'black' if u<0 else '595d70')
  box('IR comparator',(x,y-1,z+1.6),(5,4,1.2),'black')
 elif kind=='light':
  cylinder((x,y+3,z+.8),(x,y+3,z+2),4.2,'gold')
  for u in range(-2,3):line([(x+u*1.15,y,z+2.1),(x+u*1.15,y+6,z+2.1)],'cardboard',.2,False)
 elif kind=='temp':box('temperature barometer sensor',(x+3,y+1,z+2.3),(7,6,3),'metal',.3);box('sensor chip',(x-6,y+2,z+1.5),(4,4,1.2),'black')
 return (x,y-size[1]/2,z+2.4)

def grove_bundle(start,end,bend):
 for i,k in enumerate(['black','wirered','white','yellow']):
  off=Vector(((i-1.5)*.7,0,0));smooth([Vector(start)+off,Vector(bend)+off,Vector(end)+off],k,.31)

def jumper_tip(name,p):
 # Exposed male shaft enters a female header or breadboard; no shield sockets.
 x,y,z=p
 box(name+' male metal pin',(x,y,z+1.5),(.65,.65,4),'gold')
 box(name+' jumper grip',(x,y,z+4),(1.7,1.7,3.3),'black',.15)
 return Vector((x,y,z+5.8))

def grove_breakout(name,start,at,bend,used=(0,1,2,3)):
 # Original Grove cable retains its white female plug. Individual male jumpers
 # are visibly inserted into that plug, then fan out to headers or breadboard.
 grove_bundle(start,Vector(at)+Vector((0,-3,0)),bend)
 x,y,z=at;box(name+' Grove cable end',(x,y,z),(10,6,4),'white',.6)
 ports={}
 for i in range(4):
  p=(x+(i-1.5)*2,y,z+2.1)
  box('Grove female contact',p,(1.3,1.3,.25),'black')
  if i in used:ports[i]=jumper_tip(name,p)
 return ports

def uno_q():
 # Schematic bare board: official UNO footprint and visible 8 x 13 blue matrix.
 box('bare UNO Q PCB',(137,87,6),(68.85,53.34,1.6),'blue',2)
 ports={}
 rows=[(109.2,115,['SCL','SDA','AREF','GND_D','D13','D12','D11','D10','D9','D8','D7','D6','D5','D4','D3','D2','D1','D0']),
       (64.8,110,['BOOT','IOREF','RESET','3.3V','5V','GND','GND_2','VIN']),
       (64.8,137.94,['A0','A1','A2','A3','A4','A5'])]
 for y,x0,labels in rows:
  box('UNO female header',(x0+(len(labels)-1)*1.27,y,10.6),(len(labels)*2.54,3,7.6),'black',.35)
  for i,label in enumerate(labels):
   x=x0+i*2.54;box('empty female header socket',(x,y,14.48),(1.25,1.25,.14),'marker')
   ports[label]=(x,y,14.5)
   if label in ['SDA','SCL','D2','A0','3.3V','GND']:
    text(label,(x,y+(-3.4 if y>80 else 3.4),6.91),1.25,'white')
 box('UNO processor',(117,87,8),(15,14,2.4),'black',.5)
 box('UNO small controller',(159,84,7.8),(8,9,1.8),'black',.4)
 box('LED matrix dark field',(139,87,7.2),(25,17,1),'marker',.5)
 for row in range(8):
  for col in range(13):
   box('UNO blue matrix LED',(128.8+col*1.7,81.05+row*1.7,7.86),(1.05,1.05,.35),'56b5ee' if (col==row or col==12-row) else '24485e',.12)
 box('UNO USB C socket',(171.2,92,8),(7,9,4),'metal',1)
 return ports

def medkit_breadboard():
 # 170 contacts, 17 separate five-hole rows per half. Four selected rows
 # carry 3.3 V, GND, SDA and SCL, with one plug per physical contact.
 bx,by=215,87
 box('small 45 by 35 breadboard',(bx,by,5),(45,35,9.5),'white',1.4)
 box('breadboard centre trench',(bx,by,9.8),(43,3,.2),'cfd7de',.3)
 holes={}
 for row in range(17):
  x=bx+(row-8)*2.54
  for side in (-1,1):
   for j in range(5):
    y=by+side*(4+j*2.54);box('breadboard contact',(x,y,9.83),(1.05,1.05,.16),'marker',.15)
    holes[(row,side,j)]=(x,y,9.9)
 buses={'3.3V':[holes[(1,-1,j)] for j in range(5)],'GND':[holes[(4,-1,j)] for j in range(5)],
        'SDA':[holes[(10,1,j)] for j in range(5)],'SCL':[holes[(13,1,j)] for j in range(5)]}
 for name,row,col in [('3V3',1,'wirered'),('GND',4,'black'),('SDA',10,'marker'),('SCL',13,'yellow')]:
  text(name,(bx+(row-8)*2.54,by-16 if row<5 else by+16,9.9),1.4,col)
 return buses

def vial(x,y,word,color):
 cylinder((x,y,22),(x,y,64),12,'dce5e9',vertices=48)
 cylinder((x,y,35),(x,y,53),12.1,'white',vertices=48)
 cylinder((x,y,64),(x,y,72),11.8,color,vertices=48)
 cylinder((x,y,61),(x,y,65),8.5,'metal',vertices=48)
 text(word+'\nDEMO',(x,y-12.2,44),4.7,'marker',(math.pi/2,0,0))
 # Three sides of the foam pocket; the front is cut away to reveal the sensor.
 for xx in (-16,16):box('foam slot cheek',(x+xx,y+1,18),(5,33,10),'foam',1)
 box('foam slot rear',(x,y+16,18),(36,5,10),'foam',1)

def medkit():
 box('180 by 120 cardboard tray',(90,60,2),(180,120,4),'cardboard',2)
 box('tray rear wall',(90,118,12),(180,4,20),'cardboard',1)
 box('tray left wall',(2,60,12),(4,116,20),'cardboard',1)
 # Front wall and pocket fronts deliberately cut away for sensor visibility.
 for xx in (35,77):box('sensor bay floor',(xx,43,5),(38,39,2),'foam',1)
 ir=grove_board('IR reflective sensor',(35,38,7),(20,20),'ir');light=grove_board('light sensor',(77,38,7),(20,20),'light')
 vial(35,46,'EPI','wirered');vial(77,46,'AMIO','purple')
 temp=grove_board('storage temperature and pressure',(20,13,7),(28,20),'temp')
 ports=uno_q();buses=medkit_breadboard()
 # Countdown board tilted toward the viewer.
 before=set(bpy.context.scene.objects)
 box('quad alphanumeric I2C Grove board',(0,0,0),(43,24,1.6),'blue',1)
 box('0.54 inch four-character display',(0,0,3),(38,17,5),'black',1)
 text('3:12',(0,0,5.6),11.6,'ff674a')
 transform(objects_since(before),Matrix.Translation(Vector((137,30,19))*S)@Matrix.Rotation(math.radians(32),4,'X'))
 box('timer foam support',(137,32,10),(32,17,10),'foam',2)
 ir_end=grove_breakout('IR',ir,(56,12,8),(39,15,7),(0,1,3))
 light_end=grove_breakout('light',light,(93,16,8),(79,15,8),(0,1,3))
 temp_end=grove_breakout('temperature',temp,(42,-15,5),(20,-9,5))
 display_end=grove_breakout('display',(137,39,16),(170,39,7),(156,46,15))
 # Shared power: four module leads plus one UNO feed occupy five different holes.
 for module_index,ends in enumerate([ir_end,light_end,temp_end,display_end]):
  for channel,bus,key in [(0,'GND','black'),(1,'3.3V','wirered')]:
   end=jumper_tip(bus+' breadboard',buses[bus][module_index])
   smooth([ends[channel],(106+module_index*3,50-module_index*4,19),(183+module_index*2,50-module_index*4,17),end+Vector((0,-5,3)),end],key,.36)
 for label,key in [('3.3V','wirered'),('GND','black')]:
  start=jumper_tip('UNO '+label,ports[label]);end=jumper_tip('bus feed '+label,buses[label][4])
  smooth([start,(start.x,55,25),(184,54 if key=='black' else 57,24),end],key,.43)
 # Two used signal wires connect directly. White socket contacts stay empty.
 end=jumper_tip('UNO D2',ports['D2']);smooth([ir_end[3],(77,4,16),(98,48,20),(101,101,23),(152,114,24),end],'yellow',.42)
 end=jumper_tip('UNO A0',ports['A0']);smooth([light_end[3],(105,27,17),(112,52,22),end],'yellow',.42)
 for ends,index in [(temp_end,0),(display_end,1)]:
  for channel,bus,key in [(2,'SDA','white'),(3,'SCL','yellow')]:
   end=jumper_tip(bus+' branch',buses[bus][index])
   smooth([ends[channel],(177+index*5,17+channel*5,14),(241+channel,57,16),(236+channel,112+index*4,18),end],key,.4)
 for bus,key in [('SDA','white'),('SCL','yellow')]:
  start=jumper_tip('UNO '+bus,ports[bus]);end=jumper_tip(bus+' common',buses[bus][2])
  smooth([start,(start.x,115,25),(178,116 if bus=='SDA' else 120,26),end+Vector((0,4,4)),end],key,.44)
 box('small generic USB C bank',(284,65,10),(42,86,20),'black',5)
 box('bank power indicator',(284,30,20.2),(13,1.5,.5),'white',.3)
 box('USB C plug at bank',(262,58,10),(10,8,5),'black',1)
 box('USB C plug at UNO',(178,92,8),(12,8,5),'black',1)
 smooth([(183,92,8),(189,124,8),(252,129,8),(256,58,10),(260,58,10)],'black',1.1)
 return {'epi':(35,36,10),'amio':(77,36,10),'temperature':(20,13,10),'countdown':(137,29,25),'uno':(153,109.2,18),'breadboard':(217,87,10),'bank':(284,67,21)}

def medkit_scene(labeled=False):
 reset();a=medkit();setup_camera((146,57,22),(.65,-1.6,1.9),460)
 bpy.context.view_layer.update()
 if labeled:
  for body,xy,anchor,w,side in [
   ('EPI slot:\nIR reflective sensor',(35,55),'epi',325,'bottom'),
   ('AMIO slot:\nlight sensor',(405,35),'amio',300,'bottom'),
   ('Storage temperature sensor',(35,825),'temperature',390,'top'),
   ('Arduino UNO Q (no shield):\njumper pins in Grove cables',(790,35),'uno',430,'bottom'),
   ('Countdown display',(480,885),'countdown',300,'top'),
   ('Small breadboard:\nshared 3.3 V, GND and I2C',(835,825),'breadboard',380,'top'),
   ('Power bank',(1305,730),'bank',245,'top')]:callout(body,xy,a[anchor],w,side)


def add_ground(z,extent=10):
 bpy.ops.mesh.primitive_plane_add(size=extent,location=(0,0,z*S));o=bpy.context.object;o.name='neutral floor'
 m=bpy.data.materials.new('soft studio ground');m.use_nodes=True;b=m.node_tree.nodes.get('Principled BSDF');b.inputs['Base Color'].default_value=(.90,.92,.94,1);b.inputs['Roughness'].default_value=.9;o.data.materials.append(m)
 # Keep floor outside the line-art collection.
 for pos,power,size in [((-.7,-1.1,2.5),220,2.0),((1.2,.7,2),140,2.5)]:
  bpy.ops.object.light_add(type='AREA',location=pos);l=bpy.context.object;l.data.energy=power;l.data.shape='DISK';l.data.size=size
  l.rotation_euler=(Vector((0,0,0))-l.location).to_track_quat('-Z','Y').to_euler()

def render(name):
 if name in ('relay_lcd','relay_lcd_labeled','demo_scene'):
  assert not any('tablet' in o.name.lower() for o in bpy.context.scene.objects), 'Tablet must be absent'
  assert not any('GME12864' in o.name for o in bpy.context.scene.objects), 'OLED must be absent'
  (OUT/'qa'/(name+'_current_hardware.json')).write_text(json.dumps({'tablet_objects':0,'oled_objects':0,'lcd_pod':True,'lcd_vent':3,'temperature_vent':2,'object_count':len(bpy.context.scene.objects)},indent=2))
 sc=bpy.context.scene;sc.render.engine='CYCLES';sc.cycles.samples=24;sc.cycles.use_denoising=True
 sc.world.use_nodes=True;sc.world.node_tree.nodes['Background'].inputs['Color'].default_value=(*lib['linear']('f4f6f8'),1);sc.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.8
 sc.view_settings.view_transform='Standard';sc.view_settings.look='None';sc.render.resolution_x=R;sc.render.resolution_y=H;sc.render.resolution_percentage=100
 sc.render.image_settings.file_format='PNG';sc.render.image_settings.color_mode='RGB';sc.render.film_transparent=False
 lib['styles']()
 for ls in bpy.context.view_layer.freestyle_settings.linesets:ls.linestyle.thickness=1.45
 sc.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True);(OUT/'qa'/(name+'_callouts.json')).write_text(json.dumps(LABELS,indent=2));print('RENDERED',name,flush=True)

SCENES={'monitor_relay':lambda:monitor_scene(False),'monitor_relay_labeled':lambda:monitor_scene(True),'relay_lcd':lambda:relay_lcd_scene(False),'relay_lcd_labeled':lambda:relay_lcd_scene(True),'monitor_relay_oled_closeup':oled_closeup_scene,'medkit':lambda:medkit_scene(False),'medkit_labeled':lambda:medkit_scene(True)}
# Whole-demo builder is loaded separately to keep the close-up assets reusable.
if (HERE/'scene_demo.py').exists():exec((HERE/'scene_demo.py').read_text(),globals())
ids=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else ['relay_lcd','relay_lcd_labeled','medkit','medkit_labeled','demo_scene']
for name in ids:
 SCENES[name]();add_ground(-15.5 if name.startswith(('monitor','relay_lcd')) else -1);render(name)
