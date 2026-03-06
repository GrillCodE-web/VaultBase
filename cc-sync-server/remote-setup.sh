#!/usr/bin/env bash
# Runs ON the VPS. Called by deploy.sh after upload.
# Args: $1=REMOTE_DIR $2=DOMAIN $3=APP_PORT $4=SERVER_SECRET $5=ADMIN_PASS
set -euo pipefail

REMOTE_DIR="$1"
DOMAIN="$2"
APP_PORT="$3"
SERVER_SECRET="$4"
ADMIN_PASS="$5"

SSL_DIR="/etc/nginx/ssl"
CERT="${SSL_DIR}/origin.crt"
KEY="${SSL_DIR}/origin.key"

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${G}  [✓]${NC}  $1"; }
info() { echo -e "${Y}  [→]${NC}  $1"; }
fail() { echo -e "${R}  [✗]${NC}  $1"; exit 1; }

export DEBIAN_FRONTEND=noninteractive

# ── 1. Packages ───────────────────────────────────────────────────────────────
info "apt update + install nginx, ufw, curl, openssl..."
apt-get update -qq
apt-get install -y -qq curl nginx ufw openssl
ok "Packages ready"

# ── 2. Node.js 20 ─────────────────────────────────────────────────────────────
CURRENT_NODE=""
command -v node &>/dev/null && \
  CURRENT_NODE=$(node -e 'process.stdout.write(process.version.slice(1).split(".")[0])')
if [ "$CURRENT_NODE" != "20" ] && [ "$CURRENT_NODE" != "21" ] && [ "$CURRENT_NODE" != "22" ]; then
  info "Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x -o /tmp/nodesource_setup.sh
  bash /tmp/nodesource_setup.sh
  apt-get install -y nodejs
  ok "Node.js $(node -v) installed"
else
  ok "Node.js $(node -v) already present"
fi

# ── 3. PM2 ────────────────────────────────────────────────────────────────────
command -v pm2 &>/dev/null || { info "Installing PM2..."; npm install -g pm2; }
ok "PM2 $(pm2 -v)"

# ── 4. npm install ────────────────────────────────────────────────────────────
info "npm install..."
cd "${REMOTE_DIR}"
mkdir -p logs
mkdir -p "${REMOTE_DIR}/public/releases"
npm config set fetch-timeout 300000
npm config set fetch-retry-mintimeout 20000
npm config set fetch-retry-maxtimeout 120000
npm config set fetch-retries 5
for attempt in 1 2 3; do
  info "npm install attempt ${attempt}/3..."
  npm install --omit=dev && { ok "npm install done"; break; } || {
    [ $attempt -eq 3 ] && fail "npm install failed after 3 attempts"
    info "Retrying in 15s..."; sleep 15
  }
done

# ── 5. .env ───────────────────────────────────────────────────────────────────
cat > "${REMOTE_DIR}/.env" <<ENV
SERVER_SECRET=${SERVER_SECRET}
ADMIN_USER=admin
ADMIN_PASS=${ADMIN_PASS}
PORT=${APP_PORT}
DB_PATH=${REMOTE_DIR}/data.db
ENV
ok ".env written"

# ── 6. Self-signed TLS cert ───────────────────────────────────────────────────
# Cloudflare "Full" mode accepts self-signed certs on the origin.
# Only "Full Strict" requires a CA-signed cert.
info "Generating self-signed TLS certificate (10 years)..."
mkdir -p "${SSL_DIR}"
openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout "${KEY}" -out "${CERT}" -days 3650 \
  -subj "/C=US/O=CCManager/CN=${DOMAIN}" \
  -addext "subjectAltName=DNS:${DOMAIN}" 2>/dev/null
chmod 600 "${KEY}"
ok "TLS cert → ${CERT}"

# ── 7. UFW ────────────────────────────────────────────────────────────────────
info "UFW: SSH everywhere; 80+443 from Cloudflare only..."
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
for cidr in \
  173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 \
  141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 \
  197.234.240.0/22 198.41.128.0/17 162.158.0.0/15  104.16.0.0/13 \
  104.24.0.0/14   172.64.0.0/13   131.0.72.0/22; do
  ufw allow from "${cidr}" to any port 80  proto tcp >/dev/null
  ufw allow from "${cidr}" to any port 443 proto tcp >/dev/null
done
ufw --force enable >/dev/null
ok "UFW active — 22 open; 80+443 open for Cloudflare only"

# ── 8. Nginx ──────────────────────────────────────────────────────────────────
info "Writing nginx config (443 HTTPS + 80→443 redirect)..."

cat > "/etc/nginx/sites-available/${DOMAIN}" <<NGINX
# CC Manager — Cloudflare "Full" SSL mode
# Cloudflare → origin on HTTPS/443 (self-signed cert is OK for Full, not Strict)

server {
    listen 80  default_server;
    listen 443 default_server ssl;
    server_name _;
    ssl_certificate     ${CERT};
    ssl_certificate_key ${KEY};
    return 444;
}

server {
    listen 80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate     ${CERT};
    ssl_certificate_key ${KEY};
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;

    set_real_ip_from 173.245.48.0/20;
    set_real_ip_from 103.21.244.0/22;
    set_real_ip_from 103.22.200.0/22;
    set_real_ip_from 103.31.4.0/22;
    set_real_ip_from 141.101.64.0/18;
    set_real_ip_from 108.162.192.0/18;
    set_real_ip_from 190.93.240.0/20;
    set_real_ip_from 188.114.96.0/20;
    set_real_ip_from 197.234.240.0/22;
    set_real_ip_from 198.41.128.0/17;
    set_real_ip_from 162.158.0.0/15;
    set_real_ip_from 104.16.0.0/13;
    set_real_ip_from 104.24.0.0/14;
    set_real_ip_from 172.64.0.0/13;
    set_real_ip_from 131.0.72.0/22;
    real_ip_header CF-Connecting-IP;

    add_header X-Content-Type-Options  "nosniff"     always;
    add_header X-Frame-Options         "DENY"        always;
    add_header Referrer-Policy         "no-referrer" always;
    add_header Strict-Transport-Security "max-age=31536000" always;

    # Release file uploads — large body size, long timeout
    location /admin/upload {
        proxy_pass          http://127.0.0.1:${APP_PORT};
        proxy_http_version  1.1;
        proxy_set_header    Host              \$host;
        proxy_set_header    X-Real-IP         \$remote_addr;
        proxy_set_header    X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header    X-Forwarded-Proto \$scheme;
        proxy_set_header    CF-Connecting-IP  \$http_cf_connecting_ip;
        proxy_read_timeout  600s;
        proxy_connect_timeout 10s;
        client_max_body_size 600M;
        proxy_request_buffering off;
    }

    location / {
        proxy_pass          http://127.0.0.1:${APP_PORT};
        proxy_http_version  1.1;
        proxy_set_header    Host              \$host;
        proxy_set_header    X-Real-IP         \$remote_addr;
        proxy_set_header    X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header    X-Forwarded-Proto \$scheme;
        proxy_set_header    CF-Connecting-IP  \$http_cf_connecting_ip;
        proxy_read_timeout  30s;
        proxy_connect_timeout 5s;
        client_max_body_size 2M;
    }
}
NGINX

rm -f /etc/nginx/sites-enabled/default
ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
nginx -t || fail "Nginx config invalid"
systemctl enable nginx
systemctl restart nginx
ok "Nginx: HTTP→HTTPS redirect + HTTPS/443 with self-signed cert"

# ── 9. PM2 ────────────────────────────────────────────────────────────────────
info "Starting app with PM2..."
cd "${REMOTE_DIR}"
pm2 delete cc-manager-server 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save --force >/dev/null
pm2 startup systemd -u root --hp /root 2>&1 | grep "^sudo" | bash 2>/dev/null || true
systemctl enable pm2-root 2>/dev/null || true
ok "PM2 running + systemd auto-restart on reboot"

# ── 10. Health check ──────────────────────────────────────────────────────────
info "Health checks..."
HEALTHY=0
for i in $(seq 1 20); do
  curl -sf "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1 && { HEALTHY=1; break; }
  sleep 1
done
[ $HEALTHY -eq 1 ] && ok "App responding on :${APP_PORT}" || \
  echo "  ⚠  App not responding — check: pm2 logs cc-manager-server"

curl -skf "https://127.0.0.1/" -H "Host: ${DOMAIN}" >/dev/null 2>&1 && \
  ok "Nginx HTTPS responding on :443" || echo "  ⚠  Nginx 443 check failed"

echo ""
pm2 list | grep -E "name|cc-manager" | head -3
ok "Remote setup complete!"
echo ""
echo -e "${Y}  Set Cloudflare SSL/TLS to \"Full\" (not Flexible, not Full Strict)${NC}"
echo -e "  dash.cloudflare.com → eulivehub.com → SSL/TLS → Overview → Full"
