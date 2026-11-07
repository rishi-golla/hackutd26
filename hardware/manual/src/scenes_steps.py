# Step builders use unchanged CAD print meshes, with only reference parts and arrows added.
def transform(objs,matrix):
 bpy.context.view_layer.update()
 for o in objs:o.matrix_world=matrix@o.matrix_world

def burst(at,r=3):
 p=Vector(at)
 for v in [(1,0,0),(-1,0,0),(0,0,1),(0,1,.6)]:
  v=Vector(v).normalized();line([p+v*r,p+v*r*1.6],r=.3)
def turn_arrow(center,r=9,axis='z'):
 pts=[]
 for a in range(20,301,10):
  u=r*math.cos(math.radians(a));v=r*math.sin(math.radians(a))
  pts.append((center[0],center[1]+u,center[2]+v) if axis=='x' else (center[0]+u,center[1]+(v if axis=='z' else 0),center[2]+(0 if axis=='z' else v)))
 arc=line(pts,r=.6);arc['motion_arc']=True;h=arrow(pts[-3],pts[-1],r=.6,head=2,kind='turn_head');h['arc_object']=arc.name
def transparent(o,alpha=.5):
 m=o.data.materials[0].copy();m.name='translucent reference';n=m.node_tree.nodes;out=next(x for x in n if x.type=='OUTPUT_MATERIAL');old=out.inputs['Surface'].links[0].from_socket;mix=n.new('ShaderNodeMixShader');tr=n.new('ShaderNodeBsdfTransparent');mix.inputs[0].default_value=alpha;m.node_tree.links.new(tr.outputs[0],mix.inputs[1]);m.node_tree.links.new(old,mix.inputs[2]);m.node_tree.links.new(mix.outputs[0],out.inputs[0]);o.data.materials[0]=m

def finger_reference(offset=(0,0,0)):
 ys=[-28,19,20.15,32];vs=[];fs=[];n=64
 for y in ys:
  floor=6.5 if y<=19 else 5.35 if y>=20.15 else 6.5-(y-19)
  for i in range(n):
   a=2*math.pi*i/n;vs.append((12.7+10*math.cos(a),y,floor+7.5+7.5*math.sin(a)))
 for j in range(len(ys)-1):
  for i in range(n):k=(i+1)%n;fs.append((j*n+i,j*n+k,(j+1)*n+k,(j+1)*n+i))
 fs.extend([tuple(reversed(range(n))),tuple(range((len(ys)-1)*n,len(ys)*n))]);me=bpy.data.meshes.new('reference finger');me.from_pydata(vs,[],fs);me.update();o=bpy.data.objects.new('reference finger',me);bpy.context.collection.objects.link(o);o.scale=(S,S,S);o.location=Vector(offset)*S;assign(o,'skin');transparent(o,.5);return o

def pressure_strap(new=False,wrong=False):
 if wrong:
  pts=[(-11.25,-.6),(-11.25,26.5),(36.65,26.5),(36.65,-.6)]
  ys=[16.1,29.1]
 else:ys=[16.1,19,20.15,29.1]
 vs=[];n=0
 for y in ys:
  floor=6.5 if y<=19 else 5.35 if y>=20.15 else 6.5-(y-19)
  if not wrong:pts=[(-11.25,-.6),(-11.25,7.9),(2.1,7.9)]+[(12.7+10.6*math.cos(math.radians(a)),floor+7.5+8.1*math.sin(math.radians(a))) for a in range(180,-1,-5)]+[(23.3,7.9),(36.65,7.9),(36.65,-.6)]
  n=len(pts)
  for side in (-1,1):
   for i,(x,z) in enumerate(pts):
    prev=Vector(pts[i-1]);p=Vector((x,z));nxt=Vector(pts[(i+1)%n]);u=(p-prev).normalized();v=(nxt-p).normalized();nu=Vector((-u.y,u.x));nv=Vector((-v.y,v.x));normal=(nu+nv).normalized();scale=.6/max(.45,normal.dot(nu));q=p+normal*scale*side;vs.append((q.x,y,q.y))
 fs=[]
 for j in range(len(ys)-1):
  for side in range(2):
   for i in range(n):a=j*2*n+side*n+i;b=j*2*n+side*n+(i+1)%n;c=(j+1)*2*n+side*n+(i+1)%n;d=(j+1)*2*n+side*n+i;fs.append((a,b,c,d) if side else (d,c,b,a))
 for j in (0,len(ys)-1):
  for i in range(n):fs.append((j*2*n+i,j*2*n+(i+1)%n,j*2*n+n+(i+1)%n,j*2*n+n+i))
 me=bpy.data.meshes.new('webbing');me.from_pydata(vs,[],fs);me.update();o=bpy.data.objects.new('pressure strap',me);bpy.context.collection.objects.link(o);o.scale=(S,S,S);assign(o,'black',new)

def finger_board(new=False,lift=0):
 mesh('p3_board_pcb','sensor',new,(0,0,lift));mesh('p3_components','black',new,(0,0,lift));mesh('p3_connectors','black',new,(0,0,lift),source='cad')

def finger_parts(board=True,hood=True,clips=2,new=None,board_lift=0,hood_lift=0):
 mesh('p3_tray','graphite',new=='tray',source='cad')
 if board:
  finger_board(new=='board',board_lift)
 if hood:mesh('p3_hood','graphite',new=='hood',(0,0,hood_lift),source='cad')
def finger_cable(new=False,plugged=True,lift=0):
 end=(-1,12.7,5.8+lift) if plugged else (-10,12.7,5.8+lift)
 qwire([end,(-14,12.7,5.8+lift),(-26,1,3),(-31,-9,1.5)],new)
def finger_tie(new=False,thread=False):
 pts=[(-2.7,8,2.3),(-2.7,8,-1),(-9,8,-1),(-9,12.7,7.5),(-2.7,14,7.5),(-2.7,14,2.3)]
 if thread:pts=pts[:3]+[(-16,8,-1)]
 line(pts,'black',.65,new);box('tie lock',(-2.7,8,2.3),(2.7,2.7,2),'black',new)
def finger_scene(action,zoom=False,wrong=False):
 reset();camera((10,12,10),(-1,-1.8,1.6),112)
 if zoom:camera((7,37,3) if action=='rear' else (7,-10,3),(-1,1.7,1.8) if action=='rear' else (-1,-1.7,1.8),38,True)
 if action=='cable':
  finger_board()
  finger_cable(True,False);arrow((-15,12.7,9),(-3,12.7,9),r=.5,head=1.5)
 elif action=='board':finger_parts(hood=False,clips=0,new='board',board_lift=16);finger_cable(False,True,16);arrow((12.7,3,22),(12.7,3,4),r=.6,head=2)
 elif action=='cradle':finger_parts(clips=0,new='hood',hood_lift=23);finger_cable();arrow((-12,10,29),(-12,10,9),r=.6,head=2)
 elif action in ('front','rear','check'):
  finger_parts(clips=0);finger_cable()
  for n in ('front','rear'):
   active=n==action or action=='check';offset=(-12,0,0) if n==action and not zoom else (0,0,0)
   if action=='front' and n=='rear':continue
   if action=='check' and wrong:offset=(-5,0,0)
   o=mesh('p3_clip_'+n,'graphite',active,offset)
   if action=='check' and wrong:
    for v in o.data.vertices:
     if v.co.z>4.1:v.co.z+=max(0,min(1,(v.co.x+4.05)/18.6))**2*1.1
  if action in ('front','rear'):
   y=(-10.5 if zoom else -28) if action=='front' else (37.9 if zoom else 54);arrow((-21,y,5),(-6,y,5),r=.6,head=1.8)
   if zoom:burst((15,y,4.2),1.5)
  else:
   camera((8,-10,3),(-1,-1.7,1.8),39,True)
   if not wrong:burst((15,-10.5,4.2),1.5)
 elif action=='tape':
  finger_parts();finger_cable();camera((12.7,22.6,6),(-1,-1.5,2.3),48)
  if wrong:box('covered window',(12.7,22.6,5.55),(8,5.7,.25),'black',True)
  else:
   for at,sz in [((8.95,22.6,5.5),(1.5,6,.2)),((16.45,22.6,5.5),(1.5,6,.2)),((12.7,19.85,5.5),(6,1.5,.2)),((12.7,25.35,5.5),(6,1.5,.2))]:box('tape frame',at,sz,'black',True)
 elif action in ('thread','tie'):
  finger_parts();finger_cable();finger_tie(True,action=='thread');camera((-4,12,4),(-1,-1.4,1.8),62)
  if action=='thread':arrow((-7,5,13),(-3,10,1),r=.45,head=1.4)
  else:arrow((-15,8,4),(-7,8,4),r=.45,head=1.4)
 elif action in ('strap','finger','strapped'):
  finger_parts();finger_cable();finger_tie()
  if action=='strap':
   # Loose band enters the two low slots before the finger is inserted.
   box('strap straight',(12.7,22.6,7.9),(57,13,1.2),'black',True);arrow((-24,22.6,10),(-5,22.6,10),r=.65,head=2)
  else:
   finger_reference((0,-16,0) if action=='finger' else (0,0,0));pressure_strap(action=='strapped',wrong)
   if action=='finger':arrow((12.7,-32,22),(12.7,-10,22),r=.8,head=2.5)

 if action in ('tape','thread','tie','strap','finger','strapped'):mesh('p3_joint_glue','gold')

for n,a,z,w,c in [
('b4_02_cable','cable',False,False,'Long Qwiic cable approaches the sensor board’s left socket.'),
('b4_03_board','board',False,False,'Sensor board lowers onto the tray seats with its sensor toward the fingertip stop.'),
('b4_04_cradle','cradle',False,False,'Cradle lowers over the sensor board and tray.'),
('b4_04_clip_front','front',False,False,'Front J clip slides over the paired tray and cradle flanges.'),
('b4_04_clip_rear','rear',False,False,'Rear J clip slides into the pocket below the closed fingertip stop.'),
('b4_04_clip_zoom','front',True,False,'Front clip’s hook drops into the flange notch.'),
('b4_04_clip_rear_zoom','rear',True,False,'Rear clip enters its notch behind the intact fingertip light wall.'),
('b4_04_clip_ok','check',True,False,'Clip is fully inserted with its hook seated in the notch.'),
('b4_04_clip_no','check',True,True,'Partly inserted clip has its spring hook riding above the flange.'),
('b4_05_tape_ok','tape',False,False,'Black tape surrounds the sensor opening while leaving the optical window uncovered.'),
('b4_05_tape_no','tape',False,True,'Tape incorrectly covers the optical window.'),
('b4_07_thread','thread',False,False,'Zip tie threads through the small tray slot beside the cable.'),
('b4_07_ziptie','tie',False,False,'Closed zip tie holds the cable jacket beside its plug.'),
('b4_06_strap','strap',False,False,'Black strap threads through the two low cradle-wall slots.'),
('b4_06_finger','finger',False,False,'Finger slides beneath the visor and strap toward the sensor.'),
('b4_06_strap_ok','strapped',False,False,'Strap presses directly over the finger beneath the visor.'),
('b4_06_strap_no','strapped',False,True,'Strap incorrectly wraps over the rigid visor instead of pressing the finger.')]:register(n,lambda a=a,z=z,w=w:finger_scene(a,z,w),c)

exec((ROOT/'scenes_p1.py').read_text(),globals()) if (ROOT/'scenes_p1.py').exists() else None
exec((ROOT/'scenes_p2.py').read_text(),globals()) if (ROOT/'scenes_p2.py').exists() else None
exec((ROOT/'scenes_release.py').read_text(),globals()) if (ROOT/'scenes_release.py').exists() else None
