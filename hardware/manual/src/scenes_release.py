def release_case(zoom=False,slide=False):
 p1_scene('slide' if slide else 'check',False,False)
 for o in list(ARROWS.objects):bpy.data.objects.remove(o,do_unlink=True)
 camera((30,0,14),(1,-1.4,1.7),230)
 if slide:arrow((58,-57,15),(104,-57,15),r=1,head=3)
 else:
  for side in (-1,1):arrow((46,side*66,12),(46,side*49,12),r=.9,head=2.7)
 if zoom:camera((46,-49,12),(1,-1.5,1),45,True)
register('b6_release',lambda:release_case(),'With its band removed, both recessed tabs squeeze inward before the plate slides off.')
register('b6_release_zoom',lambda:release_case(True),'Recessed squeeze tab moves inward to clear the retaining shoulder.')
register('b6_slide_open',lambda:release_case(slide=True),'Released chest plate slides horizontally away from the shell.')

def release_finger(zoom=False):
 finger_scene('check',zoom,False);arrow((17,-10.5,6),(17,-10.5,13),r=.5,head=1.5)
register('b4_release_clip',lambda:release_finger(),'After cold glue is peeled away, the J clip’s free tip lifts.')
register('b4_release_clip_zoom',lambda:release_finger(True),'Small free tip lifts the spring hook out of the notch.')

def release_lid(zoom=False):
 close_step('check',zoom);arrow((48,-10,40),(48,7,40),r=.65,head=2)
register('b5_release_lid',lambda:release_lid(),'With the backup strap removed, lid paddle pushes inward before the corner lifts.')
register('b5_release_lid_zoom',lambda:release_lid(True),'Paddle moves inward to clear the retaining bridge.')

def release_pi(zoom=False):
 base_step('check',zoom);arrow((69.5,11,13),(69.5,5,13),r=.4,head=1.2)
 if not zoom:arrow((11.5,65,13),(11.5,71,13),r=.4,head=1.2)
register('b5_release_pi',lambda:release_pi(),'With the lid removed, the Pi lifts directly off its pegs.')
register('b5_release_pi_zoom',lambda:release_pi(True),'Flexible edge clip bends away from the PCB corner.')
