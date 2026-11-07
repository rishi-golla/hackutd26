# Physical-test revision: exact CAD glue envelopes and backup bands.
def glue_gun_icon():
 reset(True)
 box('glue gun body',(0,0,0),(28,10,14),'blue')
 o=box('glue gun handle',(5,0,-12),(9,8,20),'blue');o.rotation_euler.y=math.radians(-15)
 cylinder((-14,0,0),(-25,0,0),2.4,'metal')
 cylinder((14,0,0),(32,0,0),3,'white')
 fit_camera()
register('icon_glue',glue_gun_icon,'Hot glue gun supplies four small removable backup dots; never glue optics or connectors.')

def finger_glue_step(zoom=False):
 reset();finger_parts();finger_cable();mesh('p3_joint_glue','gold',True)
 camera((12.7,4,6),(0,-1,.65),105)
 for x in (-3.75,29.15):arrow((x+(-8 if x<0 else 8),-17,12),(x,-4,2.4),r=.65,head=2)
 if zoom:
  for o in list(ARROWS.objects):bpy.data.objects.remove(o,do_unlink=True)
  camera((-3.75,-4,1.8),(-1,-.45,.35),22,True)
  arrow((-12,-12,9),(-4.4,-4,2.6),r=.4,head=1.2)
register('b4_04_glue',lambda:finger_glue_step(),'Two rice-grain glue dots bridge the outside tray–cradle seams near the open finger entry.')
register('b4_04_glue_zoom',lambda:finger_glue_step(True),'Exterior glue dot bridges tray and cradle, away from the board and cable.')

def pi_glue_step(zoom=False):
 reset();relay_base(with_bread=False,glued=False);mesh('p2_pi_glue','gold',True)
 camera((83,38,22),(.7,-1,3.5),235)
 for x,y in ((69.5,13.5),(11.5,62.5)):arrow((x,y,31),(x,y,11.6),r=.7,head=2)
 if zoom:
  for o in list(ARROWS.objects):bpy.data.objects.remove(o,do_unlink=True)
  camera((69.5,13.5,10.8),(-.5,.4,3),28,True)
  arrow((61,13.5,22),(69.5,13.5,11.5),r=.5,head=1.5)
register('b5_06_pi_rivet',lambda:pi_glue_step(),'Two small glue caps fill diagonal mounting holes beside the two edge clips.')
register('b5_06_pi_rivet_zoom',lambda:pi_glue_step(True),'Small glue cap covers the peg recess and hole rim without touching nearby components.')

def relay_backup_step(zoom=False,wrong=False):
 reset();relay_base(with_bank=True,closed=2);lid_group();finger_input(tied=True)
 mesh('p2_backup_strap','black',True,(-13.25 if wrong else 0,0,0))
 camera((85,39,17),(1,-1.5,1.2),235)
 if not wrong:arrow((112,-22,54),(109.25,0,35),r=1,head=3)
 if zoom:camera((109.25,0,30),(1,-2,1),48,True)
register('b5_22_strap',lambda:relay_backup_step(),'Third strap follows the side guides around the closed box and already-secured bank.')
register('b5_22_strap_zoom',lambda:relay_backup_step(True),'Backup strap sits between shallow side-channel shoulders, clear of the release paddle.')
register('b5_22_strap_ok',lambda:relay_backup_step(),'Backup strap occupies its clear corridor beside the vents and existing bank straps.')
register('b5_22_strap_no',lambda:relay_backup_step(wrong=True),'Misplaced backup strap crosses lid vents and overlaps an existing bank strap.')

def case_backup_step(front=False,zoom=False):
 reset();case_parts(front=front)
 ob=mesh('p1_front_backup_band' if front else 'p1_backup_band','black',True);transform([ob],P1_FLIP)
 # Slight underside view shows the outward rim route and the short-end wrap together.
 camera((0,-8,8),(-1,-1.6,1.1),225)
 arrow((-90,-49,30),(-72,-36.3,13),r=1,head=3)
 if zoom:
  for o in list(ARROWS.objects):bpy.data.objects.remove(o,do_unlink=True)
  camera((56,-35,0),(-.3,-.3,-1.5),62,True)
  arrow((75,-44,-12),(57,-36.3,-.5),r=.7,head=2)
for front in (False,True):
 for zoom in (False,True):
  n='b6_05_strap'+('_front' if front else '')+('_zoom' if zoom else '')
  register(n,lambda f=front,z=zoom:case_backup_step(f,z),'Narrow rubber band follows the rim groove around both short ends, avoiding openings and latches.')
FRONT_ALIASES.update({'b6_05_strap_front':'b6_05_strap','b6_05_strap_front_zoom':'b6_05_strap_zoom'})
