#!/usr/bin/env python3
import sys
print(f"Python {sys.version}")
try:
    from PIL import Image
    print("Pillow available")
except ImportError:
    print("Pillow NOT available - need to install")
    sys.exit(1)
