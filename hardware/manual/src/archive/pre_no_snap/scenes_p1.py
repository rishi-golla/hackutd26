P1_FLIP=Matrix.Translation(Vector((0,0,10.7*S)))@Matrix.Rotation(math.pi,4,'X')
def p1p(p):return (p[0],-p[1],10.7-p[2])
def case_parts(with_phone=True,plate=True,new=None,plate_x=0,phone_drop=0,front=False):
 before=set(bpy.context.scene.objects)
 mesh('p1front_frame' if front else 'p1_frame','graphite',new=='frame',source='cad')
 if with_phone:
  for n,k in ([('p1front_phone','black')] if front else [('p1_phone','black'),('p1_bar','black'),('p1_lenses','black')]):mesh(n,k,new=='phone',(0,0,-phone_drop),source='cad')
 if plate:mesh('p1front_back' if front else 'p1_back','graphite',new=='plate',(plate_x,0,0),source='cad')
 objs=[o for o in bpy.context.scene.objects if o not in before];transform(objs,P1_FLIP);return objs

def p1_scene(action,zoom=False,wrong=False,front=False):
 reset();camera((60,0,13),(1,-1.55,1.7),390)
 if action=='shell':case_parts(False,False,'frame',front=front)
 elif action=='phone':case_parts(True,False,'phone',phone_drop=24,front=front);arrow((-94,0,42),(-94,0,15),r=1.3,head=4)
 elif action in ('align','slide','check'):
  dx=139 if action=='align' else 25 if action=='slide' or wrong else 0
  case_parts(True,True,'plate',plate_x=dx,front=front)
  if action!='check':arrow((95,-64,15),(55,-64,15),r=1.1,head=3.8)
  if zoom:
   camera((70,-45,11.5),(1,-1.4,1.6),65,True)
   if action=='check':camera((57,-47,11.5),(1,-1.2,2.2),65,True)
  if action=='check' and not wrong:burst((47,-50,12),2)
 elif action in ('buckle','thumb'):
  case_parts(front=front);band=mesh('p1_front_backup_band' if front else 'p1_backup_band','black');transform([band],P1_FLIP);o=mesh('p1_buckle','black',action=='buckle',(0,0,-29.2-(3.6 if front else 0)-(20 if action=='buckle' and not zoom else 0)),source='cad');transform([o],P1_FLIP)
  camera((0,0,28),(1,-1.4,1.0),245 if not zoom else 60,zoom)
  if action=='buckle':arrow((18,0,53),(18,0,32),r=.9,head=2.8)
  else:
   cylinder((-33,0,24.9),(-8,0,24.9),2.45,'metal',True);box('thumb handle',(-35,0,24.9),(4,13,8),'black',True);arrow((-28,-12,24.9),(-3,-12,24.9),r=.8,head=2.5)
 elif action in ('tilt','tighten','final'):
  # Upright landscape phone, outward normal down fifteen degrees relative to vertical chest.
  before=set(bpy.context.scene.objects)
  for n,k in [('p1_frame','graphite'),('p1_back','graphite'),('p1_phone','black'),('p1_bar','black'),('p1_lenses','black')]:mesh(n,k,action=='final' and n=='p1_back',source='cad')
  mesh('p1_backup_band','black')
  upright=Matrix.Rotation(math.pi/2,4,'X');pivot=Vector((0,0,-14.2*S));tilt=Matrix.Translation(pivot)@Matrix.Rotation(math.radians(15),4,'X')@Matrix.Translation(-pivot)
  transform([o for o in bpy.context.scene.objects if o not in before],upright@tilt)
  o=mesh('p1_buckle','black',False,(0,0,-29.2),source='cad');transform([o],upright)
  cylinder((-12,14.2,0),(15,14.2,0),2.45,'metal',action=='tighten');box('thumb handle',(-15,14.2,0),(4,13,8),'black',action=='tighten')
  box('chest plane',(0,33.2,0),(210,6,150),'white')
  camera((0,8,0),(1,-2,.7),250)
  if action=='tilt':camera((0,10,-2),(1,-.25,.2),225);turn_arrow((9,-20,0),23,'x')
  elif action=='tighten':
   camera((-10,14,0),(-1,0,.2),85);turn_arrow((-21,14.2,0),9,'x')
  else:arrow((15,-18,0),(15,-42,-5),r=1.3,head=4)

for n,a,z,w,c in [
('b6_01_shell','shell',False,False,'Outer shell rests outward-face down with its phone cavity open.'),
('b6_04_phone','phone',False,False,'Bare phone lowers camera-first into the rear-camera shell.'),
('b6_05_align','align',False,False,'Chest plate aligns with the open ends of the horizontal capture rails.'),
('b6_05_align_zoom','align',True,False,'Bevelled chest-plate tongue aligns with the capture-rail mouth.'),
('b6_05_plate','slide',False,False,'Chest plate slides along both long rails toward the end stop.'),
('b6_05_plate_zoom','slide',True,False,'Chest plate approaches the two squeeze-latch shoulders.'),
('b6_05_plate_ok','check',True,False,'Fully seated chest plate has its latch hook behind the retaining shoulder.'),
('b6_05_plate_no','check',True,True,'Partly inserted chest plate has not reached the latch shoulder.'),
('b6_06_buckle','buckle',False,False,'Harness buckle approaches the case’s two mount fingers.'),
('b6_06_buckle_zoom','buckle',True,False,'Two case fingers interleave with the buckle’s three fingers.'),
('b6_06_thumb','thumb',False,False,'Harness thumbscrew enters the aligned mount holes.'),
('b6_07_tilt','tilt',False,False,'Upright landscape case tilts downward on the chest buckle.'),
('b6_07_tighten','tighten',False,False,'Curved arrow shows hand-tightening the harness thumbscrew.'),
('b6_11_final','final',False,False,'Closed case remains captured while a gentle outward pull checks the mount.')]:register(n,lambda a=a,z=z,w=w:p1_scene(a,z,w),c)

def measurement_scene():
 reset(True);phone();before=list(o for o in bpy.context.scene.objects if o.type=='MESH');transform(before,Matrix.Rotation(math.pi/2,4,'Z'))
 # Bar now across phone width at its upper end. Side profile is separate at right.
 arrow((-30.5,72,17),(30.5,72,17),r=.55,head=2,kind='dimension');arrow((30.5,72,17),(-30.5,72,17),r=.55,head=2,kind='dimension')
 arrow((38,47.9,16),(38,66.9,16),r=.45,head=1.6,kind='dimension');arrow((38,66.9,16),(38,47.9,16),r=.45,head=1.6,kind='dimension')
 arrow((-38,66.9,15),(-38,76.4,15),r=.4,head=1.4,kind='dimension');arrow((-38,76.4,15),(-38,66.9,15),r=.4,head=1.4,kind='dimension')
 box('phone side profile',(69,0,4.25),(8.5,152.8,8.5),'black');box('bar side projection',(75.05,57.4,4.25),(3.6,19,8.5),'black')
 arrow((73.25,42,15),(76.85,42,15),r=.35,head=.8,kind='dimension');arrow((76.85,42,15),(73.25,42,15),r=.35,head=.8,kind='dimension')
 camera((15,0,0),(0,-.25,1),240)
register('b2_measure',measurement_scene,'Camera-bar width, height, top offset and side-profile protrusion are marked by dimension arrows.')

def mount_test_scene(state):
 reset();mesh('p1_mount_test','graphite',False,source='print')
 # Test plate 2 + GoPro foot 2.4 gives hinge height fourteen above bed.
 o=mesh('p1_buckle','black',True,(0,0,29+(18 if state=='move' else 3 if state=='no' else 0)),source='cad')
 o.rotation_euler.x=math.pi
 if state=='no':o.rotation_euler.y=math.radians(12)
 if state=='move':arrow((20,0,35),(20,0,17),r=.7,head=2)
 elif state=='ok':cylinder((-13,0,14),(13,0,14),2.45,'metal');burst((0,-9,14),2)
 camera((0,0,20),(1,-1.4,.8),90)
for s in ('move','ok','no'):register('b2_t1_test'+('' if s=='move' else '_'+s),lambda s=s:mount_test_scene(s),'Mount gauge and buckle demonstrate '+{'move':'finger alignment and insertion.','ok':'straight seating with aligned holes.','no':'incorrect tilted seating and a visible gap.'}[s])

def fit_ring_scene():
 reset();phone();o=mesh('p1_rear_fit_ring','graphite',True,(0,0,24),source='print');arrow((-34,0,36),(-34,0,11),r=1,head=3);fit_camera(size=(1600,1200))
register('b2_t2_test',fit_ring_scene,'Rear fit gauge lowers against the phone back with its aperture around the camera bar.')

def coupon_scene(zoom=False):
 reset();camera((49,31,5),(1,-1.5,2.6),160)
 if zoom:
  mesh('coupon_j_receiver','graphite');mesh('coupon_j_key','graphite',True,(-2.7,2.5,0))
  camera((12,2.5,2),(1,-1.8,1.2),45,True)
  arrow((20,2.5,6),(20,2.5,13),r=.45,head=1.4)
  burst((18.8,2.5,4.2),1.1)
 else:
  # Separate projected panels keep each coupon pair visually independent.
  view_rotation=CAM.rotation_euler.to_matrix().transposed().to_4x4()
  for kind,cell in [('p1',(-52,40)),('p2',(52,40)),('pi',(-52,-40)),('j',(52,-40))]:
   before=set(bpy.context.scene.objects)
   mesh('coupon_'+kind+'_receiver','graphite')
   if kind=='p1':
    mesh('coupon_p1_key','graphite',True,(12,1.5,5.5));arrow((30,-5,8),(8,-5,8),r=.65,head=2)
   elif kind=='p2':
    o=mesh('coupon_p2_key','graphite',True)
    transform([o],Matrix.Translation(Vector((-23,10,12.4))*S)@Matrix.Rotation(math.pi,4,'X'))
    arrow((20,4,20),(20,4,5),r=.65,head=2)
   elif kind=='pi':
    mesh('coupon_pi_key','graphite',True,(0,3,15));arrow((15,4,24),(15,4,10),r=.5,head=1.5)
   else:
    mesh('coupon_j_key','graphite',True,(-27,2.5,0));arrow((-23,-6,4),(-2,-6,4),r=.65,head=2)
   objs=[o for o in bpy.context.scene.objects if o not in before]
   transform(objs,view_rotation);lo,hi=bounds(objs);scale=min(88*S/(hi.x-lo.x),62*S/(hi.y-lo.y))
   transform(objs,Matrix.Translation(Vector((cell[0],cell[1],0))*S)@Matrix.Scale(scale,4)@Matrix.Translation(-(lo+hi)/2))
  camera((0,0,0),(0,0,1),224)
register('coupon_test',lambda:coupon_scene(False),'Four separate coupon joints show their actual slide-in or press-down mating directions.')
register('coupon_test_zoom',lambda:coupon_scene(True),'Seated spring hook occupies its notch; upward arrow shows the free-tip release direction.')

FRONT_ALIASES={
 'b2_t2_test_front':'b2_t2_test',
 'b6_01_shell_front':'b6_01_shell','b6_04_phone_front':'b6_04_phone',
 'b6_05_align_front':'b6_05_align','b6_05_align_front_zoom':'b6_05_align_zoom',
 'b6_05_plate_front':'b6_05_plate','b6_05_plate_front_zoom':'b6_05_plate_zoom',
 'b6_05_plate_front_ok':'b6_05_plate_ok','b6_05_plate_front_no':'b6_05_plate_no',
 'b6_06_buckle_front':'b6_06_buckle','b6_06_buckle_front_zoom':'b6_06_buckle_zoom',
}
def front_fit_ring_scene():
 reset();mesh('p1_front_fit_ring','graphite',False,source='print')
 for n in ('p1_phone','p1_bar','p1_lenses'):mesh(n,'black',True,(0,0,20),source='cad')
 arrow((-90,0,37),(-90,0,9),r=1,head=3);fit_camera(size=(1600,1200))
register('b2_t2_test_front',front_fit_ring_scene,'Phone lowers screen-down onto the front-mode fit ring.')
for n,a,z,w,c in [
 ('b6_01_shell_front','shell',False,False,'Front-camera shell rests outward-face down with its large screen opening against the bed.'),
 ('b6_04_phone_front','phone',False,False,'Phone lowers screen-down into the front-camera shell; rear camera bar faces upward.'),
 ('b6_05_align_front','align',False,False,'Front-mode chest plate aligns with the long capture rails.'),
 ('b6_05_align_front_zoom','align',True,False,'Front-mode chest-plate tongue aligns with its capture-rail mouth.'),
 ('b6_05_plate_front','slide',False,False,'Front-mode chest plate slides along both rails toward the end stop.'),
 ('b6_05_plate_front_zoom','slide',True,False,'Deeper front-mode chest plate approaches the squeeze-latch shoulders.'),
 ('b6_05_plate_front_ok','check',True,False,'Front-mode plate is fully seated with its hook captured behind the shoulder.'),
 ('b6_05_plate_front_no','check',True,True,'Front-mode plate remains partly inserted and its latch is not captured.'),
 ('b6_06_buckle_front','buckle',False,False,'Harness buckle approaches the front-mode chest plate’s two mount fingers.'),
 ('b6_06_buckle_front_zoom','buckle',True,False,'Front-mode case fingers interleave with the buckle’s three fingers.')]:register(n,lambda a=a,z=z,w=w:p1_scene(a,z,w,True),c)
