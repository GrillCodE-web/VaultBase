import sys, os
sys.stdout.reconfigure(encoding='utf-8')

# Audit database layer
db_dir = 'C:/PROJECT/vaultbase/manager-work/src-tauri/src/database'
main_rs = 'C:/PROJECT/vaultbase/manager-work/src-tauri/src/main.rs'

checks = {
    'WAL mode': False,
    'rate_limit on take_card': False,
    'session invalidation on password change': False,
    'auto cleanup sessions': False,
    'connection pool size': False,
    'anomaly detection': False,
}

for fname in os.listdir(db_dir):
    path = os.path.join(db_dir, fname)
    with open(path, encoding='utf-8') as f:
        content = f.read()
    if 'WAL' in content or 'journal_mode' in content:
        checks['WAL mode'] = True
    if 'cleanup_expired' in content or 'DELETE FROM user_sessions' in content and 'expires_at' in content:
        checks['auto cleanup sessions'] = True
    if 'pool_size' in content or 'max_size' in content:
        checks['connection pool size'] = True

with open(main_rs, encoding='utf-8') as f:
    main = f.read()

if 'take_card' in main and 'rate_limit' in main.lower():
    checks['rate_limit on take_card'] = True
if 'change_own_password' in main and 'DELETE FROM user_sessions' in main:
    checks['session invalidation on password change'] = True
if 'anomaly' in main.lower() or 'flood' in main.lower():
    checks['anomaly detection'] = True

print('=== SECURITY / STABILITY AUDIT ===')
for k, v in checks.items():
    status = '✅' if v else '❌ MISSING'
    print(f'  {status}  {k}')
