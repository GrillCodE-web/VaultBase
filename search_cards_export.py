import sys, os
os.chdir(r'C:\PROJECT\vaultbase\manager-work')
with open('src/pages/Cards.jsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()
kw = ['Export', 'handleExport', 'ph-actions', 'Download', 'FileText', 'FileDown']
for i, line in enumerate(lines, 1):
    if any(k in line for k in kw):
        sys.stdout.buffer.write(f'{i}: {line.rstrip()[:140]}\n'.encode('utf-8'))
