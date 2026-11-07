from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import math
R=Path(__file__).resolve().parents[1];R.joinpath('assets').mkdir(exist_ok=True)
font='/System/Library/Fonts/Supplemental/Arial.ttf';bold='/System/Library/Fonts/Supplemental/Arial Bold.ttf'
def f(n,b=False):return ImageFont.truetype(bold if b else font,n)
im=Image.new('RGB',(1280,720),'#08131e');d=ImageDraw.Draw(im)
d.text((42,28),'PATIENT MONITOR',font=f(25,True),fill='#a4bac9');d.text((1005,30),'DEMO DATA',font=f(21),fill='#718b9d')
for x,label,value,col in [(40,'HR','72','#58ef96'),(450,'SpO2','97','#56d9f6'),(860,'TEMP','36.4','#ffd17b')]:
 d.rounded_rectangle((x,83,x+380,300),radius=20,fill='#102432')
 d.text((x+23,102),label,font=f(37,True),fill=col);d.text((x+22,147),value,font=f(111,True),fill=col)
 d.text((x+272,258),('bpm' if label=='HR' else '%' if label=='SpO2' else 'C'),font=f(24),fill=col)
d.text((45,332),'PLETH',font=f(22),fill='#7399a7')
for y in range(375,541,33):d.line((42,y,1240,y),fill='#1b313f',width=1)
for x in range(42,1241,46):d.line((x,375,x,540),fill='#1b313f',width=1)
p=[]
for x in range(42,1241):
 t=((x-42)%212)/212
 v=math.exp(-((t-.19)/.06)**2)*.85+math.exp(-((t-.38)/.10)**2)*.29
 p.append((x,515-v*124))
d.line(p,fill='#55d9f4',width=5)
for i,word in enumerate(['EPI','AMIO','SHOCK','AIRWAY','ROSC','MARK']):
 x=40+i*204;col='#a84a33' if word=='MARK' else '#244153'
 d.rounded_rectangle((x,588,x+184,679),radius=13,fill=col,outline='#3f6073',width=2)
 d.text((x+92,632),word,font=f(28,True),fill='#e8f3f8',anchor='mm')
im.save(R/'assets/monitor_ui.png')
print('Wrote monitor UI texture')
