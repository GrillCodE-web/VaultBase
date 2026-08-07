import sys, os
sys.stdout.reconfigure(encoding='utf-8')
db_dir = '/PROJECT/vaultbase/manager-work/src-tauri/src/database'
remove = ['analytics.rs', 'cards.rs', 'imap.rs', 'migrations.rs',
          'misc.rs', 'orders.rs', 'profiles.rs', 'shops.rs', 'users.rs']
for name in remove:
    path = os.path.join(db_dir, name)
    if os.path.exists(path):
        os.remove(path)
        print(f'Removed: {name}')
print('Remaining files:', sorted(os.listdir(db_dir)))
