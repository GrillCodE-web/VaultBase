import subprocess, os
env = os.environ.copy()
env['PATH'] = r'C:\Users\user\AppData\Roaming\nvm\v20.19.0;' + env.get('PATH','')
r = subprocess.run(
    ['npm', 'install', 'jspdf', 'jspdf-autotable', '--save'],
    capture_output=True, text=True,
    cwd=r'C:\PROJECT\vaultbase\manager-work',
    env=env, shell=True
)
print('STDOUT:', r.stdout[-2000:] if r.stdout else '')
print('STDERR:', r.stderr[-2000:] if r.stderr else '')
print('RC:', r.returncode)
