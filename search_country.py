import sys, os
os.chdir(r'C:\PROJECT\vaultbase\manager-work')
fp = 'src/pages/DashboardRedesigned.jsx'
with open(fp, 'r', encoding='utf-8') as f:
    lines = f.readlines()
kw = ['country', 'Country', 'geo', 'map', 'Map', 'stats', 'cardsByCountry', 'by_country']
for i, line in enumerate(lines, 1):
    if any(k in line for k in kw):
        sys.stdout.buffer.write(f'{i}: {line.rstrip()[:140]}\n'.encode('utf-8'))
