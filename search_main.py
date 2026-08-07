import sys
sys.stdout.reconfigure(encoding='utf-8')
with open('/PROJECT/vaultbase/manager-work/src-tauri/src/main.rs', encoding='utf-8') as f:
    lines = f.readlines()
print(f'Total lines: {len(lines)}')
for i, l in enumerate(lines, 1):
    s = l.strip()
    if 'take_card' in s or 'create_order' in s or 'emit' in s or 'admin_notif' in s:
        print(f'{i}: {s[:100]}')
