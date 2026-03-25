#!/bin/bash
# Deploy cc-sync-server to api.eulivehub.com
# Run this from your terminal: bash deploy-server.sh
#
# Required environment variables:
#   VPS_HOST: VPS hostname (e.g., root@159.198.47.15)
#   VPS_PASS: SSH password or use SSH keys
#   VPS_SSH_KEY: (optional) Path to SSH private key

SERVER="${VPS_HOST:?VPS_HOST environment variable required (e.g., root@159.198.47.15)}"
PASS="${VPS_PASS:?VPS_PASS environment variable required}"
REMOTE_DIR="/opt/cc-sync-server"
LOCAL_DIR="$(dirname "$0")/cc-sync-server"

echo "=== Deploying cc-sync-server ==="

# 1. Sync files (exclude node_modules, db, .env, releases)
sshpass -p "$PASS" rsync -avz --progress \
  "$LOCAL_DIR/" \
  "$SERVER:$REMOTE_DIR/" \
  --exclude='node_modules' \
  --exclude='data.db' \
  --exclude='.env' \
  --exclude='public/releases/*'

echo "=== Files synced. Installing dependencies and restarting... ==="

# 2. Install deps and restart
sshpass -p "$PASS" ssh -o StrictHostKeyChecking=accept-new -o UpdateHostKeys=yes "$SERVER" << 'EOF'
  cd /opt/cc-sync-server
  npm install --production
  pm2 restart cc-sync-server 2>/dev/null || pm2 start index.js --name cc-sync-server
  pm2 status
  echo "=== Done ==="
EOF
