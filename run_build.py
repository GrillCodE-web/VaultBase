import subprocess, os
r = subprocess.run(
    ['npx', 'vite', 'build'],
    capture_output=True, text=True,
    cwd=r'C:\PROJECT\vaultbase\manager-work',
    shell=True,
    timeout=120
)
print('STDOUT:', r.stdout[-3000:] if r.stdout else '')
print('STDERR:', r.stderr[-3000:] if r.stderr else '')
print('RC:', r.returncode)
