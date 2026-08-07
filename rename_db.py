import sys, os, shutil
sys.stdout.reconfigure(encoding='utf-8')
src = '/PROJECT/vaultbase/manager-work/src-tauri/src/database.rs'
bak = '/PROJECT/vaultbase/manager-work/src-tauri/src/database.rs.bak'
if os.path.exists(src):
    shutil.move(src, bak)
    print('Renamed database.rs -> database.rs.bak')
else:
    print('database.rs not found (already moved?)')
db_dir = '/PROJECT/vaultbase/manager-work/src-tauri/src/database'
mod_rs = db_dir + '/mod.rs'
print('database/ dir exists:', os.path.isdir(db_dir))
print('mod.rs exists:', os.path.isfile(mod_rs))
files = os.listdir(db_dir)
print('Files in database/:', sorted(files))
