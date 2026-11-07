#!/usr/bin/env python3
"""Handoff visual wiring panels. Run with --breadboard-rotation 0 or 180.

The breadboard orientation defaults to 0° until the mechanical layout confirms
which numbered end faces the Pi. The pin and hole assignments are invariant.
Requires rsvg-convert.
"""
import argparse
from pathlib import Path
from xml.sax.saxutils import escape
import subprocess

P = Path(__file__).resolve().parent.parent / 'img'
BG='#f4f6f8'; INK='#26343a'; ACCENT='#ff5a36'; GREEN='#348b62'

class Draw:
 def __init__(self):
  self.items=['<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200" viewBox="0 0 1600 1200">',f'<rect width="1600" height="1200" fill="{BG}"/>']
 def rect(self,x,y,w,h,fill,stroke=INK,sw=3,rx=8,extra=''):
  self.items.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" {extra}/>')
 def line(self,x1,y1,x2,y2,stroke=INK,sw=3,extra=''):
  self.items.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{stroke}" stroke-width="{sw}" stroke-linecap="round" {extra}/>')
 def path(self,d,stroke=INK,sw=3,extra=''):
  self.items.append(f'<path d="{d}" fill="none" stroke="{stroke}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" {extra}/>')
 def circle(self,x,y,r,fill,stroke=INK,sw=2,extra=''):
  self.items.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" {extra}/>')
 def text(self,x,y,t,size=24,anchor='middle',fill=INK,weight='bold'):
  self.items.append(f'<text x="{x}" y="{y}" fill="{fill}" font-family="Arial,sans-serif" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}">{escape(str(t))}</text>')
 def save(self,name):
  P.mkdir(parents=True,exist_ok=True)
  p=P/(name+'.svg');p.write_text('\n'.join(self.items+['</svg>']))
  subprocess.run(['rsvg-convert','-w','1600','-h','1200','-o',str(P/(name+'.png')),str(p)],check=True)

def header(s):
 # With USB/Ethernet on the right, pin 1 is on the inner row at left.
 s.rect(32,48,1536,288,'#d1e4d8','#91b5a3',3,22)
 s.rect(85,89,1430,210,'#5c9873','#315d49',3,14)
 s.rect(165,124,1270,136,'#303e3b','#1c2927',3,6)
 # SHIM occupies the leftmost three pairs, and its square pad is on pin 1.
 s.rect(169,128,174,128,'#5297ba','#28556d',3,4)
 s.rect(151,171,22,44,'#f2f1e9','#42545b',2,3)
 for i in range(20):
  x=190+64*i
  for n,y in ((2*i+2,157),(2*i+1,227)):
   if n==1:s.rect(x-10,y-10,20,20,'#f8dd82','#4c472d',2,0)
   else:s.circle(x,y,10,'#e2c66e','#4c472d',2)
   s.text(x,115 if n%2==0 else 291,str(n),21,fill=INK)

def hole_position(letter,n,rotation):
 rows='abcdefghij'; i=rows.index(letter)
 if rotation==180:n=18-n;i=9-i
 return 300+(n-1)*62, 590+i*40+(48 if i>=5 else 0)

def breadboard(s,rotation):
 s.rect(205,483,1190,655,'#ffffff','#68777b',4,32)
 s.rect(250,782,1060,24,'#d8dede','#c1c9c8',2,5)
 for n in range(1,18):
  x,_=hole_position('a',n,rotation);s.text(x,548,n,23)
 for letter in 'abcdefghij':
  _,y=hole_position(letter,1,rotation);s.text(244,y+8,letter,25)
  for n in range(1,18):
   x,_=hole_position(letter,n,rotation);s.circle(x,y,8,'#6d7775','#a5afad',2)

def resistor(s,n,rotation,active=False,neutral=False):
 x,y1=hole_position('e',n,rotation);_,y2=hole_position('f',n,rotation)
 lo,hi=sorted([y1,y2]);m=(lo+hi)/2
 # Existing resistors are faded; their actual red-red-brown-gold bands remain visible.
 s.items.append('<g opacity="1">' if active or neutral else '<g opacity="0.60">')
 if active:
  s.rect(x-21,m-39,42,78,'none',ACCENT,5,9)
 s.line(x,lo,x,hi,'#7b8383',4)
 s.rect(x-15,m-32,30,64,'#e6d1a9','#635c4f',2,6)
 for k,c in enumerate(['#bf392f','#bf392f','#805631','#c5a130']):
  s.rect(x-14,m-25+k*13,28,6,c,c,0,0)
 s.items.append('</g>')

def female(s,x,y,color):
 # Filled centre implies a socket, unlike the exposed male tip on the breadboard.
 s.rect(x-15,y-17,30,34,'#2c3539',ACCENT,4,5)
 s.circle(x,y,5,'#e2c66e','#111',2)

def male(s,x,y,color,label):
 s.circle(x,y,16,'#ffffff',ACCENT,5)
 s.circle(x,y,7,'#d3ad55','#413b29',2)
 s.rect(x-10,y-30,20,18,'#30383b',INK,2,3)
 s.text(x+23,y+9,label,23,'start',INK)

def jumper(s,pin,letter,n,color,d,rotation):
 x=190+64*((pin-1)//2);y=227 if pin%2 else 157
 bx,by=hole_position(letter,n,rotation)
 s.path(d,ACCENT,17);s.path(d,INK,11);s.path(d,color,7)
 female(s,x,y,color);male(s,bx,by,color,f'{letter}{n}')

def sample(rotation):
 s=Draw();header(s);breadboard(s,rotation)
 for n in (9,11,13):resistor(s,n,rotation)
 # Paths must respond to the rotation variable as well as the pin/hole endpoints.
 x3,y3=hole_position('c',3,rotation);x5,y5=hole_position('c',5,rotation)
 jumper(s,11,'c',3,'#397bbb',f'M 510 227 C 530 355, {x3-120} 390, {x3} {y3-30}',rotation)
 jumper(s,9,'c',5,'#5b6064',f'M 446 227 C 290 355, {x5+155} 425, {x5} {y5-30}',rotation)
 s.save('wire_02_jumpers_switch')


# Exact, fixed electrical assignments: header physical pin -> breadboard hole.
JUMPERS = [
 (11,'c',3,'#397bbb'), (9,'c',5,'#555d63'),
 (17,'c',7,'#c78719'), (15,'h',9,'#d73245'),
 (16,'h',11,'#219359'), (18,'h',13,'#4443bd'),
]

def all_resistors(s,rotation,active=False,neutral=False):
 for n in (9,11,13):resistor(s,n,rotation,active,neutral)

def route(pin,x,y):
 """Use separate paths; endpoints and labels carry the pin-to-hole identity."""
 sx=190+64*((pin-1)//2);sy=227 if pin%2 else 157
 if pin==11:return f'M {sx} {sy} C {sx+20} 355, {x-120} 390, {x} {y-30}'
 if pin==9:return f'M {sx} {sy} C {sx-156} 355, {x+155} 425, {x} {y-30}'
 bends={17:(-30,60),15:(100,-30),16:(190,45),18:(280,100)}
 b1,b2=bends[pin]
 return f'M {sx} {sy} C {sx+b1} 370, {x+b2} 440, {x} {y-30}'

def wire(s,pin,letter,n,color,rotation,active=False,neutral=False):
 x,y=hole_position(letter,n,rotation)
 if not active and not neutral:s.items.append('<g opacity="0.60">')
 if active:
  jumper(s,pin,letter,n,color,route(pin,x,y),rotation)
 else:
  sx=190+64*((pin-1)//2);sy=227 if pin%2 else 157
  d=route(pin,x,y);s.path(d,INK,12);s.path(d,color,7)
  s.rect(sx-15,sy-17,30,34,'#2c3539',INK,3,5);s.circle(sx,sy,5,'#e2c66e','#111',2)
  s.circle(x,y,10,'#d3ad55','#413b29',2);s.rect(x-10,y-30,20,18,'#30383b',INK,2,3)
  s.text(x+23,y+9,f'{letter}{n}',21,'start')
 if not active and not neutral:s.items.append('</g>')
 # Pin number beside breadboard end, paired with the same physical pin at the header.
 # Draw as a small white tag below the terminal, so the cable can be followed past crossings.
 s.rect(x-13,y+16,26,21,'#ffffff',ACCENT if active else '#89999b',2,4)
 s.text(x,y+32,str(pin),15,fill=INK)

def board_and_header(s,rotation):
 header(s);breadboard(s,rotation)

def header_tag(s,pin):
 x=190+64*((pin-1)//2); y=227 if pin%2 else 157
 s.rect(x+17,y-12,28,24,'#ffffff','#738a87',1,4)
 s.text(x+31,y+6,str(pin),16,fill=INK)

def permanent_set(s,rotation,stage,neutral=False):
 # stage = 0 overview, 1 resistor, 2 switch, 3 +, 4 RGB, 5+ all prior.
 if stage>=1:all_resistors(s,rotation,active=(stage==1),neutral=neutral)
 if stage>=2:
  for k,(pin,l,n,c) in enumerate(JUMPERS):
   appearing=(2 if k<2 else 3 if k==2 else 4)
   if stage>=appearing:wire(s,pin,l,n,c,rotation,active=(stage==appearing),neutral=neutral)
  for k,(pin,l,n,c) in enumerate(JUMPERS):
   appearing=(2 if k<2 else 3 if k==2 else 4)
   if stage>=appearing: header_tag(s,pin)

def overview(rotation):
 s=Draw();board_and_header(s,rotation)
 # This small label is explicitly requested for the row-one orientation overview.
 s.text(300,462,'row 1 → Pi side',22,'middle',INK)
 s.save('wire_00_overview')

def normal_panel(name,rotation,stage):
 s=Draw();board_and_header(s,rotation);permanent_set(s,rotation,stage)
 s.save(name)

def test_resistor(s,rotation):
 x1,y=hole_position('d',7,rotation);x2,_=hole_position('d',15,rotation)
 # Bow above the hole row to make clear that only the two endpoints touch.
 m=(x1+x2)/2;top=y-64
 d=f'M {x1} {y} C {x1} {top}, {x1+65} {top}, {m-45} {top} M {m+45} {top} C {x2-65} {top}, {x2} {top}, {x2} {y}'
 s.path(d,ACCENT,12);s.path(d,'#70777a',5)
 s.rect(m-45,top-14,90,28,'#ead2a1',ACCENT,4,7)
 for i,c in enumerate(('#c2332a','#c2332a','#774d2f','#bd982c')):s.rect(m-32+i*16,top-13,7,26,c,c,0,0)
 for x,lab in ((x1,'d7'),(x2,'d15')):
  s.circle(x,y,12,'#e2c66e',ACCENT,4);s.text(x,y+35,lab,20)

def button(s,cx,cy,highlight=False):
 # Frontal button; six separate leads are deliberately unlabelled and equally black.
 s.rect(cx-65,cy-90,130,105,'#eef1f0',INK,4,18)
 s.circle(cx,cy-40,44,'#e1e5e4',INK,4)
 s.circle(cx,cy-40,34,'#f4f6f8',ACCENT if highlight else '#8aa4a0',7)
 for i in range(6):s.circle(cx-50+i*20,cy+22,5,'#303638',INK,1)

def identify(rotation):
 s=Draw();s.items.append('<g transform="translate(5 55) scale(.82)">')
 board_and_header(s,rotation);permanent_set(s,rotation,5);test_resistor(s,rotation)
 # Wires leave male plugs at a15 and b5; all probe endpoints are shown.
 xp,yp=hole_position('a',15,rotation);xn,yn=hole_position('b',5,rotation)
 # Expanded canvas of the transformed group reaches original x=2105; put button at right.
 button(s,1820,725,True)
 for i in range(6):
  x=1770+i*20
  s.path(f'M {x} 747 C {x-10} 775, {x-70} 785, {x-130} {790+i*18}', '#34383a',5)
  s.line(x-130,790+i*18,x-119,788+i*18,'#bf9d63',4)
 # Loose male probe pins contact two separate bare button-wire tips.
 for l,n,c,ex,ey in [('a',15,'#00aec4',1640,790),('b',5,'#d241a3',1660,808)]:
  x,y=hole_position(l,n,rotation)
  s.path(f'M {x} {y-26} C {x+100} {y-140}, {ex-160} {ey-120}, {ex} {ey}',ACCENT,13)
  s.path(f'M {x} {y-26} C {x+100} {y-140}, {ex-160} {ey-120}, {ex} {ey}',c,7)
  male(s,x,y,c,f'{l}{n}')
  s.line(ex-12,ey-3,ex,ey,'#d5b56c',5)
  s.circle(ex,ey,7,'#e1bf76',ACCENT,4)
 s.items.append('</g>');s.save('wire_05_identify')

def button_connections(s,rotation,active=True):
 button(s,1820,745,active)
 # The six pre-wired leads are unlabeled: the illustration depicts connectivity,
 # never a physical plug-wire ordering or an assumed insulation colour.
 for i,n in enumerate((3,5,7,9,11,13)):
  x,y=hole_position('a',n,rotation);bx=1770+i*20;by=767
  d=f'M {bx} {by} C {bx-80} {by+60+i*7}, {x+130} {y+80+i*8}, {x} {y-28}'
  if active:s.path(d,ACCENT,12)
  s.path(d,'#373d40',7)
  if active:s.circle(x,y,12,'#d3ad55',ACCENT,4)
  else:s.circle(x,y,10,'#d3ad55',INK,2)
  s.rect(x-9,y-28,18,18,'#30383b',INK,2,3)
 for n in (3,5,7,9,11,13):
  x,y=hole_position('a',n,rotation);s.rect(x+14,y-14,38,23,'#ffffff','#d9dfe0',1,3);s.text(x+33,y+4,f'a{n}',18)

def button_panel(name,rotation,neutral=False):
 s=Draw();s.items.append('<g transform="translate(5 55) scale(.82)">')
 board_and_header(s,rotation);permanent_set(s,rotation,5,neutral=neutral)
 button_connections(s,rotation,active=not neutral)
 s.items.append('</g>');s.save(name)

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--breadboard-rotation',type=int,choices=(0,180),default=0)
 args=parser.parse_args();rot=args.breadboard_rotation
 overview(rot)
 for name,stage in [('wire_01_resistors',1),('wire_02_jumpers_switch',2),('wire_03_jumper_common',3),('wire_04_jumpers_rgb',4)]:normal_panel(name,rot,stage)
 identify(rot);button_panel('wire_06_button',rot);button_panel('wire_07_done',rot,True)
