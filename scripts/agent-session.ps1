<#
VaultBase — параллельные сессии агентов (подробности: PARALLEL_WORK.md).

Создать worktree для потока (ветка agent/<stream> от main):
  .\scripts\agent-session.ps1 backend
  .\scripts\agent-session.ps1 frontend
  .\scripts\agent-session.ps1 backend -Install     # + npm ci внутри worktree

Удалить worktree и ветку после слияния (ветка удалится только если слита):
  .\scripts\agent-session.ps1 backend -Remove
  .\scripts\agent-session.ps1 frontend -Remove
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('backend', 'frontend')][string]$Stream,
  [switch]$Install,
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$wt = Join-Path (Split-Path $repo -Parent) "agent-$Stream"
$branch = "agent/$Stream"

if ($Remove) {
  git -C $repo worktree remove $wt
  git -C $repo branch -d $branch
  Write-Host "Removed: $wt (branch $branch)"
  exit 0
}

if (Test-Path $wt) {
  Write-Error "Worktree уже существует: $wt. Если он от мёртвой сессии — сначала -Remove (коммиты сохранятся в ветке $branch, пока она не слита)."
}

git -C $repo worktree add -b $branch $wt main
if ($Install) { npm ci --prefix $wt }

Write-Host ""
Write-Host "OK: $wt  (ветка $branch)"
Write-Host "Следующие шаги для сессии агента, открытой в этой папке:"
Write-Host "  1) npm ci                                   # без него не работает pre-commit (lint-staged)"
Write-Host "  2) прочитать AGENTS.md и PARALLEL_WORK.md"
Write-Host "  3) заклеймить пункт в MASTER_CHECKLIST.md по протоколу (только свой поток)"
if ($Stream -eq 'backend') {
  Write-Host "  4) cd src-tauri; cargo check               # первая сборка долгая — это нормально"
} else {
  Write-Host "  4) npm run dev                             # vite сам выберет свободный порт"
}
