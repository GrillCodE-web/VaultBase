import os
import paramiko
import time

HOST = os.environ.get('VAULTBASE_DEPLOY_HOST')
USER = os.environ.get('VAULTBASE_DEPLOY_USER', 'deploy')
PASS = os.environ.get('VAULTBASE_DEPLOY_PASS')
KEY_PATH = os.environ.get('VAULTBASE_DEPLOY_KEY')
PROJECT_ROOT = os.environ.get(
    'VAULTBASE_PROJECT_ROOT',
    os.path.dirname(os.path.abspath(__file__)),
)

if not HOST:
    raise SystemExit('VAULTBASE_DEPLOY_HOST is not set. Refusing to deploy.')
if not PASS and not KEY_PATH:
    raise SystemExit('Set VAULTBASE_DEPLOY_KEY (preferred) or VAULTBASE_DEPLOY_PASS.')

import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

def ssh_exec(client, cmd, timeout=30):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

def upload_file(sftp, local_path, remote_path):
    sftp.put(local_path, remote_path)
    print(f'  Uploaded: {remote_path}')

client = paramiko.SSHClient()
client.load_system_host_keys()
client.set_missing_host_key_policy(paramiko.RejectPolicy())
if KEY_PATH:
    client.connect(HOST, username=USER, key_filename=KEY_PATH, timeout=20)
else:
    client.connect(HOST, username=USER, password=PASS, timeout=20)
sftp = client.open_sftp()

SERVER_SRC = os.path.join(PROJECT_ROOT, 'cc-sync-server')

print('[1/5] Uploading server files...')
upload_file(sftp, os.path.join(SERVER_SRC, 'index.js'), '/opt/cc-sync-server/index.js')
upload_file(sftp, os.path.join(SERVER_SRC, 'admin', 'index.html'), '/opt/cc-sync-server/admin/index.html')
upload_file(sftp, os.path.join(SERVER_SRC, 'public', 'download.html'), '/opt/cc-sync-server/public/download.html')

print('[2/5] Restarting sync server...')
out, err = ssh_exec(client, 'cd /opt/cc-sync-server && pm2 restart cc-sync-server')
print(f'  pm2: {out[:200]}')

print('[3/5] Setting up nginx for pub-www.otpmanager.pro...')

nginx_conf = r"""server {
    listen 80;
    server_name pub-www.otpmanager.pro;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name pub-www.otpmanager.pro;

    ssl_certificate     /etc/letsencrypt/live/pub-www.otpmanager.pro/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pub-www.otpmanager.pro/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    add_header X-Robots-Tag "noindex, nofollow" always;
    add_header X-Content-Type-Options nosniff always;

    root /opt/cc-sync-server/public;
    index download.html;

    location / {
        try_files $uri $uri/ /download.html;
    }

    location ~* \.(html|css|js|ico|png|jpg|svg|woff2?)$ {
        expires 1h;
        add_header Cache-Control "public, max-age=3600";
    }
}
"""

cmd_write_conf = f"cat > /etc/nginx/sites-available/pub-vaultbase <<'NGINX_EOF'\n{nginx_conf}\nNGINX_EOF"
out, err = ssh_exec(client, cmd_write_conf)
print(f'  write conf: {out or "ok"} {err or ""}')

out, err = ssh_exec(client, 'ln -sf /etc/nginx/sites-available/pub-vaultbase /etc/nginx/sites-enabled/pub-vaultbase 2>&1 || true')
print(f'  symlink: {out or "ok"}')

print('[4/5] Getting SSL certificate for pub-www.otpmanager.pro...')
out, err = ssh_exec(client, 
    'certbot certonly --nginx -d pub-www.otpmanager.pro --non-interactive --agree-tos --email admin@otpmanager.pro 2>&1 || true',
    timeout=120
)
print(f'  certbot: {out[:400]}')
if err:
    print(f'  certbot err: {err[:200]}')

print('[5/5] Reloading nginx...')
out, err = ssh_exec(client, 'nginx -t 2>&1 && nginx -s reload 2>&1')
print(f'  nginx: {out[:200]}')
if err:
    print(f'  nginx err: {err[:200]}')

print('\nChecking status...')
out, err = ssh_exec(client, 'pm2 list 2>&1 | grep cc-sync')
print(f'  PM2: {out}')

out, err = ssh_exec(client, 'curl -s -o /dev/null -w "%{http_code}" http://pub-www.otpmanager.pro/ 2>&1 || echo "no route"')
print(f'  pub-www HTTP: {out}')

sftp.close()
client.close()
print('\nDeploy complete.')
