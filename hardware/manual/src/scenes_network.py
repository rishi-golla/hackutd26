# Current CAD network overview; replaces the historical generated OLED illustration.
def network_panel(build,at,width,view=(1,-1.3,2.0)):
 before=set(bpy.context.scene.objects);build()
 objs=[o for o in bpy.context.scene.objects if o not in before]
 rot=(-Vector(view)).to_track_quat('-Z','Y').to_matrix().transposed().to_4x4()
 transform(objs,rot);lo,hi=bounds(objs);factor=width*S/(hi.x-lo.x)
 xf=Matrix.Translation(Vector(at)*S)@Matrix.Scale(factor,4)@Matrix.Translation(-(lo+hi)/2)
 transform(objs,xf)

def network_scene():
 reset(True)
 def bodycam():
  mesh('p1_backup_band','black')
  for n,k in [('p1_frame','graphite'),('p1_back','graphite'),('p1_phone','black'),('p1_bar','black'),('p1_lenses','black')]:mesh(n,k,source='cad')
 def relay():
  mesh('p2_base','graphite',source='cad');lid_group();mesh('p2_bank','black',source='cad');bank_straps(2,closed=2)
 def laptop():
  box('laptop base',(0,0,0),(100,65,4),'metal')
  o=box('laptop screen rim',(0,24,35),(100,4,65),'black');o.rotation_euler.x=math.radians(-12)
  o=box('laptop screen',(0,21.6,35),(92,.5,56),'blue');o.rotation_euler.x=math.radians(-12)
  for x in range(-40,41,8):
   for y in (-2,6,14):box('keyboard key',(x,y,2.1),(6,5,.3),'black')
  box('trackpad',(0,-20,2.1),(28,17,.3),'black')
 network_panel(bodycam,(-108,42,0),96,(.5,-1,2.8))
 network_panel(relay,(108,42,0),100,(1,-1.4,2))
 network_panel(laptop,(0,-91,0),105,(.45,-1.8,1.8))
 box('hotspot phone',(0,30,0),(29,59,3),'black')
 box('hotspot screen',(0,30,1.6),(25,53,.2),'blue')
 box('phone speaker',(0,55.5,1.8),(9,1.2,.2),'black')
 # Three Wi-Fi fan symbols link only the central hotspot to each device.
 for cx,cy,angle in [(-34,38,math.pi),(34,38,0),(0,-20,-math.pi/2)]:
  cylinder((cx,cy,1),(cx,cy,2),1.8,'accent')
  for radius in (6,10,14):
   pts=[(cx+radius*math.cos(angle+a),cy+radius*math.sin(angle+a),2) for a in [(-.65+i*1.3/24) for i in range(25)]]
   line(pts,'accent',1.15)
 camera((0,-6,0),(0,0,1),340)
register('b7_network',network_scene,'Bodycam, screen-free relay and laptop connect through the central phone hotspot.')
