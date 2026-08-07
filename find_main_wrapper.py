import sys
sys.stdout.reconfigure(encoding='utf-8')
base = 'C:/PROJECT/vaultbase/manager-work/src'
import os
for root, dirs, files in os.walk(base):
    for f in files:
        if not f.endswith('.css'): continue
        path = os.path.join(root, f)
        with open(path, encoding='utf-8') as fp:
            lines = fp.readlines()
        for i, l in enumerate(lines, 1):
            if 'main-content-wrapper' in l or 'main-content-scroll' in l or 'app-container' in l:
                print(f'{path}:{i}: {l.rstrip()[:100]}')
