import os, sys
kw = ['bulkEnrich', 'enrich_bin']
for root, dirs, files in os.walk('src'):
    for f in files:
        fp = os.path.join(root, f)
        try:
            with open(fp, 'r', encoding='utf-8') as fh:
                for i, line in enumerate(fh, 1):
                    if any(k in line for k in kw):
                        sys.stdout.buffer.write(f'{fp}:{i}: {line.rstrip()[:120]}\n'.encode('utf-8'))
        except:
            pass
