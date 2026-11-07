#!/usr/bin/env python3
"""Regenerate Handoff build guide diagrams (requires rsvg-convert for PNGs)."""
from html import escape
from pathlib import Path
import subprocess,sys

OUT = Path(__file__).resolve().parent
NAVY='#142b3a'; MUTED='#526675'; LIGHT='#e8eff1'; GREEN='#168561'; ORANGE='#e58d2a'
class SVG:
 def __init__(self,w,h,title,sub):
  self.w=w;self.h=h;self.s=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">',f'<rect width="100%" height="100%" fill="#f8faf9"/>'];self.text(40,54,title,30,'#142b3a',700);self.text(40,86,sub,16,MUTED)
 def rect(self,x,y,w,h,fill='white',stroke='#c9d7d8',rx=9,sw=2):self.s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')
 def text(self,x,y,t,size=16,color=NAVY,weight=400,anchor='start'):self.s.append(f'<text x="{x}" y="{y}" font-family="Arial, sans-serif" font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}">{escape(str(t))}</text>')
 def line(self,x1,y1,x2,y2,color=NAVY,width=3,dash=''):self.s.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="{width}"'+(f' stroke-dasharray="{dash}"' if dash else '')+'/>')
 def path(self,pts,color=NAVY,width=3,dash=''):self.s.append(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"'+(f' stroke-dasharray="{dash}"' if dash else '')+'/>')
 def circle(self,x,y,r,fill,stroke='none',sw=1):self.s.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')
 def save(self,name):
  (OUT/(name+'.svg')).write_text('\n'.join(self.s+['</svg>']))
  subprocess.run(['rsvg-convert','-z','2','-o',str(OUT/(name+'.png')),str(OUT/(name+'.svg'))],check=True)

def d1():
 s=SVG(1660,1200,'Relay wiring','Physical header pin numbers • functional wiring • see breadboard layout for exact holes')
 s.rect(35,112,430,944);s.text(55,146,'Raspberry Pi 4 • 40-pin header',20,weight=700)
 odd=['3.3V','GPIO2 / SDA','GPIO3 / SCL','GPIO4','GND','GPIO17','GPIO27','GPIO22','3.3V','GPIO10','GPIO9','GPIO11','GND','GPIO0','GPIO5','GPIO6','GPIO13','GPIO19','GPIO26','GND']
 even=['5V','5V','GND','GPIO14','GPIO15','GPIO18','GND','GPIO23','GPIO24','GND','GPIO25','GPIO8','GPIO7','GPIO1','GND','GPIO12','GND','GPIO16','GPIO20','GPIO21']
 used={1,2,3,4,5,6,9,11,15,16,17,18}
 for i in range(20):
  y=182+i*38
  for n,name,x in [(2*i+1,odd[i],65),(2*i+2,even[i],260)]:
   if n in used:s.rect(x-8,y-23,174,32,'#e2f3ed','#b1d9cb',5,1)
   s.circle(x+8,y-7,5,GREEN if n in used else '#9ba9ad');s.text(x+21,y,name and f'{n:>2}  {name}',14,weight=700 if n in used else 400)
 s.text(55,1004,'Green = occupied by SHIM or used connection',14,MUTED);s.text(55,1028,'Pins 1–6 are covered by the SHIM.',14,MUTED)
 s.rect(505,112,1115,234);s.text(525,147,'I²C / Qwiic chain',22,weight=700)
 for x,w,title,lines in [(530,270,'Qwiic SHIM',['On header pins 1–6','square pad → pin 1','5 V input; onboard 3.3 V']), (1220,360,'MAX30101',['Either Qwiic port','in finger clip'])]:
  s.rect(x,175,w,125,'#f5f8f7');s.text(x+15,201,title,19,weight=700)
  for j,t in enumerate(lines):s.text(x+15,228+j*23,t,14,MUTED)
 for x1,x2 in [(800,1220)]:
  for k,c in enumerate(['#222222','#df3e36','#3082bd','#e4b92b']):s.line(x1,208+k*13,x2,208+k*13,c,5)
 s.text(1010,290,'500 mm direct cable',15,MUTED,anchor='middle')
 s.rect(505,370,1115,484);s.text(525,405,'HBAN button → breadboard → Pi',22,weight=700)
 s.text(525,435,'Common-anode RGB ring; the switch uses the internal pull-up.',15,MUTED)
 s.text(525,479,'BUTTON LEAD',14,MUTED,700);s.text(880,479,'170-POINT MINI BREADBOARD',14,MUTED,700);s.text(1310,479,'PI PHYSICAL PIN',14,MUTED,700)
 rows=[('Switch 1','11  GPIO17','#526675','direct'),('Switch 2','9  GND','#526675','direct'),('Ring common (+)','17  3.3 V','#526675','direct'),('Red cathode','15  GPIO22','#c63939','220 Ω'),('Green cathode','16  GPIO23','#168561','220 Ω'),('Blue cathode','18  GPIO24','#237db4','220 Ω')]
 for i,(lead,pin,c,r) in enumerate(rows):
  y=514+i*51;s.text(535,y+5,lead,17,weight=700);s.line(690,y,897,y,c,3)
  if r=='direct':s.rect(902,y-18,126,35,'#f2f6f5','#b9cac8',5,1);s.text(965,y+5,'junction',14,anchor='middle')
  else:s.rect(902,y-18,126,35,'#fff4de','#e2be76',5,1);s.text(965,y+5,r,16,weight=700,anchor='middle')
  s.line(1028,y,1280,y,c,3);s.text(1310,y+5,pin,17,weight=700)
 s.text(525,824,'R / G / B are SIGNAL colors here. Button wire insulation colors are not documented; identify each lead.',15,'#9a4d20',700)
 s.rect(505,882,1115,174);s.text(525,915,'Legend and operating notes',19,weight=700)
 for x,c,t in [(530,'#222222','Black: GND'),(730,'#df3e36','Red: 3.3 V'),(945,'#3082bd','Blue: SDA'),(1155,'#e4b92b','Yellow: SCL')]:s.line(x,945,x+35,945,c,5);s.text(x+45,950,t,15)
 s.text(525,987,'Qwiic colors above identify the single SHIM-to-finger cable. RGB ring cathodes are active LOW.',15,MUTED)
 s.text(525,1015,'Each LED cathode needs its own 220 Ω resistor. Pressed switch connects GPIO17 to GND.',15,MUTED)
 s.save('relay-wiring')

def d2():
 s=SVG(1420,810,'Pi 4 header orientation','Top view • USB / Ethernet to the right • square pad marks physical pin 1')
 s.rect(75,160,990,600,'#276e53','#1f4d3b',20,3)
 for x,y in [(115,200),(1025,200),(115,720),(1025,720)]:s.circle(x,y,14,'#e5e9df','#b7cabc',3)
 s.rect(1065,253,150,377,'#b8c3c7','#7d8e95',7);s.text(1140,425,'USB /',20,anchor='middle');s.text(1140,456,'Ethernet',19,anchor='middle')
 s.rect(139,206,855,99,'#172c2a','#11241e',4)
 for i in range(20):
  x=159+i*42.5
  for row in range(2):
   n=2*i+(2 if row==0 else 1); y=235+row*40
   if n==1:s.rect(x-8,y-8,16,16,'#f4d36d','#4e4623',0,1)
   else:s.circle(x,y,8,'#d6bf71')
   if i<3:s.text(x,y-12,str(n),11,'#ffffff',700,'middle')
 s.rect(142,209,119,92,'none','#e3aa31',3,4)
 s.path('200,210 200,135 400,135',ORANGE,3);s.text(410,140,'SHIM covers pins 1–6',19,weight=700)
 s.path('159,275 159,355 350,355',ORANGE,3);s.text(360,361,'Pin 1: square pad • inner row',20,weight=700)
 s.text(570,414,'Raspberry Pi 4 Model B',27,'#e7f4ed',700,'middle');s.text(570,448,'board outline 85 × 56 mm',19,'#e7f4ed',anchor='middle')
 s.text(570,490,'Header is along the top edge',18,'#e7f4ed',anchor='middle')
 s.text(100,785,'SHIM square pad aligns with pin 1; the 2 × 3 outline is shown in gold. Diagram is schematic, not a drilling template.',15,MUTED)
 s.save('header-orientation')

def d3():
 s=SVG(1560,1120,'Mini breadboard placement','ELEGOO 170-point • 17 numbered rows shown vertically × a–j • center channel separates each row')
 s.rect(45,120,955,675,'#f1eee6','#c8c5ba',25,3)
 left=145;step=45;ys={}
 for i,l in enumerate('abcdefghij'):ys[l]=205+i*48+(58 if i>=5 else 0)
 for col in range(1,18):
  x=left+(col-1)*step;s.text(x,178,str(col),14,MUTED,700,'middle')
  for l in 'abcdefghij':
   s.circle(x,ys[l],8,'#5e6668','#9fa8a6',2)
 for l,y in ys.items():s.text(109,y+5,l,18,weight=700,anchor='middle')
 s.rect(125,424,780,42,'#c7ceca','#c7ceca',4,1);s.text(305,451,'CENTER CHANNEL',13,'#3c4d4e',700,'middle')
 for col,c in [(3,'#657581'),(5,'#657581'),(7,'#657581'),(9,'#c63939'),(11,'#168561'),(13,'#237db4')]:
  x=left+(col-1)*step
  if col<9:
   for l in ['a','c']:s.circle(x,ys[l],12,c,'white',2)
  else:
   for l in ['a','e','f','h']:s.circle(x,ys[l],12,c,'white',2)
   s.line(x,ys['e'],x,ys['f'],c,4);s.rect(x-15,ys['e']+23,30,59,'#f4d699','#725c37',5,2);s.text(x,ys['e']+60,'Ω',15,NAVY,700,'middle')
 s.text(84,753,'Each colored marker is an occupied hole; resistors bridge e → f in numbered rows 9, 11 and 13.',15,weight=700)
 s.rect(1025,120,490,675);s.text(1048,154,'Every occupied hole',21,weight=700)
 lines=[('a3','Switch 1 lead'),('c3','Pi 11 • GPIO17'),('a5','Switch 2 lead'),('c5','Pi 9 • GND'),('a7','Ring common +'),('c7','Pi 17 • 3.3 V'),('a9','Red cathode'),('e9','Red resistor lead 1'),('f9','Red resistor lead 2'),('h9','Pi 15 • GPIO22'),('a11','Green cathode'),('e11','Green resistor lead 1'),('f11','Green resistor lead 2'),('h11','Pi 16 • GPIO23'),('a13','Blue cathode'),('e13','Blue resistor lead 1'),('f13','Blue resistor lead 2'),('h13','Pi 18 • GPIO24')]
 for i,(hole,label) in enumerate(lines):
  y=185+i*29;s.text(1055,y,hole,15,weight=700);s.text(1130,y,label,15)
 s.rect(45,828,1470,241);s.text(70,866,'How the holes connect',20,weight=700)
 s.text(70,900,'Within each numbered row, a–e are connected together; f–j are connected together. The center gap isolates the halves.',17)
 s.text(70,932,'Use a 220 Ω resistor in each of numbered rows 9, 11 and 13. Resistors have no polarity; keep their leads in separate holes.',17)
 s.text(70,964,'Six button leads go to a3, a5, a7, a9, a11, a13. Six Pi jumpers go to c3, c5, c7, h9, h11, h13.',17)
 s.text(70,1002,'Color identifies function, not the unknown color of the button’s pre-wired leads. Identify leads on the button first.',16,'#9a4d20',700)
 s.text(70,1034,'Pin 11 uses the Pi internal pull-up; press = LOW. RGB cathodes are active LOW.',16,MUTED)
 s.save('breadboard-layout')

def d4():
 s=SVG(1380,850,'Handoff network','Dino’s phone hotspot provides the local Wi-Fi for all three devices')
 s.rect(445,130,490,145,'#e0f2ec','#8dcbb3');s.text(690,184,'Dino’s phone',26,weight=700,anchor='middle');s.text(690,221,'Wi-Fi hotspot',20,anchor='middle');s.text(690,252,'iPhone: enable Maximize Compatibility',15,MUTED,anchor='middle')
 s.line(690,275,690,350,GREEN,5);s.line(235,350,1145,350,GREEN,5)
 for x in (235,690,1145):s.line(x,350,x,405,GREEN,5);s.circle(x,350,6,GREEN)
 devices=[(55,'Pixel bodycam',['Connect to hotspot Wi-Fi','Chrome web page','Open Mac phone test page :8000']), (510,'Raspberry Pi relay',['Connect to hotspot Wi-Fi','hostname: handoff-relay','handoff-relay.local']), (965,'MacBook',['Connect to hotspot Wi-Fi','Receiver: port 8765','Phone test page: port 8000'])]
 for x,title,ls in devices:
  s.rect(x,405,360,220);s.text(x+180,451,title,21,weight=700,anchor='middle')
  for i,l in enumerate(ls):s.text(x+180,493+i*37,l,16,anchor='middle')
 s.text(690,693,'Local network • same hotspot for every device',18,MUTED,anchor='middle');s.text(690,729,'The phone test page is served by the Mac; use the Mac’s reachable hotspot address.',15,MUTED,anchor='middle')
 s.save('network')

def d5():
 s=SVG(1450,930,'Bodycam camera modes','Both modes wear the phone landscape; mount and GoPro buckle remain on the chest-facing side')
 for x,title,desc in [(45,'REAR MODE • preferred','Screen faces chest; rear camera bar faces outward.'),(745,'FRONT MODE • fallback','Screen faces outward; back faces chest.')]:
  s.rect(x,120,660,700);s.text(x+330,158,title,22,weight=700,anchor='middle');s.text(x+330,190,desc,15,MUTED,anchor='middle')
  s.text(x+330,235,'OUTWARD VIEW',14,MUTED,700,'middle');s.rect(x+115,258,430,205,'#263337','#0f2024',28,3)
  if x==45:
   s.rect(x+450,284,42,150,'#101719','#050b0d',18);s.circle(x+471,314,10,'#5e7981');s.circle(x+471,354,10,'#5e7981');s.circle(x+471,394,10,'#5e7981');s.text(x+330,428,'HANDOFF',16,'#d6534c',700,'middle');s.text(x+330,498,'Rear camera bar vertical in landscape',17,weight=700,anchor='middle')
  else:
   s.rect(x+132,273,396,175,'#708d96','#172a30',18);s.circle(x+145,360,4,'#0f2024');s.text(x+330,498,'Full screen visible',17,weight=700,anchor='middle')
  s.text(x+330,554,'SIDE VIEW • chest on left',14,MUTED,700,'middle');s.rect(x+95,582,48,147,'#d8e3df','#b8ccc5',15);s.text(x+119,758,'CHEST',13,MUTED,700,'middle')
  s.rect(x+278,600,57,110,'#263337','#0f2024',6);s.rect(x+202,632,76,46,'#43545a','#1b2b2d',4);s.circle(x+224,655,11,'#f1f4f2');s.circle(x+256,655,11,'#f1f4f2');s.text(x+184,710,'2-prong mount',14,weight=700,anchor='middle')
  s.text(x+406,630,'OUTWARD →',15,weight=700)
  s.text(x+406,660,'Screen → chest' if x==45 else 'Screen → outward',15)
  s.text(x+406,685,'Rear → outward' if x==45 else 'Rear → chest',15)
  if x!=45:s.text(x+330,790,'Mount raised to clear rear camera bar',14,'#9a4d20',700,'middle')
 s.text(725,873,'The harness buckle has 3 prongs; the case has the mating 2-prong mount. Tilt axis is parallel to the long edge.',16,MUTED,anchor='middle')
 s.save('bodycam-modes')

if __name__=='__main__':
 diagrams={'relay-wiring':d1,'header-orientation':d2,'breadboard-layout':d3,'network':d4,'bodycam-modes':d5}
 for name in (sys.argv[1:] or diagrams):diagrams[name]()
