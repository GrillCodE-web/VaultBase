import sys
with open('src/pages/Profiles.jsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()
kw = ['selected', 'checkbox', 'Checkbox', 'toolbar', 'Toolbar', 'bulk', 'enrich', 'function Profiles', 'export default', 'handleDelete', 'selectedIdx', 'setSelected']
for i, line in enumerate(lines, 1):
    if any(k.lower() in line.lower() for k in kw):
        sys.stdout.buffer.write(f'{i}: {line.rstrip()[:140]}\n'.encode('utf-8'))
