# VaultBase - deploy server from Windows over SSH key (OpenSSH ssh/scp).
#   ./deploy.ps1
$ErrorActionPreference = 'Stop'
$VPS_IP   = if ($env:VPS_IP)   { $env:VPS_IP }   else { '162.0.213.238' }
$VPS_USER = if ($env:VPS_USER) { $env:VPS_USER } else { 'root' }
$KEY      = if ($env:VPS_KEY)  { $env:VPS_KEY }  else { "$env:USERPROFILE\.ssh\vaultbase_vps" }
$REMOTE_DIR = '/opt/vaultbase-server'
$REMOTE     = "$VPS_USER@$VPS_IP"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$SSHOPT = @('-i', $KEY, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new')

$FILES = @(
  'package.json','database.js','socket.js','index.js','cache.js','auth.js',
  'middleware.js','rate-limit.js','alerts-engine.js','card-push.js','courier-tags.js',
  'ws-tauri.js',
  'routes/activate.js','routes/verify.js','routes/footprint.js','routes/version.js',
  'routes/update.js','routes/upload.js','routes/admin-api.js','routes/admin-auth.js',
  'routes/manager-api.js','routes/telemetry.js','routes/csp-report.js','routes/invite.js',
  'routes/sync.js','routes/worker-orders.js','routes/catalog.js','routes/bin.js',
  'admin/index.html','admin/login.html','public/landing.html','public/download.html'
)

Write-Host "== deploy -> ${REMOTE}:${REMOTE_DIR} ==" -ForegroundColor Cyan
foreach ($f in $FILES) {
  $local = Join-Path $here $f
  if (-not (Test-Path $local)) { Write-Host "  skip (missing): $f" -ForegroundColor Yellow; continue }
  $remotePath = "$REMOTE_DIR/$f"
  $remoteDir  = ($remotePath -replace '/[^/]+$','')
  & ssh @SSHOPT $REMOTE "mkdir -p '$remoteDir'" | Out-Null
  & scp @SSHOPT $local "${REMOTE}:$remotePath"
  if ($LASTEXITCODE -ne 0) { Write-Error "upload failed: $f"; exit 1 }
  Write-Host "  ok  $f" -ForegroundColor Green
}

$vendor = Join-Path $here 'admin/vendor'
if (Test-Path $vendor) {
  & ssh @SSHOPT $REMOTE "mkdir -p '$REMOTE_DIR/admin/vendor/fonts'" | Out-Null
  & scp @SSHOPT -r "$vendor" "${REMOTE}:$REMOTE_DIR/admin/"
  Write-Host '  ok  admin/vendor' -ForegroundColor Green
}

Write-Host '== restart systemd ==' -ForegroundColor Cyan
& ssh @SSHOPT $REMOTE 'systemctl restart vaultbase-server; sleep 2; systemctl is-active vaultbase-server'
Write-Host 'Done.' -ForegroundColor Green
