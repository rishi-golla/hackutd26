# Complete relay overview. Real CAD meshes stay unscaled relative to each other.
# No print geometry is edited. The finger clip lies on the same table as the bank.
HERO_CLIP_CENTER=Vector((378,140,-12.8))
HERO_CLIP_XF=Matrix.Translation(HERO_CLIP_CENTER*S)@Matrix.Rotation(math.pi,4,'Z')@Matrix.Translation(Vector((-12.7,-12.7,0))*S)

def hero_bezier(a,b,c,d,n=90):
 a,b,c,d=map(Vector,(a,b,c,d))
 return [(1-t)**3*a+3*(1-t)**2*t*b+3*(1-t)*t*t*c+t**3*d for t in [i/n for i in range(n+1)]]
def hero_length(pts):return sum((b-a).length for a,b in zip(pts,pts[1:]))
def hero_external(h):
 start=(83,81,30);end=(404.7,140,-7)
 return hero_bezier(start,(83,104,21),(140,h,-12),(230,h,-12))+hero_bezier((230,h,-12),(300,h,-12),(417,140,-7),end)[1:]+[Vector((391.7,140,-7))]
def hero_ribbon(pts):
 for i,key in enumerate(('black','wirered','wireblue','yellow')):
  adjusted=[]
  for j,p in enumerate(pts):
   tangent=pts[min(j+1,len(pts)-1)]-pts[max(j-1,0)]
   side=tangent.cross(Vector((0,0,1))).normalized()
   adjusted.append(p+side*((i-1.5)*.6))
  line(adjusted,key,.3,False)

def hero_power():
 box('generic bank USB socket',(4.45,18,-7),(.1,13,5),'marker')
 box('bank USB A body',(-5.5,18,-7),(14,14,7),'black')
 box('bank USB A shell',(3.5,18,-7),(4,12,4.5),'metal')
 box('straight USB C overmold',(19.2,-3.2,12.2),(15,24,10),'black')
 box('straight USB C nose',(19.2,12.05,12.2),(8.3,6.5,2.5),'metal')
 cylinder((19.2,-15.2,12.2),(19.2,-23.2,12.2),2.5,'black')
 pts=hero_bezier((-12.5,18,-7),(-55,20,-7),(-53,-43,-7),(-12,-43,2))
 pts+=hero_bezier((-12,-43,2),(12,-43,7),(19.2,-34,12.2),(19.2,-23.2,12.2))[1:]
 line(pts,'black',1.1,False)

def hero_overlay_point(x,y,depth=.02):
 return CAM.location+CAM.rotation_euler.to_matrix()@Vector(((x/1600-.5)*CAM.data.ortho_scale,(.5-y/1200)*CAM.data.ortho_scale*.75,-depth))
def hero_pixel(p):
 v=CAM.rotation_euler.to_matrix().transposed()@(Vector(p)*S-CAM.location)
 return (1600*(.5+v.x/CAM.data.ortho_scale),1200*(.5-v.y/(CAM.data.ortho_scale*.75)))
def hero_callout(text_body,xy,target,width,side='bottom'):
 # Screen-space text and leaders match the inventory's clean dark sans-serif cards.
 x,y=xy;lines=text_body.count('\n')+1;height=34*lines+26
 edge={'bottom':(x+width/2,y+height),'top':(x+width/2,y),'left':(x,y+height/2),'right':(x+width,y+height/2)}[side]
 tip=hero_pixel(target)
 elbow=(edge[0],(edge[1]+tip[1])/2) if side in ('top','bottom') else ((edge[0]+tip[0])/2,edge[1])
 pts=[hero_overlay_point(*p,.019)/S for p in [edge,elbow,tip]]
 o=line(pts,'marker',.27,False);OLD.objects.unlink(o);TEXT.objects.link(o)
 # Rounded screen-facing label card, white with a subtle grey border.
 radius=9;poly=[]
 for cx,cy,start in [(x+width-radius,y+radius,-90),(x+width-radius,y+height-radius,0),(x+radius,y+height-radius,90),(x+radius,y+radius,180)]:
  for i in range(9):
   a=math.radians(start+i*90/8);poly.append((cx+radius*math.cos(a),cy+radius*math.sin(a)))
 me=bpy.data.meshes.new('callout card');me.from_pydata([hero_overlay_point(*p,.018) for p in poly],[],[tuple(range(len(poly)))]);me.update()
 ob=bpy.data.objects.new('callout card',me);bpy.context.collection.objects.link(ob);assign(ob,'ffffff');OLD.objects.unlink(ob);TEXT.objects.link(ob)
 border=line([hero_overlay_point(*p,.0179)/S for p in poly+[poly[0]]],'d6dde4',.22,False);OLD.objects.unlink(border);TEXT.objects.link(border)
 cv=bpy.data.curves.new('callout text','FONT');cv.body=text_body;cv.align_x='LEFT';cv.align_y='TOP';cv.size=CAM.data.ortho_scale/1600*31;cv.space_line=1.1
 cv.font=bpy.data.fonts.load('/System/Library/Fonts/Supplemental/Arial.ttf',check_existing=True)
 ob=bpy.data.objects.new(text_body,cv);bpy.context.collection.objects.link(ob);ob.location=hero_overlay_point(x+14,y+11,.017);ob.rotation_euler=CAM.rotation_euler;assign(ob,'marker');OLD.objects.unlink(ob);TEXT.objects.link(ob)
 # Small accent dot marks the exact callout target, without changing the device.
 vs=[hero_overlay_point(tip[0]+4*math.cos(a),tip[1]+4*math.sin(a),.016) for a in [i*math.tau/24 for i in range(24)]]
 me=bpy.data.meshes.new('callout dot');me.from_pydata(vs,[],[tuple(range(24))]);me.update();ob=bpy.data.objects.new('callout target',me);bpy.context.collection.objects.link(ob);assign(ob,'accent');OLD.objects.unlink(ob);TEXT.objects.link(ob)

def relay_complete(labeled=False):
 reset(True)
 relay_base(with_bank=True);lid_group();mesh('p2_backup_strap','black');hero_power()
 # Render the real service loop and tie, without the step-builder's illustrative long tail.
 internal=[Vector(p) for p in json.loads((ASSETS/'finger_route.json').read_text())]
 internal += [Vector(p) for p in [(77,66,31),(83,70,30),(83,81,30)]]
 target_length=500-hero_length(internal)
 low,high=110.,240.
 for _ in range(45):
  mid=(low+high)/2
  if hero_length(hero_external(mid))<target_length:low=mid
  else:high=mid
 external=hero_external((low+high)/2)
 assert abs(hero_length(external)-target_length)<.1, (hero_length(external),target_length)
 hero_ribbon(internal+external[1:])
 box('SHIM cable plug',(20.25,48,20),(5,4,3),'black')
 line([(61,72.6,31),(75,72.6,31),(77,67,35),(67,64,35),(65,65,29),(61,72.6,31)],'black',.6,False)
 box('exit zip tie lock',(61,72.6,31),(3,3,2),'black')
 before=set(bpy.context.scene.objects)
 finger_parts();mesh('p3_joint_glue','gold');mesh('p3_strap','black',source='cad');finger_tie()
 box('sensor cable plug',(-1,12.7,5.8),(5,4,3),'black')
 transform([o for o in bpy.context.scene.objects if o not in before],HERO_CLIP_XF)
 camera((180,70,0),(-.70,1,1.3),550)
 anchors={'MARK button (light ring)':(128,61,43.5),'Relay box: Raspberry Pi inside':(50,45,39.4),'Power bank':(25,73,-11),'2 straps':(96,45,40),'USB-C power':(-24,-41,1),'500 mm sensor cable':tuple(external[len(external)//2]),'Finger clip: pulse + oxygen sensor':(378,150,2)}
 (ROOT/'qa/relay_complete_layout.json').write_text(json.dumps({'camera_scale_mm':550,'camera_target':[180,70,0],'clip_center_mm':list(HERO_CLIP_CENTER),'internal_cable_mm':hero_length(internal),'external_cable_mm':hero_length(external),'total_cable_mm':hero_length(internal)+hero_length(external),'label_targets_px':{k:hero_pixel(v) for k,v in anchors.items()}},indent=2)+'\n')
 if labeled:
  for body,xy,w,side,key in [
   ('MARK button (light ring)',(650,240),370,'bottom','MARK button (light ring)'),
   ('Relay box:\nRaspberry Pi inside',(1190,150),320,'bottom','Relay box: Raspberry Pi inside'),
   ('Power bank',(1110,1020),220,'top','Power bank'),
   ('2 straps',(1050,350),150,'bottom','2 straps'),
   ('USB-C power',(1290,850),250,'top','USB-C power'),
   ('500 mm sensor cable',(440,1000),340,'top','500 mm sensor cable'),
   ('Finger clip:\npulse + oxygen sensor',(70,260),370,'bottom','Finger clip: pulse + oxygen sensor')]:
   hero_callout(body,xy,anchors[key],w,side)
register('relay_complete',lambda:relay_complete(False),'Strapped relay and bank connect by power cable and sensor cable to the finger clip.')
register('relay_complete_labeled',lambda:relay_complete(True),'Labeled complete relay identifies the button, enclosed Pi, bank, straps, power cable and finger sensor.')
