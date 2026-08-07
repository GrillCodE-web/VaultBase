import sys, os
os.chdir(r'C:\PROJECT\vaultbase\manager-work')
for root, dirs, files in os.walk('src'):
    for f in files:
        fp = os.path.join(root, f)
        try:
            with open(fp, 'r', encoding='utf-8') as fh:
                for i, line in enumerate(fh, 1):
                    if 'heatmap' in line.lower() or 'get_heatmap' in line:
                        sys.stdout.buffer.write(f'{fp}:{i}: {line.rstrip()[:140]}\n'.encode('utf-8'))
        except:
            pass
