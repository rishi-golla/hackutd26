from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import json,sys
R=Path(__file__).resolve().parents[1]
font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',27)
ids=sys.argv[1:] or ['relay_lcd_labeled','medkit_labeled']
for name in ids:
 p=R/(name+'.png');im=Image.open(p).convert('RGB');draw=ImageDraw.Draw(im)
 records=json.loads((R/'qa'/(name+'_callouts.json')).read_text())
 for c in records:
  x,y=c['xy'];w=c['width'];h=31*(c['text'].count('\n')+1)+25;side=c['side'];tip=c['target']
  edge={'bottom':(x+w/2,y+h),'top':(x+w/2,y),'left':(x,y+h/2),'right':(x+w,y+h/2)}[side]
  elbow=(edge[0],(edge[1]+tip[1])/2) if side in ('top','bottom') else ((edge[0]+tip[0])/2,edge[1])
  draw.line([edge,elbow,tuple(tip)],fill='#30373e',width=3,joint='curve');draw.ellipse((tip[0]-4,tip[1]-4,tip[0]+4,tip[1]+4),fill='#ff5a36')
 for c in records:
  x,y=c['xy'];w=c['width'];h=31*(c['text'].count('\n')+1)+25
  draw.rounded_rectangle((x,y,x+w,y+h),radius=9,fill='#ffffff',outline='#cfd7de',width=2)
  draw.multiline_text((x+13,y+10),c['text'],font=font,fill='#252b30',spacing=5)
 if name=='monitor_relay_oled_closeup':
  bar=json.loads((R/'qa/oled_scale_bar.json').read_text());x,y=bar['xy'];w=bar['pixels']
  draw.rounded_rectangle((x-18,y-18,x+w+18,y+72),radius=9,fill='white',outline='#cfd7de',width=2)
  draw.line([(x,y),(x+w,y)],fill='#252b30',width=6)
  for xx in [x,x+w]:draw.line([(xx,y-9),(xx,y+9)],fill='#252b30',width=4)
  draw.text((x+w/2,y+20),'20 mm',font=font,fill='#252b30',anchor='mt')
 im.save(p);print('Annotated',p)
