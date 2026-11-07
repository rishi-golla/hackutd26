import sys
from pathlib import Path

# Make `from lib import dsp` work no matter where pytest is started.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
