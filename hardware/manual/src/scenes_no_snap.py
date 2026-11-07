# No-snap revision: override the affected actions; old render sources remain archived.
RETIRED_NO_SNAP={'b5_06_pi_rivet','b5_06_pi_rivet_zoom','icon_J','icon_T3','b2_bed_J','b2_bed_coupon','coupon_test','coupon_test_zoom',
 'b4_04_clip_front','b4_04_clip_rear','b4_04_clip_zoom','b4_04_clip_rear_zoom','b4_04_clip_ok','b4_04_clip_no',
 'b4_release_clip','b4_release_clip_zoom','b5_04_strap_one','b5_04_straps','b5_06_pi_click','b5_22_click'}
for n in RETIRED_NO_SNAP:SCENES.pop(n,None)

def recap(n,caption):
 if n in SCENES:register(n,SCENES[n][0],caption)
for n,c in {
 'icon_glue':'Hot glue supplies only the four exterior finger-joint dots.',
 'b5_06_pi_zoom':'Pi mounting hole aligns with its plain locating peg; no edge clip is present.',
 'b5_06_pi_ok':'PCB rests flat on its support pad with the locating peg inside its hole.',
 'b5_06_pi_no':'Raised PCB has not seated on the support pad.',
 'b5_06_usb_dryfit_ok':'Front inset shows clearance around the seated plug; Pi rests on its locating pegs.',
 'b5_test_open':'Unrestrained Pi rests on locating pegs while the connected lid lies beside the box.',
 'b5_23_strap_one':'First strap surrounds the closed lid, box and power bank together.',
 'b5_23_straps':'Two straps secure both ends of the closed box and power bank.',
 'b6_05_plate_zoom':'Rigid chest-plate tongue slides through its capture rail toward the closed end stop.',
 'b6_05_plate_ok':'Chest plate reaches the closed rail end stop.',
 'b6_05_plate_no':'Partly inserted chest plate leaves a gap before the closed rail end stop.',
 'b6_05_plate_front_zoom':'Front-mode chest-plate tongue slides through its rigid capture rail.',
 'b6_05_plate_front_ok':'Front-mode plate reaches the closed rail end stop.',
 'b6_05_plate_front_no':'Partly inserted front-mode plate leaves a gap before the rail end stop.',
 'parts_printed':'Printed shells, relay parts, finger halves and T1/T2 fit gauges; no spring clips or coupons.'
}.items():recap(n,c)
register('b5_06_pi_seat',lambda:base_step('click'),'Pi rests flat on four support pads; the lid posts retain it after closure.')
register('b5_22_seat',lambda:close_step('check'),'Lid rests flush on the base, located by rigid underside lips.')
for n,w in [('b5_22_close_zoom',False),('b5_22_close_ok',False),('b5_22_close_no',True)]:
 register(n,lambda w=w:close_step('check',True,w),'Raised lid leaves a visible seam gap.' if w else 'Lid sits flush against the base rim; straps provide retention.')

def locator_step(wrong=False,zoom=False):
 reset();finger_parts(new='hood',hood_lift=3 if wrong else 0);finger_cable()
 camera((12,12,8),(-1,-1.8,1.6),95)
 if zoom:camera((-2,-4,2.8),(-1,-1.4,.7),24,True)
 if wrong:arrow((-12,-4,14),(-2,-4,5),r=.6,head=1.8)
register('b4_04_locate_zoom',lambda:locator_step(True,True),'Cradle socket aligns above the tray’s chamfered locating pin.')
register('b4_04_locate_ok',lambda:locator_step(False,True),'Tray and cradle meet flush with all locating pins seated.')
register('b4_04_locate_no',lambda:locator_step(True,True),'Raised cradle leaves a gap because its locating pins are not seated.')
GLUE_POINTS=[(-3.75,-4,1.8),(29.15,-4,1.8),(-3.75,32,1.8),(29.15,32,1.8)]
def glue_dot(at,new=False):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=16,radius=1,location=Vector(at)*S)
 o=bpy.context.object;o.name='exterior rice-grain glue';o.scale=Vector((1,1.75,1))*S;assign(o,'gold',new)
def glue_action(index,zoom=False):
 reset();finger_parts();finger_cable()
 for i,p in enumerate(GLUE_POINTS):
  if i<=index:glue_dot(p,i==index)
 p=GLUE_POINTS[index];side=-1 if p[0]<0 else 1
 camera((12.7,12,6),(side*1.8,-1 if p[1]<0 else 1,.9),100)
 arrow((p[0]+side*14,p[1]-8,16),(p[0]+side*.8,p[1],2.3),r=.7,head=2)
 if zoom:camera(p,(side,-.6,.4),24,True)
for i in range(4):register('b4_04_glue_'+str(i+1),lambda i=i:glue_action(i),'One rice-grain glue dot bridges the exterior seam; previously applied dots remain visible.')
def all_finger_glue():
 reset()
 for side,pos in [(-1,(-32,0,0)),(1,(32,0,0))]:
  def build(side=side):
   finger_parts();finger_cable()
   for p in GLUE_POINTS:glue_dot(p,True)
  network_panel(build,pos,54,(side,-.25,.3))
 camera((0,0,0),(0,0,1),132)
register('b4_04_glue',all_finger_glue,'Opposite side views show all four exterior glue dots, two on each seam.')
register('b4_04_glue_zoom',lambda:glue_action(0,True),'Small glue dot bridges the outside seam without entering the sensor or finger channel.')

def stack_strap_step(second=False,zoom=False,wrong=False):
 reset();relay_base(with_bank=True);lid_group();finger_input(tied=True)
 if wrong:mesh('p2_backup_strap','black',True,(15,0,0))
 else:bank_straps(2 if second else 1,1 if second else 0,2 if second else 1)
 camera((85,39,17),(1,-1.5,1.2),235)
 x=96 if second else 36
 if not wrong:arrow((x,-22,54),(x,0,35),r=1,head=3)
 if zoom:camera((x,0,30),(1,-2,1),48,True)
register('b5_22_strap',lambda:stack_strap_step(),'First external strap follows its guides around the lid, box and bank.')
register('b5_22_straps',lambda:stack_strap_step(True),'Second external strap holds the other end; two straps secure the whole stack.')
register('b5_22_strap_zoom',lambda:stack_strap_step(False,True),'Strap sits in the shallow wall guide beside the USB-C opening and vents.')
register('b5_22_strap_ok',lambda:stack_strap_step(True),'Both straps occupy their guides and leave the ports, vents and button clear.')
register('b5_22_strap_no',lambda:stack_strap_step(True,wrong=True),'Misplaced straps cross vents instead of following the wall guides.')

def two_band_step(front=False,second=False,zoom=False):
 reset();case_parts(front=front)
 prefix='p1_front_band_' if front else 'p1_band_'
 ob=mesh(prefix+'first','black',not second);transform([ob],P1_FLIP)
 if second:
  ob=mesh(prefix+'second','black',True);transform([ob],P1_FLIP)
 camera((0,-8,8),(-1,-1.6,1.1),225)
 side=1 if second else -1
 arrow((-90,side*49,30),(-72,side*36.3,13),r=1,head=3)
 if zoom:camera((56,side*35,0),(-.3,side*.3,-1.5),62,True)
for front in (False,True):
 for second in (False,True):
  for zoom in (False,True):
   n='b6_05_strap'+('_second' if second else '')+('_front' if front else '')+('_zoom' if zoom else '')
   register(n,lambda f=front,s=second,z=zoom:two_band_step(f,s,z),'Two narrow bands retain both long rims while the openings and mount stay clear.' if second else 'First narrow band follows one rim groove and wraps around both short ends.')
   if front:FRONT_ALIASES[n]=n.replace('_front','')

def no_snap_release(kind,zoom=False):
 if kind=='case':
  p1_scene('slide',False);camera((30,0,14),(1,-1.4,1.7),230)
  for o in list(ARROWS.objects):bpy.data.objects.remove(o,do_unlink=True)
  arrow((58,-51,15),(104,-51,15),r=1,head=3)
  if zoom:
   for o in list(ARROWS.objects):bpy.data.objects.remove(o,do_unlink=True)
   camera((64,-41,12),(1,-1.3,1),62,True);arrow((54,-45,12),(76,-45,12),r=.8,head=2.5)
 elif kind=='lid':
  if zoom:
   reset();relay_base();finger_input(tied=True);lid_group(offset=(0,0,7),new='lid')
   camera((36,3,40),(.4,-1.5,.7),42,True);arrow((42,0,41),(42,0,52),r=.7,head=2)
  else:
   close_step('lower')
   for o in list(ARROWS.objects):bpy.data.objects.remove(o,do_unlink=True)
   arrow((174,40,43),(174,40,67),r=1,head=3)
 elif kind=='pi':
  base_step('pi',zoom)
  for o in list(ARROWS.objects):bpy.data.objects.remove(o,do_unlink=True)
  if zoom:arrow((69.5,13.5,12),(69.5,13.5,23),r=.7,head=2)
  else:arrow((99,37,13),(99,37,49),r=1.1,head=3)
for name,kind,caption in [('b6_release','case','With both bands removed, the chest plate slides out of the rigid rails.'),('b5_release_lid','lid','With both straps undone, the lid lifts directly off its locating lips.'),('b5_release_pi','pi','With the lid removed, the Pi lifts directly off its locating pegs.')]:
 for zoom in (False,True):register(name+('_zoom' if zoom else ''),lambda k=kind,z=zoom:no_snap_release(k,z),caption)
register('b6_slide_open',lambda:no_snap_release('case'),'With both bands removed, the chest plate slides horizontally out of the rails.')

def rail_fit_scene():
 reset();mesh('rail_receiver','graphite');mesh('rail_key','graphite',True,(14,2.58,5.52))
 camera((23,12,7),(1,-1.6,1.6),82)
 arrow((49,-7,9),(19,-7,9),r=.8,head=2.5)
register('b2_rail_test',rail_fit_scene,'Backed tongue slides through the rigid rail toward its end stop, without a flexure.')


def usb_remove_step():
 usb_dryfit_step('move')
 for o in list(ARROWS.objects):bpy.data.objects.remove(o,do_unlink=True)
 arrow((35,7,12),(35,-21,12),r=.7,head=2.2)
register('b5_06_usb_remove',usb_remove_step,'Straight USB-C plug withdraws after a successful dry-fit.')


def pi_posts_step(zoom=False):
 reset()
 if zoom:
  mesh('pi_post_section_base','graphite');mesh('pi_post_section_board','pcb');mesh('pi_post_section_tip','graphite',True)
  camera((69.5,13.5,11),(0,-1,0),11,True)
 else:
  objs=[mesh('p2_lid_skin','graphite'),mesh('p2_pi_posts','graphite',True)]
  transform(objs,LID_FLIP)
  camera((79,39,14),(1,-1.45,1.6),190)
register('b5_22_posts',lambda:pi_posts_step(),'Two diagonal hold-down posts extend from the lid underside toward bare Pi mounting-hole rings.')
register('b5_22_posts_zoom',lambda:pi_posts_step(True),'Section shows the hollow post tip above the mounting ring, with nominal clearance.')
