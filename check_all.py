import io
import os
import sys

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = os.environ.get('VAULTBASE_DEPLOY_HOST')
USER = os.environ.get('VAULTBASE_DEPLOY_USER', 'deploy')
PASS = os.environ.get('VAULTBASE_DEPLOY_PASS')
KEY_PATH = os.environ.get('VAULTBASE_DEPLOY_KEY')

ADMIN_URL = os.environ.get('VAULTBASE_ADMIN_URL')
ADMIN_USER = os.environ.get('VAULTBASE_ADMIN_USER')
ADMIN_PASS = os.environ.get('VAULTBASE_ADMIN_PASS')
API_HOST = os.environ.get('VAULTBASE_API_HOST')
PUBLIC_HOST = os.environ.get('VAULTBASE_PUBLIC_HOST')

if not HOST:
    raise SystemExit('VAULTBASE_DEPLOY_HOST is not set. Refusing to connect.')
if not PASS and not KEY_PATH:
    raise SystemExit('Set VAULTBASE_DEPLOY_KEY (preferred) or VAULTBASE_DEPLOY_PASS.')

client = paramiko.SSHClient()
client.load_system_host_keys()
client.set_missing_host_key_policy(paramiko.RejectPolicy())
if KEY_PATH:
    client.connect(HOST, username=USER, key_filename=KEY_PATH, timeout=20)
else:
    client.connect(HOST, username=USER, password=PASS, timeout=20)


def run(cmd, timeout=30):
    _, out, _ = client.exec_command(cmd, timeout=timeout)
    return out.read().decode('utf-8', 'replace').strip()


def run_authed(cmd, user, password, timeout=30):
    """Run curl with credentials fed through stdin (-K -) so they never
    appear in the remote process table."""
    stdin, out, _ = client.exec_command(cmd, timeout=timeout)
    stdin.write(f'user = "{user}:{password}"\n')
    stdin.flush()
    stdin.channel.shutdown_write()
    return out.read().decode('utf-8', 'replace').strip()


print('=== PM2 ===')
print(run('pm2 list 2>&1 | grep cc-sync'))

print('\n=== Admin panel (auth) ===')
if ADMIN_URL and ADMIN_USER and ADMIN_PASS:
    code = run_authed(
        f'curl -K - -sk -o /dev/null -w "%{{http_code}}" {ADMIN_URL}',
        ADMIN_USER,
        ADMIN_PASS,
    )
    print('HTTP:', code)
else:
    print('skipped (set VAULTBASE_ADMIN_URL, VAULTBASE_ADMIN_USER, VAULTBASE_ADMIN_PASS)')

print('\n=== Public releases API ===')
if API_HOST:
    print(run(f'curl -sk https://{API_HOST}/api/releases')[:300])
else:
    print('skipped (set VAULTBASE_API_HOST)')

print('\n=== Download page ===')
if PUBLIC_HOST:
    print(run(f'curl -sk https://{PUBLIC_HOST}/ | grep -o "<title>[^<]*"'))
    print('\n=== Download page SSL ===')
    print(run(f'curl -sk -I https://{PUBLIC_HOST}/ | head -5'))
else:
    print('skipped (set VAULTBASE_PUBLIC_HOST)')

client.close()
print('\nAll checks done.')
