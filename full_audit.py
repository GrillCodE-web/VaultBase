import sys, os
sys.stdout.reconfigure(encoding='utf-8')

BASE = 'C:/PROJECT/vaultbase/manager-work/src'
RUST = 'C:/PROJECT/vaultbase/manager-work/src-tauri/src'

# ── React pages ───────────────────────────────────────────────
pages = []
for f in os.listdir(BASE + '/pages'):
    if f.endswith('.jsx'):
        path = BASE + '/pages/' + f
        size = os.path.getsize(path)
        with open(path, encoding='utf-8') as fp:
            lines = fp.readlines()
        pages.append((f, len(lines), size))

print('=== REACT PAGES ===')
for name, lines, size in sorted(pages, key=lambda x: -x[1]):
    print(f'  {lines:5d} lines  {size//1024:3d}KB  {name}')

# ── Rust commands ─────────────────────────────────────────────
print('\n=== RUST COMMANDS in main.rs ===')
with open(RUST + '/main.rs', encoding='utf-8') as f:
    main = f.readlines()
cmds = [l.strip() for l in main if l.strip().startswith('fn ') and 'tauri' not in l]
for c in cmds:
    print(f'  {c[:80]}')

# ── Dead / TODO ───────────────────────────────────────────────
print('\n=== TODOs / FIXMEs in Rust ===')
for root, dirs, files in os.walk(RUST):
    for fname in files:
        if not fname.endswith('.rs'): continue
        path = os.path.join(root, fname)
        with open(path, encoding='utf-8') as f:
            for i, line in enumerate(f, 1):
                if 'TODO' in line or 'FIXME' in line or 'unimplemented' in line or 'todo!' in line:
                    print(f'  {os.path.basename(path)}:{i}: {line.strip()[:90]}')

# ── Unused imports check in JSX ───────────────────────────────
print('\n=== LARGE JSX FILES (>500 lines) ===')
for name, lines, size in pages:
    if lines > 500:
        print(f'  ⚠️  {name}: {lines} lines — рассмотреть разбивку на компоненты')

# ── Database submodule sizes ──────────────────────────────────
print('\n=== DATABASE SUBMODULES ===')
db_dir = RUST + '/database'
for f in sorted(os.listdir(db_dir)):
    path = os.path.join(db_dir, f)
    with open(path, encoding='utf-8') as fp:
        lines = len(fp.readlines())
    print(f'  {lines:5d} lines  {f}')

# ── Check settings features ───────────────────────────────────
print('\n=== SETTINGS FEATURES CHECK ===')
with open(BASE + '/pages/Settings.jsx', encoding='utf-8') as f:
    settings = f.read()
features = {
    'Dark mode toggle': 'dark' in settings.lower() or 'theme' in settings.lower(),
    'Screen capture toggle': 'content_protection' in settings or 'screenshot' in settings.lower(),
    'Session timeout config': 'timeout' in settings.lower() or 'idle' in settings.lower(),
    '2FA toggle': '2fa' in settings.lower() or 'totp' in settings.lower(),
    'Session cleanup toggle': 'cleanup' in settings.lower() or 'expired' in settings.lower(),
    'Operator limits UI': 'limit' in settings.lower() and 'daily' in settings.lower(),
    'Panic password UI': 'panic' in settings.lower() or 'duress' in settings.lower(),
}
for k, v in features.items():
    status = '✅' if v else '❌'
    print(f'  {status} {k}')
