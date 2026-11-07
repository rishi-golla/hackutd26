"""Stylised training scenario. Anatomical models, furniture and kit are conceptual."""

def bodycam_on_medic():
 before=set(bpy.context.scene.objects)
 for n,k in [('p1_frame','graphite'),('p1_back','graphite'),('p1_phone','black'),('p1_bar','black'),('p1_lenses','marker')]:mesh(n,k,source='cad')
 mesh('p1_backup_band','black')
 mesh('p1_buckle','black',offset=(0,0,-29.2),source='cad')
 # Landscape phone: long axis follows the medic's shoulder line, normal toward patient.
 x=Vector((.3,.95,0)).normalized();z=Vector((.95,-.3,-.20)).normalized();y=z.cross(x).normalized();z=x.cross(y).normalized()
 xf=Matrix((x,y,z)).transposed().to_4x4();xf.translation=Vector((-190,315,615))*S
 transform(objects_since(before),xf)
 # Visible webbing encircles the stylised chest and joins the buckle.
 smooth([(-319,158,770),(-227,165,680),(-193,230,620),(-193,400,620),(-228,466,680),(-319,472,770)],'black',10)
 smooth([(-193,300,615),(-205,300,560),(-380,300,440),(-560,300,410)],'black',10)

def manikin():
 # Full-size training mannequin, flat on the mat, not a patient anatomical model.
 limb('training mannequin torso',(0,40,110),(0,410,160),154,'training')
 ellipsoid('training mannequin shoulders',(0,412,150),(209,110,105),'training')
 ellipsoid('training mannequin pelvis',(0,-50,105),(153,120,90),'training')
 limb('manikin neck',(0,480,135),(0,559,140),53,'training')
 ellipsoid('training mannequin head',(0,640,145),(88,112,89),'training')
 ellipsoid('training nose',(0,660,228),(14,26,12),'training')
 # Simple neutral face details identify the upward-facing head.
 for xx in (-30,30):smooth([(xx-12,678,226),(xx,680,230),(xx+12,678,226)],'bda087',1.8)
 smooth([(-22,611,227),(0,607,230),(22,611,227)],'bda087',1.8)
 for side in (-1,1):
  limb('upper training arm',(side*195,383,120),(side*245,151,77),52,'training')
  limb('lower training arm',(side*245,151,77),(side*246,-75,66),42,'training')
  ellipsoid('training hand',(side*246,-127,65),(42,67,22),'training')
  limb('training thigh',(side*84,-102,101),(side*103,-361,69),70,'training')
  limb('training calf',(side*103,-364,69),(side*105,-636,47),49,'training')
  ellipsoid('training foot',(side*105,-704,46),(53,106,36),'training')
 # Chest insert visually distinguishes a CPR manikin from a live patient.
 o=box('CPR chest insert',(0,325,295),(185,155,6),'eee1d2',18)

def medic():
 # Knees are on the mat; upper body leans over overlapping hands on the manikin.
 for yy in (100,520):
  limb('medic lower leg',(-435,yy,55),(-690,yy+18,57),62,'pants')
  ellipsoid('medic shoe',(-752,yy+20,55),(86,49,39),'black')
  ellipsoid('medic knee',(-425,yy,72),(65,67,61),'pants')
  limb('medic thigh',(-425,yy,105),(-505,315+(yy-310)*.42,335),78,'pants')
 ellipsoid('medic pelvis',(-500,315,347),(115,146,103),'pants')
 torso=limb('medic jacket',(-480,315,405),(-277,315,704),131,'uniform');torso.scale.y*=1.3
 # Shoulder direction is across Y, and both elbows stay above the chest.
 for yy,ey,hy in [(156,236,302),(474,390,319)]:
  shoulder=(-270,yy,717);elbow=(-110,ey,500);wrist=(-8,hy,330 if hy==302 else 350)
  limb('medic upper sleeve',shoulder,elbow,53,'uniform')
  limb('medic forearm',elbow,wrist,40,'skin')
  ellipsoid('medic hand',(-1,hy,310 if hy==302 else 330),(52,37,14),'skin')
 # Simple mannequin head tipped toward the hands.
 limb('medic neck',(-252,315,755),(-213,315,812),41,'skin')
 head=ellipsoid('medic head',(-182,315,866),(82,87,106),'skin');head.rotation_euler.y=math.radians(32)
 ellipsoid('medic nose',(-105,315,836),(16,22,22),'skin')
 bodycam_on_medic()

def volunteer_and_clip():
 # The seated volunteer faces away from the hardware so neither knees nor stool obscure it.
 box('volunteer stool seat',(905,310,375),(290,280,45),'graphite',24)
 for xx in (799,1011):
  for yy in (212,408):limb('stool leg',(xx,yy,355),(xx+12,yy+8,20),14,'metal')
 ellipsoid('volunteer hips',(900,310,451),(125,120,88),'pants')
 limb('seated torso',(900,310,500),(837,281,770),124,'volunteer')
 for yy in (224,398):
  limb('volunteer thigh',(949,yy,438),(1130,yy-15,330),66,'pants')
  limb('volunteer shin',(1130,yy-15,330),(1144,yy-22,70),47,'pants')
  ellipsoid('volunteer shoe',(1192,yy-40,43),(91,46,36),'black')
 limb('volunteer neck',(837,281,812),(823,275,852),36,'skin')
 ellipsoid('volunteer head',(813,270,924),(75,80,97),'skin')
 # Near arm reaches toward the sensor; the hand is palm-down and index points toward the relay.
 limb('volunteer sleeve',(795,158,732),(850,30,400),47,'volunteer')
 limb('volunteer reaching forearm',(850,30,400),(601,-115,112),37,'skin')
 hand_before=set(bpy.context.scene.objects)
 ellipsoid('volunteer palm',(554,65,104),(48,36,16),'skin')
 for yy,xx in ((82,478),(63,474),(45,482),(28,492)):
  limb('volunteer finger',(525,yy,103.5),(xx,yy,103.5),8.1,'skin')
 limb('volunteer thumb',(560,28,104),(531,9,103),10,'skin')
 place(objects_since(hand_before),(0,-180,0))
 limb('resting sleeve',(855,420,752),(946,451,538),48,'volunteer')
 limb('resting forearm',(946,451,538),(1090,422,369),36,'skin')
 ellipsoid('resting hand',(1109,418,359),(47,31,16),'skin')
 before=set(bpy.context.scene.objects)
 lib['finger_parts']();mesh('p3_joint_glue','gold');mesh('p3_strap','black',source='cad');lib['finger_tie']()
 box('finger cable connector',(-1,12.7,5.8),(5,4,3),'black')
 xf=Matrix.Translation(Vector((493,-98,90))*S)@Matrix.Rotation(math.pi/2,4,'Z')@Matrix.Translation(Vector((-12.7,-12.7,0))*S)
 transform(objects_since(before),xf)
 return xf@(Vector((-1,12.7,5.8))*S)/S

def demo_scene():
 reset();box('demonstration floor mat',(160,-25,5),(2320,1830,10),'9daeb8',35)
 manikin();medic();plug=volunteer_and_clip()
 # Exact relay and existing LCD1602 pod beside the manikin; no tablet or OLED.
 before=set(bpy.context.scene.objects);relay(False,display='lcd')
 xf=Matrix.Translation(Vector((330,150,29))*S)@Matrix.Rotation(math.radians(-45),4,'Z')
 transform(objects_since(before),xf)
 # Service loop is inside the existing relay; a naturally curved external run reaches the volunteer.
 start=xf@(Vector((83,101,30))*S)/S
 # Approximately 500 mm total including the existing 120 mm internal service allowance.
 internal=[Vector(p) for p in json.loads((lib['ASSETS']/'finger_route.json').read_text())]+[Vector(p) for p in [(77,66,31),(83,70,30),(83,81,30),(83,101,30)]]
 target_length=500-lib['hero_length'](internal)
 lo,hi=0.,400.
 for _ in range(40):
  h=(lo+hi)/2
  pts=BEZ(start,start+Vector((-h,-60,-49)),plug+Vector((-h,80,-86)),plug,90)
  if lib['hero_length'](pts)<target_length:lo=h
  else:hi=h
 (OUT/'qa/demo_cable.json').write_text(json.dumps({'inside_and_exit_mm':lib['hero_length'](internal),'outside_mm':lib['hero_length'](pts),'total_mm':lib['hero_length'](internal)+lib['hero_length'](pts)},indent=2))
 lib['hero_ribbon'](pts)
 # The conceptual cable route is deliberately loose, not a physical length certificate.
 before=set(bpy.context.scene.objects);medkit();place(objects_since(before),(-610,-210,11),-15)
 setup_camera((170,0,270),(1.35,-1.65,1.75),3250)
SCENES['demo_scene']=demo_scene
