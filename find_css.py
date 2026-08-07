import sys, os
sys.stdout.reconfigure(encoding='utf-8')
base = 'C:/PROJECT/vaultbase/manager-work/src'
for root, dirs, files in os.walk(base):
    for f in files:
        if f.endswith('.css'):
            full = os.path.join(root, f)
            size = os.path.getsize(full)
            print(f'{size:8d} {full}')
