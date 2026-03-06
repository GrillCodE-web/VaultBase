#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# CC Manager Sync Server — Full Auto-Deploy
# Cloudflare Proxy mode — no certbot needed, Cloudflare handles HTTPS
#
# Usage:   bash deploy.sh
# Requires: sshpass  (macOS: brew install hudochenkov/sshpass/sshpass)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

VPS_IP="159.198.47.15"
VPS_USER="root"
VPS_PASS="sUI9qkKVq5O10tH1p8"
REMOTE_DIR="/opt/cc-manager-server"
DOMAIN="api.eulivehub.com"
APP_PORT="3000"

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; C='\033[0;36m'; NC='\033[0m'; B='\033[1m'
log()  { echo -e "${G}  ✓${NC}  $1"; }
info() { echo -e "${Y}  →${NC}  $1"; }
err()  { echo -e "${R}  ✗${NC}  $1"; exit 1; }
step() { echo -e "\n${B}${C}━━━  $1  ━━━${NC}"; }

ssh_run() {
  sshpass -p "$VPS_PASS" ssh \
    -o StrictHostKeyChecking=no \
    -o ConnectTimeout=20 \
    -o ServerAliveInterval=30 \
    "${VPS_USER}@${VPS_IP}" "$@"
}

scp_push() {
  sshpass -p "$VPS_PASS" scp \
    -o StrictHostKeyChecking=no \
    -r "$1" "${VPS_USER}@${VPS_IP}:$2"
}

# ── Pre-flight ────────────────────────────────────────────────────────────────
step "Pre-flight checks"

command -v sshpass >/dev/null 2>&1 || {
  echo -e "\n  ${R}sshpass not installed.${NC}"
  echo "  macOS:  brew install hudochenkov/sshpass/sshpass"
  echo "  Ubuntu: sudo apt-get install -y sshpass"
  err "Install sshpass first"
}
log "sshpass found"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$SCRIPT_DIR/index.js" ]]        || err "Run from server directory (index.js not found)"
[[ -f "$SCRIPT_DIR/remote-setup.sh" ]] || err "remote-setup.sh not found in server directory"
log "Server files: $SCRIPT_DIR"

info "Testing SSH to $VPS_IP..."
ssh_run "echo ok" >/dev/null 2>&1 || err "SSH failed — check IP/password"
log "SSH OK"

# ── Generate secrets ──────────────────────────────────────────────────────────
step "Generating secrets"
SERVER_SECRET=$(openssl rand -hex 32)
ADMIN_PASS=$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 20)
log "SERVER_SECRET generated"
log "ADMIN_PASS generated"

# ── Upload all server files ───────────────────────────────────────────────────
step "Uploading files to VPS"
ssh_run "mkdir -p ${REMOTE_DIR}"
scp_push "${SCRIPT_DIR}/." "${REMOTE_DIR}/"
log "Files uploaded → ${REMOTE_DIR}"

# ── Run the remote setup script ───────────────────────────────────────────────
step "Remote provisioning (takes ~3 min on fresh server)"
info "Running remote-setup.sh on VPS..."
echo ""

ssh_run "chmod +x ${REMOTE_DIR}/remote-setup.sh && \
  bash ${REMOTE_DIR}/remote-setup.sh \
    '${REMOTE_DIR}' \
    '${DOMAIN}' \
    '${APP_PORT}' \
    '${SERVER_SECRET}' \
    '${ADMIN_PASS}'"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${B}${G}┌─────────────────────────────────────────────────────────────┐${NC}"
echo -e "${B}${G}│   ✅  DEPLOYED: CC Manager Sync Server                       │${NC}"
echo -e "${B}${G}└─────────────────────────────────────────────────────────────┘${NC}"
echo ""
echo -e "  ${B}API URL       ${NC}  https://${DOMAIN}"
echo -e "  ${B}Admin Panel   ${NC}  https://${DOMAIN}/admin"
echo -e "  ${B}Admin Login   ${NC}  admin  /  ${Y}${ADMIN_PASS}${NC}"
echo ""
echo -e "  ${B}SERVER_SECRET ${NC}  ${C}${SERVER_SECRET}${NC}"
echo ""
echo -e "${Y}  ⚠  SAVE THESE CREDENTIALS — won't be shown again!${NC}"
echo ""
echo -e "  ${B}┌─ One step in Cloudflare Dashboard (if not done yet) ────────┐${NC}"
echo -e "  ${B}│${NC}  eulivehub.com → SSL/TLS → Overview                        ${B}│${NC}"
echo -e "  ${B}│${NC}  ${C}Set encryption mode to \"Full\"${NC}  (not Flexible, not Off)   ${B}│${NC}"
echo -e "  ${B}└────────────────────────────────────────────────────────────┘${NC}"
echo ""
echo -e "  ${B}Useful commands:${NC}"
echo -e "  ${G}ssh root@${VPS_IP} 'pm2 status'${NC}"
echo -e "  ${G}ssh root@${VPS_IP} 'pm2 logs cc-manager-server --lines 50'${NC}"
echo -e "  ${G}ssh root@${VPS_IP} 'pm2 restart cc-manager-server'${NC}"
echo ""
echo -e "  ${B}Health check:${NC}"
echo -e "  ${G}curl https://${DOMAIN}/${NC}"
echo ""
