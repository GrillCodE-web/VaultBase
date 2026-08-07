import sys
sys.stdout.reconfigure(encoding='utf-8')
with open('/PROJECT/vaultbase/manager-work/src-tauri/src/database.rs', encoding='utf-8') as f:
    lines = f.readlines()
print(f'Total lines: {len(lines)}')
for i, l in enumerate(lines, 1):
    s = l.strip()
    if (s.startswith('pub fn ') or s.startswith('fn ') or 
        s.startswith('impl ') or s.startswith('pub async fn ') or
        s.startswith('async fn ') or s.startswith('// ===') or
        s.startswith('// ---') or s.startswith('// ────') or
        s.startswith('// ──')):
        print(f'{i}: {s[:90]}')
