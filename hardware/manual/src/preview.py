"""Render chosen IDs into src/qa/preview without changing deliverable images."""
import runpy,sys
from pathlib import Path
d=runpy.run_path(str(Path(__file__).with_name('render_manual.py')),run_name='preview')
g=d['render'].__globals__;g['OUT']=Path(__file__).parent/'qa'/'preview';g['OUT'].mkdir(exist_ok=True)
ids=sys.argv[sys.argv.index('--')+1:];g['build_phone_layouts'](ids)
for n in ids:
 g['SCENES'][n][0]();g['render'](n)
