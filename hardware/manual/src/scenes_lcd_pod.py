# Optional LCD1602 pod. All LCD/backpack dimensions are measurement assumptions.
LCD_POD_AT=Vector((0,10,39.4))
LCD_KEYS=('black','wirered','wireblue','yellow')

def lcd_pod_screen(offset):
 before=set(bpy.context.scene.objects)
 box('LCD glass',(40,18,8.65),(64.5,14,.10),'blue')
 for row in range(2):
  for col in range(16):
   box('LCD character cell',(10.5+3.92*col,14.3+7*row,8.72),(3.15,5.4,.03),'366b9e')
 xf=Matrix.Translation((Vector(offset)+Vector((3.5,4,17)))*S)@Matrix.Rotation(math.radians(20),4,'X')
 transform([o for o in bpy.context.scene.objects if o not in before],xf)

def lcd_pod_parts(offset=LCD_POD_AT):
 for n,k in [('lcd_pod_base','graphite'),('lcd_pod_board','pcb'),('lcd_pod_bezel','black'),('lcd_pod_backpack','pcb'),('lcd_pod_pot','blue'),('lcd_pod_header','gold'),('lcd_pod_female_ends','black'),('lcd_pod_glue','gold')]:mesh(n,k,offset=offset)
 lcd_pod_screen(offset)

def lcd_pod_wire_paths(pod_shift=Vector((0,0,0))):
 data=json.loads((ASSETS/'lcd_routes.json').read_text())
 for i,route in enumerate(data[0]):
  pts=[Vector(p) for p in route]
  if pod_shift.length:
   # Exploded unpowered view: only exterior lead route moves; installed vent/pins stay exact.
   pts=[p+pod_shift for p in pts[:2]]+[Vector((54+i*3,5+i*3,48))]+pts[3:]
  line(pts,LCD_KEYS[i],.55,False)
 for i,route in enumerate(data[1]):line(route,('wireblue','yellow')[i],.55,False)
 mesh('lcd_pod_gpio_housings','black');mesh('lcd_pod_bb_housings','black')

def lcd_pod_on_box(labeled=False):
 reset(True);relay_base(with_bank=True);lid_group();finger_input(tied=True)
 mesh('lcd_pod_second_strap','black');mesh('lcd_pod_stack_strap','black')
 lcd_pod_parts();lcd_pod_wire_paths();hero_power()
 camera((76,36,25),(1,-1.5,1.55),270)
 if labeled:
  for text_body,xy,w,side,at in [
   ('LCD1602 on four pegs',(70,100),380,'bottom',(45,36,72)),
   ('Left strap holds pod',(100,910),340,'top',(36,7,41.3)),
   ('Existing lid unchanged',(1060,120),400,'bottom',(122,28,39.4)),
   ('MARK button clear',(1110,850),370,'top',(128,61,42)),
   ('Leads through existing vent',(520,1030),460,'top',(78.6,28,42))]:hero_callout(text_body,xy,at,w,side)

def lcd_pod_wiring():
 global INVENTORY
 reset()
 relay_base(with_bank=False);finger_input(tied=True);completed_wiring()
 INVENTORY=True
 shift=Vector((-105,8,0));lcd_pod_parts(LCD_POD_AT+shift);lcd_pod_wire_paths(shift)
 # A small exact vent strip identifies the existing entry without hiding the open Pi.
 mesh('lcd_vent_strip','graphite')
 camera((38,37,22),(.4,-1.4,2),370)
 for txt,xy,w,side,at in [
  ('UNPOWERED FIT\nCheck exposed pin length first',(40,65),500,'bottom',(20.6,60,32.6)),
  ('Pin 3 → g16\nPin 5 → g17',(1030,90),350,'bottom',(20.6,60,26)),
  ('GND → d5\nVCC (3.3 V) → d7',(1000,910),420,'top',(120,34.6,18)),
  ('SDA → h16\nSCL → h17',(1080,520),340,'left',(146.5,19.36,18)),
  ('Feed ends one at a time\nthrough the existing lid vent',(420,1030),520,'top',(78.6,29,39))]:hero_callout(txt,xy,at,w,side)

register('lcd_pod_bed',lambda:bed_scene('lcd1602_pod'),'Open LCD pod rests flat, with inclined locating pegs and an unobstructed strap channel.')
register('lcd_pod_on_box',lambda:lcd_pod_on_box(False),'LCD pod sits above the unchanged lid, retained by the existing left whole-stack strap.')
register('lcd_pod_on_box_labeled',lambda:lcd_pod_on_box(True),'Callouts identify LCD, retaining strap, unchanged lid, MARK button and vent wire entry.')
register('lcd_pod_wiring',lcd_pod_wiring,'Unpowered fit view routes LCD leads through the vent to breadboard and GPIO connections.')
