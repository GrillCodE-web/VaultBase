import paramiko, sys, io, time, os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HOST = os.environ.get('VAULTBASE_DEPLOY_HOST')
USER = os.environ.get('VAULTBASE_DEPLOY_USER', 'deploy')
PASS = os.environ.get('VAULTBASE_DEPLOY_PASS')
KEY_PATH = os.environ.get('VAULTBASE_DEPLOY_KEY')

if not HOST:
    raise SystemExit('VAULTBASE_DEPLOY_HOST is not set. Refusing to deploy.')
if not PASS and not KEY_PATH:
    raise SystemExit('Set VAULTBASE_DEPLOY_KEY (preferred) or VAULTBASE_DEPLOY_PASS.')

def ssh_exec(client, cmd, timeout=60):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

client = paramiko.SSHClient()
client.load_system_host_keys()
client.set_missing_host_key_policy(paramiko.RejectPolicy())
if KEY_PATH:
    client.connect(HOST, username=USER, key_filename=KEY_PATH, timeout=20)
else:
    client.connect(HOST, username=USER, password=PASS, timeout=20)

print('[1] Creating HTTP-only nginx config for pub-www.otpmanager.pro...')
http_conf = """server {
    listen 80;
    server_name pub-www.otpmanager.pro;
    root /opt/cc-sync-server/public;
    index download.html;
    location / {
        try_files $uri $uri/ /download.html;
    }
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
}
"""
out, err = ssh_exec(client, f"cat > /etc/nginx/sites-available/pub-vaultbase <<'NGINX_EOF'\n{http_conf}\nNGINX_EOF")
print(f'  write: {out or "ok"} {err[:100] if err else ""}')

out, err = ssh_exec(client, 'ln -sf /etc/nginx/sites-available/pub-vaultbase /etc/nginx/sites-enabled/pub-vaultbase 2>&1 || true')
print(f'  symlink: {out or "ok"}')

out, err = ssh_exec(client, 'nginx -t 2>&1 && nginx -s reload 2>&1')
print(f'  nginx test+reload: {out[:300]}')
if err:
    print(f'  err: {err[:200]}')

print('\n[2] Getting SSL cert for pub-www.otpmanager.pro...')
time.sleep(2)
out, err = ssh_exec(client, 
    'certbot certonly --nginx -d pub-www.otpmanager.pro --non-interactive --agree-tos --email admin@otpmanager.pro 2>&1',
    timeout=120
)
print(f'  certbot: {out[:600]}')

print('\n[3] Writing HTTPS nginx config...')
https_conf = """server {
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
    add_header Access-Control-Allow-Origin "*" always;

    root /opt/cc-sync-server/public;
    index download.html;

    location / {
        try_files $uri $uri/ /download.html;
    }

    location ~* \\.(html|css|js|ico|png|jpg|svg|woff2?)$ {
        expires 1h;
        add_header Cache-Control "public, max-age=3600";
    }
}
"""
out, err = ssh_exec(client, f"cat > /etc/nginx/sites-available/pub-vaultbase <<'NGINX_EOF'\n{https_conf}\nNGINX_EOF")
print(f'  write HTTPS conf: {out or "ok"}')

out, err = ssh_exec(client, 'nginx -t 2>&1 && nginx -s reload 2>&1')
print(f'  nginx reload: {out[:300]}')
if err:
    print(f'  err: {err[:200]}')

print('\n[4] Testing...')
time.sleep(3)
out, err = ssh_exec(client, 'curl -sk -o /dev/null -w "%{http_code}" https://pub-www.otpmanager.pro/ 2>&1 || echo "no route"')
print(f'  HTTPS status: {out}')

out, err = ssh_exec(client, 'curl -sk https://pub-www.otpmanager.pro/ 2>&1 | head -5')
print(f'  Response preview: {out[:200]}')

client.close()
print('\nDone.')
