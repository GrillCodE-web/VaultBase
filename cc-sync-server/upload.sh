#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
#  VaultBase — Upload changed files via sshpass+scp
#  macOS M1 compatible
#
#  Required environment variables:
#    VPS_IP: VPS IP address
#    VPS_USER: SSH username (default: root)
#    VPS_PASS: SSH password
# ──────────────────────────────────────────────────────────

VPS_IP="${VPS_IP:?VPS_IP environment variable required}"
VPS_USER="${VPS_USER:-root}"
VPS_PASS="${VPS_PASS:?VPS_PASS environment variable required}"
REMOTE="$VPS_USER@$VPS_IP"
REMOTE_DIR="/opt/vaultbase-server"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; C='\033[0;36m'; B='\033[1m'; NC='\033[0m'
ok()   { echo -e "${G}  ✓${NC}  $1"; }
info() { echo -e "${Y}  →${NC}  $1"; }
err()  { echo -e "${R}  ✗${NC}  $1"; exit 1; }

# ── check sshpass installed ──────────────────────────────
if ! command -v sshpass >/dev/null 2>&1; then
  err "sshpass not found. Install with: brew install hudochenkov/sshpass/sshpass"
fi

SCP="sshpass -p '$VPS_PASS' scp -o StrictHostKeyChecking=accept-new -o UpdateHostKeys=yes"
SSH="sshpass -p '$VPS_PASS' ssh -o StrictHostKeyChecking=accept-new -o UpdateHostKeys=yes $REMOTE"

echo ""
echo -e "${B}${C}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${B}${C}║     VaultBase — Deploy  $(date '+%Y-%m-%d %H:%M')       ║${NC}"
echo -e "${B}${C}╚══════════════════════════════════════════════════╝${NC}"

# ── files to upload ─────────────────────────────────────
FILES=(
  "package.json"
  "database.js"
  "socket.js"
  "index.js"
  "cache.js"
  "auth.js"
  "middleware.js"
  "rate-limit.js"
  "alerts-engine.js"
  "card-push.js"
  "courier-tags.js"
  "ws-tauri.js"
  "routes/activate.js"
  "routes/verify.js"
  "routes/footprint.js"
  "routes/version.js"
  "routes/update.js"
  "routes/upload.js"
  "routes/admin-api.js"
  "routes/admin-auth.js"
  "routes/manager-api.js"
  "routes/telemetry.js"
  "routes/csp-report.js"
  "routes/invite.js"
  "routes/sync.js"
  "routes/catalog.js"
  "routes/bin.js"
  "admin/index.html"
  "admin/login.html"
  "public/landing.html"
  "public/download.html"
)

echo ""
echo -e "${B}${C}━━━  Uploading files  ━━━${NC}"

for f in "${FILES[@]}"; do
  LOCAL="$SCRIPT_DIR/$f"
  REMOTE_PATH="$REMOTE_DIR/$f"

  if [ ! -f "$LOCAL" ]; then
    echo -e "${R}  ✗${NC}  $f — not found locally, skipping"
    continue
  fi

  # ensure remote directory exists
  REMOTE_SUBDIR="$(dirname "$REMOTE_PATH")"
  eval "$SSH 'mkdir -p $REMOTE_SUBDIR'" 2>/dev/null

  eval "$SCP '$LOCAL' '$REMOTE:$REMOTE_PATH'"
  ok "$f"
done

# ── restart app ─────────────────────────────────────────
echo ""
echo -e "${B}${C}━━━  Restarting PM2  ━━━${NC}"
eval "$SSH 'pm2 restart vaultbase-server 2>/dev/null || pm2 restart all'"
ok "App restarted"

echo ""
ok "Done. https://api.eulivehub.com"
echo ""
