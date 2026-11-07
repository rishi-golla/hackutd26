# Executed by render_manual.py; no printed geometry is modified.
PARTS={'A':'p1_rear_front_frame','B':'p1_rear_back_plate','C':'p2_base','D':'p2_lid','F':'p3_tray','G':'p3_hood','J':'p3_joint_clips','T1':'p1_mount_test','T2':'p1_rear_fit_ring','T3':'coupons/snap_coupon_c020'}

def bounds(objs=None):
 bpy.context.view_layer.update();objs=objs or [o for o in bpy.context.scene.objects if o.type in ('MESH','CURVE','FONT')]
 pts=[o.matrix_world@Vector(c) for o in objs for c in o.bound_box]
 return Vector([min(p[i] for p in pts) for i in range(3)]),Vector([max(p[i] for p in pts) for i in range(3)])
def fit_camera(view=(1,-1.4,1.5),size=(600,600),margin=1.25):
 lo,hi=bounds();target=(lo+hi)/2;camera(target/S,view,100,size=size)
 inv=CAM.rotation_euler.to_matrix().transposed();pts=[inv@(o.matrix_world@Vector(c)-target) for o in bpy.context.scene.objects if o.type in ('MESH','CURVE','FONT') for c in o.bound_box]
 w=max(p.x for p in pts)-min(p.x for p in pts);h=max(p.y for p in pts)-min(p.y for p in pts)
 CAM.data.ortho_scale=max(w,h*size[0]/size[1])*margin

def cylinder(a,b,r,key='metal',new=False,vertices=32):
 a=Vector(a)*S;b=Vector(b)*S;v=b-a
 bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r*S,depth=v.length,location=(a+b)/2);o=bpy.context.object;o.rotation_euler=v.to_track_quat('Z','Y').to_euler();return assign(o,key,new)
def ring(at,outer,inner,depth,key='black',new=False):
 vs=[];fs=[];n=64
 for z in (-depth/2,depth/2):
  for r in (outer,inner):
   vs.extend([(at[0]+r*math.cos(2*math.pi*i/n),at[1]+r*math.sin(2*math.pi*i/n),at[2]+z) for i in range(n)])
 for i in range(n):
  j=(i+1)%n
  fs += [(i,j,2*n+j,2*n+i),(n+j,n+i,3*n+i,3*n+j),(i,n+i,n+j,j),(2*n+j,3*n+j,3*n+i,2*n+i)]
 me=bpy.data.meshes.new('ring');me.from_pydata(vs,[],fs);me.update();o=bpy.data.objects.new('ring',me);bpy.context.collection.objects.link(o);o.scale=(S,S,S);return assign(o,key,new)
def qwire(points,new=False):
 # Four narrow conductors form an identifiable Qwiic ribbon, with keyed plugs.
 for i,k in enumerate(('black','wirered','wireblue','yellow')):line([(x+(i-1.5)*.62,y,z) for x,y,z in points],k,.27,new)
 for p in (points[0],points[-1]):box('Qwiic plug',p,(5,4,3),'black',new)
def jumper(male_both=False,new=False):
 pts=[(-23,0,0),(-13,-8,1),(5,-8,2),(21,0,0)];line(pts,'wireblue',.8,new)
 for x,male in [(-25,True),(23,male_both)]:
  box('jumper housing',(x,0,0),(6,2.5,2.5),'black',new)
  if male:cylinder((x+(-3 if x<0 else 3),0,0),(x+(-6 if x<0 else 6),0,0),.32,'gold',new,12)
  else:box('socket opening',(x+3.03,0,0),(.08,1.2,1.2),'marker',new)
def bread_detail(offset=(0,0,0),new=False):
 mesh('p2_bread','white',new,offset,source='cad')
 for row in range(17):
  for col in [3.28,5.82,8.36,10.90,13.44,21.06,23.60,26.14,28.68,31.22]:
   box('breadboard hole',(107.18+2.54*row+offset[0],11+col+offset[1],12.52+offset[2]),(.7,.7,.06),'marker',new)
def phone(new=False):
 for n,k in [('p1_phone','black'),('p1_bar','black'),('p1_lenses','black')]:mesh(n,k,new,source='cad')
def icon_scene(letter):
 reset(True)
 if letter in PARTS:mesh(PARTS[letter],source='print')
 elif letter=='P':pi(heatsinks=False)
 elif letter=='S':shim()
 elif letter=='M':
  finger_board()
 elif letter=='K':mesh('p2_button','metal',source='cad');mesh('p2_buttonring','accent',source='cad')
 elif letter=='BB':bread_detail()
 elif letter=='HS':mesh('pi_cpu_sink','black')
 elif letter=='Q2':qwire([(-25,0,0),(-16,-12,0),(0,-15,0),(16,-12,0),(25,0,0)])
 elif letter=='PB':mesh('p2_bank','black',source='cad')
 elif letter=='UC':
  line([(-30,0,0),(-20,-15,0),(10,-15,0),(30,0,0)],'black',1.3,False);box('USB A housing',(-35,0,0),(10,7,4),'black');box('USB A shell',(-43,0,0),(6,6,2),'metal');box('straight USB C housing',(36,0,0),(12,9,5),'black');box('USB C shell',(45,0,0),(6,8,2.5),'metal')
 elif letter=='HR':
  mesh('p1_buckle','black',source='cad');box('chest plate',(0,0,-2),(55,50,4),'black')
  for x in (-20,20):box('harness webbing',(x,0,-4),(13,105,1.5),'black')
 elif letter=='PH':phone()
 elif letter=='h4':
  cylinder((-21,0,0),(21,0,0),.35);cylinder((-7,0,0),(7,0,0),2.4,'white')
  for x,k in [(-4,'wirered'),(-1,'wirered'),(2,'black'),(5,'gold')]:cylinder((x-.45,0,0),(x+.45,0,0),2.45,k)
 elif letter in ('h5','h9'):jumper(letter=='h9')
 elif letter=='RB':
  band=ring((0,0,0),30,27.6,1,'black');band.name='plain thin rubber band';band.scale.x*=1.25;band.scale.y*=.7
 elif letter=='h6':box('Velcro strip',(0,0,0),(70,13,1),'black');box('folded end',(28,0,1),(14,13,1),'black')
 elif letter=='h7':
  box('zip tie tail',(0,0,0),(65,2.5,.8),'black');box('locking head',(-32,0,1),(5,5,3),'black')
 elif letter=='h8':ring((0,0,0),18,11,13);ring((0,0,0),11,9.8,13,'white')
 fit_camera()

for letter in list(PARTS)+['P','S','M','K','BB','HS','Q2','PB','UC','HR','PH','RB','h4','h5','h6','h7','h8','h9']:
 caption={'RB':'Plain thin rubber band shown as a single unbranded loop.','HS':'One processor heatsink; other kit pieces are not installed.','PB':'Plain unbranded example power bank; actual dimensions depend on the builder’s bank.','UC':'Generic cable with a straight USB-C plug and an example USB-A bank end.','h6':'Plain black hook-and-loop strap, up to thirteen millimetres wide.','J':'Two removable spring clips for the finger tray and cradle.'}.get(letter,f'Individual part {letter}, centred with its real shape and colour.')
 register('icon_'+letter,lambda a=letter:icon_scene(a),caption)

def parts_sheet():
 reset(True);anchors={};letters=list(PARTS)
 for i,letter in enumerate(letters):
  ob=mesh(PARTS[letter],source='print');ob.rotation_euler=(math.radians(48),0,math.radians(-24));lo,hi=bounds([ob]);ext=hi-lo;factor=min(26*S/ext.x,36*S/ext.y);ob.scale*=factor;lo,hi=bounds([ob]);cx=-64+32*(i%5);cy=29-55*(i//5);ob.location+=Vector((cx*S,cy*S,0))-(lo+hi)/2
  anchors[letter]={'x':round((cx/160+.5)*1600),'y':round((.5-cy/120)*1200+210)}
 camera((0,0,0),(0,0,1),160)
 (OUT/'parts_printed.json').write_text(json.dumps({'width':1600,'height':1200,'anchors':anchors},indent=2)+'\n')
register('parts_printed',parts_sheet,'Printed shells, bases, lids, cradle, clips and test coupons in separate labelled positions.')

def bed_scene(name):
 reset(True);mesh(name,source='print');lo,hi=bounds();center=(lo+hi)/2;size=hi-lo
 box('print bed',(center.x/S,center.y/S,-2),(max(size.x/S+20,45),max(size.y/S+20,45),3),'blue')
 fit_camera(size=(1600,1200),margin=1.20)
BEDS={'T1':'p1_mount_test','T2r':'p1_rear_fit_ring','T2f':'p1_front_fit_ring','A_rear':'p1_rear_front_frame','A_front':'p1_front_front_frame','B':'p1_rear_back_plate','C':'p2_base','D':'p2_lid','F':'p3_tray','G':'p3_hood','J':'p3_joint_clips','coupon':'coupons/snap_coupon_c020'}
for name,stl in BEDS.items():register('b2_bed_'+name,lambda a=stl:bed_scene(a),'Part rests on the print bed in its supplied support-free orientation.')
