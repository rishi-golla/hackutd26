LID_FLIP=Matrix.Translation(Vector((0,78*S,39.4*S)))@Matrix.Rotation(math.pi,4,'X')
def band(points,width=13,thickness=.8,new=False):
 for a,b in zip(points,points[1:]):
  a=Vector(a);b=Vector(b);v=b-a;o=box('Velcro band',(a+b)/2,(width,v.length,thickness),'black',new);o.rotation_euler.x=math.atan2(v.z,v.y)
def bank_straps(count=2,new_index=None,closed=0):
 for i,x in enumerate((36,96)):
  if i>=count:continue
  if i<closed:pts=[(x,0,40),(x,78,40),(x,78,-14.6),(x,0,-14.6),(x,0,40)]
  else:pts=[(x,-18,49),(x,0,37),(x,0,-14.6),(x,78,-14.6),(x,78,37),(x,96,49)]
  band(pts,thickness=1.2,new=i==new_index)
def lid_group(button=True,flip=False,offset=(0,0,0),new=None):
 before=set(bpy.context.scene.objects)
 mesh('p2_lid','graphite',new=='lid',source='cad')
 if button:
  for n,k in [('p2_button_core','metal'),('p2_button_nut','metal'),('p2_button_plug','black')]:mesh(n,k,new=='button')
  mesh('p2_buttonring','accent',False,source='cad')
 objs=[o for o in bpy.context.scene.objects if o not in before]
 transform(objs,Matrix.Translation(Vector(offset)*S)@(LID_FLIP if flip else Matrix.Identity(4)))
 return objs

def relay_base(with_pi=True,with_bread=True,with_bank=False,straps=0,closed=0,new=None,pi_lift=0):
 mesh('p2_base','graphite',new=='base',source='cad');bank_straps(straps,closed=closed)
 if with_pi:pi((8,10,9+pi_lift),new=='pi');shim((8,10,9+pi_lift))
 if with_bread:bread_detail(new=new=='bread')
 if with_bank:mesh('p2_bank','black',new=='bank',source='cad')
def finger_input(new=False,tied=False,thread=False,connected=True,plug_shift=0):
 # Same route points as CAD clearance witness; a 120 mm free length supplies service slack.
 pts=json.loads((ASSETS/'finger_route.json').read_text())
 if plug_shift:
  pts[0][1]-=plug_shift
  pts[1][1]-=min(plug_shift,5)
 tail=[(68,66,31),(77,66,31),(83,70,30),(83,81,30),(83,101,30)]
 if not connected:
  pts=[(20.25,42,24),(20.25,28,24)]+pts[2:]
 for i,k in enumerate(('black','wirered','wireblue','yellow')):
  line([(x+(i-1.5)*.62,y,z) for x,y,z in pts+tail[1:]],k,.27,new)
 plug=(20.25,48-plug_shift,20) if connected else (20.25,44,24)
 box('finger cable keyed plug',plug,(5,4,3),'black',new)
 # Visual key on top; the cable enters the rear face, the tongue meets the SHIM mouth.
 box('plug key',(plug[0],plug[1]+.6,plug[2]+1.55),(2.4,1.2,.15),'black',new)
 if tied or thread:
  pts=[(61,72.6,31),(75,72.6,31),(77,67,35)]
  if tied:pts += [(67,64,35),(65,65,29),(61,72.6,31)]
  line(pts,'black',.6,tied or thread);box('anchor tie head',(61,72.6,31),(3,3,2),'black',tied or thread)

def shim_step(state='move',zoom=False):
 reset();camera((11,47,15) if zoom else (42,29,10),(-1,-1.25,1.8),40 if zoom else 132,zoom)
 pi();off=(2.54 if state=='no' else 0,0,15 if state=='move' else 0);shim(off,True)
 if state=='move':
  arrow((0,44,30),(0,44,11),r=.45 if zoom else .7,head=1.5 if zoom else 2.2)
  for x in (8.77,11.31,13.85):
   for y in (49.98,52.52):dotted((x,y,10.2),(x,y,23.6),dash=.8)
 label('1',(3,45,13),2.7 if zoom else 3)
 dotted((4.5,46,12),(8.77,49.98,10.1),dash=.55)
 if zoom and state=='move':
  label('1',(3+off[0],44,12+off[2]),2.7)
  dotted((4.5+off[0],46,11+off[2]),(8.77+off[0],49.98,10.1+off[2]),dash=.55)
 if state=='ok':burst((7.7,49,11),1.3)
for n,state,z,cap in [('b5_02_shim','move',False,'SHIM aligns above the first six GPIO pins.'),('b5_02_shim_zoom','move',True,'Square SHIM pad aligns with GPIO pin one before downward insertion.'),('b5_02_shim_ok','ok',True,'SHIM is seated on pins one through six with its square pad correctly aligned.'),('b5_02_shim_no','no',True,'SHIM is incorrectly shifted one pin pair along the header.')]:register(n,lambda s=state,z=z:shim_step(s,z),cap)

def cpu_step():
 reset();camera((42,29,12),(-1,-1.25,1.8),132);pi(heatsinks=False);mesh('pi_cpu_sink','black',True,(0,0,22));arrow((29,32,42),(29,32,17),r=.8,head=2.4)
register('b5_01_heatsink_cpu',cpu_step,'Only the processor heatsink lowers onto the processor; other kit sinks remain unused.')

def base_step(action,zoom=False,wrong=False):
 reset();camera((83,38,22),(.7,-1,3.5),235)
 if action in ('strap_one','straps'):
  mesh('p2_base','graphite',source='cad');bank_straps(1 if action=='strap_one' else 2,new_index=0 if action=='strap_one' else 1)
  x=36 if action=='strap_one' else 96;arrow((x,-7,15),(x,3,1),r=.8,head=2.5)
 elif action in ('pi','click','check'):
  lift=(5 if zoom else 36) if action=='pi' else 3 if wrong else 0;relay_base(with_bread=False,new='pi',pi_lift=lift)
  if zoom:camera((69.5,11,11),(-.45,1,1.1),30,True)
  if action=='pi':
   for x,y in ((11.5,13.5),(69.5,13.5),(11.5,62.5),(69.5,62.5)):dotted((x,y,10),(x,y,45),dash=1.5)
   arrow((99,37,49),(99,37,13),r=1.1,head=3)
  elif action=='click':
   for x,y in ((69.5,13.5),(11.5,62.5)):arrow((x,y,27),(x,y,11.4),r=.7,head=2)
  elif not wrong:burst((69.5,10,12),1.5)
 elif action in ('peel','bread'):
  relay_base(with_bread=False)
  if action=='peel':
   before=set(bpy.context.scene.objects);bread_detail()
   pivot=Vector((127.5,28.25,7.75))*S
   transform([o for o in bpy.context.scene.objects if o not in before],Matrix.Translation(Vector((0,0,24))*S+pivot)@Matrix.Rotation(math.pi,4,'X')@Matrix.Translation(-pivot))
   # Peel paper lifts from the now-visible underside; its bent end is separated from the board.
   box('backing attached portion',(127.5,36,36.6),(45,19,.18),'white',True)
   o=box('lifted backing flap',(127.5,18.5,41),(45,19,.18),'white',True);o.rotation_euler.x=math.radians(-28)
   arrow((150,27,40),(150,11,50),r=.8,head=2.5)
  else:
   bread_detail(offset=(0,0,14),new=True);arrow((128,28,35),(128,28,15),r=.8,head=2.5);label('1',(106,28,29),4)
 elif action in ('cable','tie_thread','tie_close'):
  relay_base();finger_input(action=='cable',action=='tie_close',action=='tie_thread',connected=action!='cable')
  camera((76,74,30),(.5,1,2.8),65 if action!='cable' else 190,action!='cable')
  if action=='cable':arrow((87,101,34),(87,76,34),r=.8,head=2.5)
  elif action=='tie_thread':arrow((52,72.6,35),(69,72.6,35),r=.6,head=1.8)
  else:arrow((78,66,36),(69,69,36),r=.5,head=1.5)

for n,a,z,w,c in [
('b5_04_strap_one','strap_one',False,False,'First bank strap crosses the inside floor and passes through its two slots.'),
('b5_04_straps','straps',False,False,'Second bank strap threads through the remaining floor slots.'),
('b5_06_pi','pi',False,False,'Pi lowers onto the four integral locating pegs with USB-C toward its opening.'),
('b5_06_pi_zoom','pi',True,False,'Pi mounting hole fits over its plain locating peg beside a flexible edge catch.'),
('b5_06_pi_click','click',False,False,'Two clear PCB corner lands press down beneath the independent edge clips.'),
('b5_06_pi_ok','check',True,False,'PCB rests on its support pad beneath the retaining clip.'),
('b5_06_pi_no','check',True,True,'Raised PCB has not seated on its support or passed the clip.'),
('b5_07_peel','peel',False,False,'Adhesive backing peels away from the breadboard underside.'),
('b5_07_breadboard','bread',False,False,'Breadboard lowers into its pocket with the marked row-one end nearest the Pi.'),
('b5_08_cable_in','cable',False,False,'Finger-sensor cable enters through the rear FINGER notch.'),
('b5_08_tie_thread','tie_thread',False,False,'Zip tie passes through the horizontal anchor eye beside the cable exit.'),
('b5_08_tie_close','tie_close',False,False,'Closed tie secures the cable jacket beside the FINGER notch.')]:register(n,lambda a=a,z=z,w=w:base_step(a,z,w),c)

def button_step(action,zoom=False):
 reset()
 if action in ('unplug','nut_remove'):
  off=Vector((-128,-61,-39.4));mesh('p2_button_core','metal',False,off);mesh('p2_buttonring','accent',False,off,source='cad')
  mesh('p2_button_nut','metal',action=='nut_remove',off+Vector((0,0,-12 if action=='nut_remove' else 0)))
  mesh('p2_button_plug','black',action=='unplug',off+Vector((28 if action=='nut_remove' else 0,0,-16)))
  camera((5,0,-16),(1,-1.5,-.6),75)
  if action=='unplug':arrow((15,0,-15),(15,0,-33),r=.6,head=1.8)
  else:turn_arrow((0,0,-17),13)
 elif action=='body':
  lid_group(button=False);mesh('p2_button_core','metal',True,(0,0,25));mesh('p2_buttonring','accent',True,(0,0,25),source='cad');camera((110,48,45),(1,-1.4,1.9),150);arrow((144,61,66),(144,61,43),r=.8,head=2.4)
 else:
  lid_group(button=False,flip=True);before=set(bpy.context.scene.objects);mesh('p2_button_core','metal');mesh('p2_buttonring','accent',source='cad');mesh('p2_button_nut','metal',action=='nut')
  if action=='plug':mesh('p2_button_plug','black',True,(0,0,-14))
  transform([o for o in bpy.context.scene.objects if o not in before],LID_FLIP)
  camera((128,17,11),(1,-1.4,1.6),58 if zoom else 145,zoom)
  if action=='nut':turn_arrow((128,17,7),14)
  else:arrow((145,17,38),(145,17,16),r=.7,head=2.1)

for n,a,z,c in [('b5_11_unplug','unplug',False,'Button plug pulls away from the switch body.'),('b5_11_nut_remove','nut_remove',False,'Button’s own panel nut turns off the threaded body.'),('b5_11_button','body',False,'Button enters the lid hole from its labelled outside face.'),('b5_11_nut','nut',False,'Panel nut hand-tightens against the lid underside.'),('b5_11_button_zoom','nut',True,'Button’s supplied nut bears against the lid underside.'),('b5_11_plug','plug',False,'Button plug pushes back onto the switch body below the lid.')]:register(n,lambda a=a,z=z:button_step(a,z),c)

def side_lid(new=None):return lid_group(flip=True,offset=(0,83,3),new=new)
def finger_shim_step(state='move',zoom=False):
 reset();relay_base();camera((82,39,22),(.7,-1,3.5),235)
 finger_input(True,connected=True,plug_shift=6 if state in ('move','no') else 0)
 if zoom:camera((20.25,46,21),(-1,-1.5,1.2),38,True)
 if state=='move':arrow((10,32,22),(10,49,22),r=.8,head=2.5)
 elif state=='ok':burst((20.25,50,22),1.4)
for n,state,z,c in [
 ('b5_12_finger_shim','move',False,'Finger cable routes from the FINGER notch directly to the SHIM socket.'),
 ('b5_12_finger_slack','slack',False,'Connected finger cable follows a loose service loop before the anchor tie is tightened.'),
 ('b5_12_finger_shim_zoom','move',True,'Keyed finger-cable plug aligns with the SHIM socket mouth.'),
 ('b5_12_finger_shim_ok','ok',True,'Finger-cable plug is fully seated in the SHIM socket.'),
 ('b5_12_finger_shim_no','no',True,'Finger-cable plug remains separated from the SHIM socket.')]:register(n,lambda s=state,z=z:finger_shim_step(s,z),c)

def completed_wiring(lid_beside=False):
 cols={'a':42.22,'c':37.14,'e':32.06,'f':24.44,'h':19.36}
 for row in (9,11,13):
  x=107.18+2.54*(row-1);line([(x,32.06,13),(x,31,14.5),(x,25.5,14.5),(x,24.44,13)],'metal',.25,False);cylinder((x,30.8,14.5),(x,25.8,14.5),.85,'white')
 for pin,col,row,key in [(11,'c',3,'white'),(9,'c',5,'black'),(17,'c',7,'wirered'),(15,'h',9,'wirered'),(16,'h',11,'pcb'),(18,'h',13,'wireblue')]:
  x=16.77+2.54*((pin-1)//2);y=59.98+2.54*((pin-1)%2);bx=107.18+2.54*(row-1);by=cols[col]
  box('female GPIO housing',(x,y,21.5),(2.1,2.1,6),'black');line([(x,y,24.5),(x+8,y+4,29),(75,59+(pin%3)*2,30),(bx,by,16)],key,.65,False);box('breadboard jumper housing',(bx,by,15),(2,2,4),'black')
 if lid_beside:
  for i,(row,key) in enumerate([(3,'white'),(5,'black'),(7,'wirered'),(9,'wirered'),(11,'pcb'),(13,'wireblue')]):
   bx=107.18+2.54*(row-1);line([(122+i*2,100,23),(123+i*2,81,27),(bx,58,22),(bx,42.22,16)],key,.65,False)
 else:
  for i,(row,key) in enumerate([(3,'white'),(5,'black'),(7,'wirered'),(9,'pcb'),(11,'wireblue'),(13,'white')]):
   bx=107.18+2.54*(row-1);line([(122+i*2,61,14.4),(122+i*2,58,10),(bx,50,16),(bx,42.22,16)],key,.65,False)

def close_step(action,zoom=False,wrong=False):
 reset();relay_base();finger_input(tied=True);camera((83,38,28),(1,-1.4,1.6),235)
 if action=='open':side_lid();completed_wiring(True);camera((82,79,17),(.6,-1,3),280)
 else:
  completed_wiring();dz=25 if action=='lower' else 5 if wrong else 0;lid_group(offset=(0,0,dz),new='lid')
  if action=='lower':arrow((174,40,67),(174,40,43),r=1,head=3)
  if action=='click':
   for x,y in ((48,6.5),(142,6.5),(48,71.5),(142,71.5)):arrow((x,y,57),(x,y,40.4),r=.7,head=2)
  if zoom:camera((48,2.5,39),(.5,-2,.35),33,True)
  if action=='check' and not wrong:burst((48,3.5,40),1.5)
for n,a,z,w,c in [('b5_test_open','open',False,False,'Pi stays clipped in the base while the connected lid rests beside it.'),('b5_22_close','lower',False,False,'Lid lowers onto its locating lips with cables inside the enclosure.'),('b5_22_click','click',False,False,'Four lid paddles press down beneath their catch bridges.'),('b5_22_close_zoom','click',True,False,'Flexible paddle sits under the base’s square retaining bridge.'),('b5_22_close_ok','check',True,False,'Fully seated lid paddle is captured below its bridge.'),('b5_22_close_no','check',True,True,'Raised lid paddle remains above its retaining bridge and is not latched.')]:register(n,lambda a=a,z=z,w=w:close_step(a,z,w),c)

def bank_step(action):
 reset();mesh('p2_base','graphite',source='cad');pi((8,10,9));shim((8,10,9));bread_detail();lid_group();finger_input(tied=True);camera((83,39,10),(1,-1.5,.7),245)
 bank_drop=-21 if action=='bank' else 0;mesh('p2_bank','black',action=='bank',(0,0,bank_drop),source='cad')
 closed=0 if action=='bank' else 1 if action=='strap_one' else 2
 bank_straps(0 if action=='bank' else 1 if action=='strap_one' else 2,0 if action=='strap_one' else 1 if action=='straps' else None,closed)
 if action=='bank':arrow((82,-13,-34),(82,-13,-13),r=1,head=3)
 elif action in ('strap_one','straps'):x=36 if action=='strap_one' else 96;arrow((x,-14,-17),(x,5,-17),r=.8,head=2.5)
 else:
  camera((37,17,2),(-1,-1.4,.65),170)
  cshift=-8 if action=='usb_c' else -16
  ashift=-12 if action=='usb_a' else 0
  # Generic bank's illustrated USB-A socket is on its left end. Own bank may use USB-C.
  box('bank socket',(4.45,18,-7),(.1,13,5),'marker')
  box('bank plug body',(-5.5+ashift,18,-7),(14,14,7),'black',action=='usb_a')
  box('bank plug metal',(3.5+ashift,18,-7),(4,12,4.5),'metal',action=='usb_a')
  box('straight USB C overmold',(19.2,-3.2+cshift,12.2),(15,24,10),'black',action=='usb_c')
  box('straight USB C nose',(19.2,12.05+cshift,12.2),(8.3,6.5,2.5),'metal',action=='usb_c')
  cylinder((19.2,-15.2+cshift,12.2),(19.2,-23.2+cshift,12.2),2.5,'black',action=='usb_c')
  line([(-12.5+ashift,18,-7),(-32,9,-7),(-28,-25,-2),(5,-42,8),(19.2,-23.2+cshift,12.2)],'black',1.1,True)
  if action=='usb_a':arrow((-23,30,-7),(4,30,-7),r=.7,head=2.2)
  else:arrow((35,-21,12),(35,7,12),r=.7,head=2.2)
for n,a,c in [('b5_23_bank','bank','Unbranded example power bank moves against the enclosure’s flat underside.'),('b5_23_strap_one','strap_one','First strap wraps around the power bank.'),('b5_23_straps','straps','Second strap secures the power bank against the flat base.'),('b5_23_usb_a','usb_a','Example USB-A cable end enters the user-supplied power bank.'),('b5_23_usb_c','usb_c','Straight USB-C plug enters the Pi through the enlarged side opening.')]:register(n,lambda a=a:bank_step(a),c)

def usb_clearance_inset(width,height,wrong=False):
 # Front cross-section inset at the wall plane. Aperture is the exact 18 x 18 profile.
 rot=CAM.rotation_euler.to_matrix();origin=CAM.location
 def point(x,y,z=-30):return (origin+rot@Vector((x*S,y*S,z*S)))/S
 cx,cy=-47,-42;factor=1.05
 tip=rot.transposed()@(Vector((10.2,0,12.2))*S-origin)
 line([point(cx+14,cy+14,-31),point(tip.x/S,tip.y/S,-31)],'marker',.16,False)
 cylinder(point(cx,cy,-30.2),point(cx,cy,-30.0),20,BG,False,96)
 circle=[point(cx+20*math.cos(a),cy+20*math.sin(a),-29.9) for a in [i*2*math.pi/96 for i in range(97)]]
 line(circle,'marker',.2,False)
 # Grey wall section surrounds the white aperture; no geometry in the main view is modified.
 inner=[(-9,0),(9,0),(9,12),(3,18),(-3,18),(-9,12)]
 outer=[(-14,-4),(14,-4),(14,12),(14,22),(-14,22),(-14,12)]
 vs=[tuple(point(cx+x*factor,cy+(y-9)*factor,-29.7)*S) for x,y in inner+outer]
 fs=[(i,(i+1)%6,(i+1)%6+6,i+6) for i in range(6)]
 me=bpy.data.meshes.new('front aperture section');me.from_pydata(vs,[],fs);me.update();ob=bpy.data.objects.new('front aperture section',me);bpy.context.collection.objects.link(ob);assign(ob,'graphite')
 # Plastic cross-section at the actual 12.2 mm port centre, 6.2 mm above aperture floor.
 coords=[(-width/2,6.2-height/2),(width/2,6.2-height/2),(width/2,6.2+height/2),(-width/2,6.2+height/2)]
 vs=[tuple(point(cx+x*factor,cy+(y-9)*factor,-29.5)*S) for x,y in coords]
 me=bpy.data.meshes.new('front plug section');me.from_pydata(vs,[],[(0,1,2,3)]);me.update();ob=bpy.data.objects.new('front plug section',me);bpy.context.collection.objects.link(ob);assign(ob,'wirered' if wrong else 'black',True)

# Early unpowered fit gate: no lid, breadboard, bank, sensor cable or loose wiring.
def usb_dryfit_step(state='move'):
 reset();relay_base(with_bread=False)
 camera((37,17,2),(-1,-1.4,.65),170)
 shift=-8 if state=='move' else -9.05 if state=='no' else 0
 width,height=(22,18) if state=='no' else (15,10)
 key='wirered' if state=='no' else 'black'
 box('dryfit straight USB C overmold',(19.2,-3.2+shift,12.2),(width,24,height),key,True)
 box('dryfit straight USB C nose',(19.2,12.05+shift,12.2),(8.3,6.5,2.5),'metal',True)
 cylinder((19.2,-15.2+shift,12.2),(19.2,-23.2+shift,12.2),2.5,key,True)
 line([(19.2,-23.2+shift,12.2),(19.2,-43,12.2),(5,-49,10),(-20,-43,7)],'black',1.1,True)
 if state=='move':arrow((35,-21,12),(35,7,12),r=.7,head=2.2)
 else:usb_clearance_inset(width,height,state=='no')
for n,state,caption in [
 ('b5_06_usb_dryfit','move','Straight USB-C plug approaches the open relay before breadboard installation and wiring.'),
 ('b5_06_usb_dryfit_ok','ok','Front inset shows clearance around the seated plug; Pi remains clipped in.'),
 ('b5_06_usb_dryfit_no','no','Oversized plug stops at the opening; front inset shows interference with its edge.')]:register(n,lambda state=state:usb_dryfit_step(state),caption)

def pi_software(action):
 reset();pi(heatsinks=False)
 if action=='sd':
  box('microSD card',(-14,26,-1),(12,11,1),'black',True)
  for y in range(22,31,2):box('card contact',(-10,y,-.45),(4,1,.05),'gold',True)
  arrow((-28,26,-5),(-3,26,-5),r=.7,head=2);camera((26,29,-2),(-1,-1.4,-1.2),135)
 else:
  line([(11.2,-45,4),(11.2,-20,4),(11.2,-10,4)],'black',1.4,True);box('USB C plug',(11.2,-8,4),(8,10,4),'black',True);box('supply brick',(11.2,-61,4),(27,20,13),'black',True);arrow((26,-23,7),(26,-2,7),r=.8,head=2.4);camera((34,0,8),(1,-1.4,1.6),170)
register('b3_sd_pi',lambda:pi_software('sd'),'MicroSD card slides into the Pi’s underside socket from its short edge.')
register('b3_power',lambda:pi_software('power'),'USB-C power supply plugs into the bare Pi before software testing.')
