# CC Manager — Sync Server

Node.js + Express sync server for CC Manager desktop app.
Stores ONLY hashes and licenses — zero card/personal data.

## Stack
- Node.js 20 LTS
- Express 4
- SQLite via better-sqlite3
- PM2 process manager
- Nginx reverse proxy
- Cloudflare proxy (Full SSL mode)

## Structure
```
cc-sync-server/
├── index.js              # Express app entry point
├── database.js           # SQLite + versioned migrations
├── middleware.js         # Bearer token + Basic auth
├── ecosystem.config.js   # PM2 config
├── deploy.sh             # Local deploy script (run from Mac)
├── remote-setup.sh       # Remote provisioning (runs on VPS)
├── .env.example          # Environment variables template
├── routes/
│   ├── activate.js       # POST /activate — HMAC license activation
│   ├── verify.js         # POST /verify — token validation
│   ├── footprint.js      # POST /footprint + POST /check
│   ├── version.js        # GET /version — latest app version
│   ├── update.js         # GET /update — Tauri updater JSON
│   ├── upload.js         # POST /admin/upload — release binary upload
│   └── admin-api.js      # /admin/api/* — admin REST endpoints
└── admin/
    └── index.html        # Admin SPA (Dashboard/Licenses/Footprints/Releases/Activity)
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /activate | — | Activate license with HMAC key |
| POST | /verify | Bearer | Verify token validity |
| POST | /footprint | Bearer | Save footprint hashes |
| POST | /check | Bearer | Cross-user footprint check |
| GET | /version | — | Latest app version |
| GET | /update | — | Tauri updater JSON |
| GET | /update/check | — | Human-readable update status |
| GET | /releases/:file | — | Download release binary |
| * | /admin/* | Basic Auth | Admin panel + API |

## Deploy (fresh VPS)

```bash
# Prerequisites on Mac
brew install hudochenkov/sshpass/sshpass

# Run deploy script
cd cc-sync-server
bash deploy.sh
```

Script will:
1. Generate SERVER_SECRET + ADMIN_PASS
2. Upload files to VPS via SCP
3. Install Node.js 20, PM2, nginx, UFW on VPS
4. Generate self-signed TLS cert
5. Configure nginx (HTTPS/443 + Cloudflare IP filtering)
6. Start app with PM2 + systemd autostart
7. Print credentials

## Post-deploy (Cloudflare)

Set SSL/TLS mode to **Full** (not Flexible, not Full Strict):
`dash.cloudflare.com → eulivehub.com → SSL/TLS → Overview → Full`

## Release Upload Flow (Tauri auto-update)

1. Build: `npm run tauri build -- --bundles updater`
2. Go to `https://api.eulivehub.com/admin` → Releases
3. Drag `.dmg.tar.gz` + paste `.sig` content → Publish
4. Clients auto-update on next app launch

## Local Dev

```bash
npm install
cp .env.example .env
# Edit .env — set SERVER_SECRET and ADMIN_PASS
npm run dev
```

## Environment Variables

```env
SERVER_SECRET=   # 64 hex chars (HMAC key for activation)
ADMIN_USER=admin
ADMIN_PASS=      # Admin panel password
PORT=3000
DB_PATH=./data.db
BASE_URL=https://api.eulivehub.com
RELEASES_DIR=./public/releases
```
