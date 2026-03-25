#!/bin/bash
# ============================================================
#  tauri_build.sh — сборка с подписью для auto-updater
#  Запуск: bash tauri_build.sh
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

CONF="src-tauri/tauri.conf.json"
KEY_FILE="$HOME/.tauri/cc-manager.key"
KEY_PUB_FILE="$HOME/.tauri/cc-manager.key.pub"

echo "════════════════════════════════════════"
echo "  CC Manager — Tauri Build + Sign"
echo "════════════════════════════════════════"
echo ""

# ── Шаг 1: версия ────────────────────────────────────────────
CURRENT_VERSION=$(grep '"version"' "$CONF" | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/' | sed 's/-beta//')
echo "  Текущая версия: $CURRENT_VERSION"
echo "  Формат: MAJOR.MINOR.PATCH (например 1.2.0)"
echo ""
echo -n "  Введи новую версию (Enter = оставить $CURRENT_VERSION): "
read -r INPUT_VERSION
VERSION="${INPUT_VERSION:-$CURRENT_VERSION}"

# Дополняем до X.Y.Z если введено X или X.Y
DOTS=$(echo "$VERSION" | tr -cd '.' | wc -c | tr -d ' ')
if [ "$DOTS" -eq 0 ]; then
  VERSION="${VERSION}.0.0"
elif [ "$DOTS" -eq 1 ]; then
  VERSION="${VERSION}.0"
fi

# Валидация semver
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "  ✗ Некорректная версия: $VERSION (нужен формат X.Y.Z)"
  exit 1
fi

# ── Шаг 2: канал ─────────────────────────────────────────────
echo ""
echo "  Канал релиза:"
echo "    [1] stable  — рекомендуется обновить"
echo "    [2] beta    — обновление доступно (по желанию)"
echo ""
echo -n "  Выбор [1/2] (Enter = stable): "
read -r CHANNEL_INPUT

case "$CHANNEL_INPUT" in
  2|beta|Beta|BETA)
    CHANNEL="beta"
    FULL_VERSION="${VERSION}-beta"
    ;;
  *)
    CHANNEL="stable"
    FULL_VERSION="$VERSION"
    ;;
esac

echo ""
echo "  Версия: $FULL_VERSION  |  Канал: $CHANNEL"
echo ""
echo -n "  Продолжить сборку? [y/n]: "
read -r CONFIRM
if [ "$CONFIRM" != "y" ]; then
  echo "  Отменено."
  exit 0
fi

# ── Шаг 3: обновляем версию в tauri.conf.json ────────────────
echo ""
echo "→ Обновляем версию в $CONF..."
# Заменяем только первое вхождение "version" (версия пакета, не схема)
TMPFILE=$(mktemp)
awk -v ver="$FULL_VERSION" '
  /"version"/ && !done {
    sub(/"version": *"[^"]*"/, "\"version\": \"" ver "\"")
    done=1
  }
  { print }
' "$CONF" > "$TMPFILE" && mv "$TMPFILE" "$CONF"

# Обновляем версию в package.json тоже
awk -v ver="$FULL_VERSION" '
  /"version"/ && !done {
    sub(/"version": *"[^"]*"/, "\"version\": \"" ver "\"")
    done=1
  }
  { print }
' package.json > "$TMPFILE" && mv "$TMPFILE" package.json

echo "  ✓ Версия обновлена: $FULL_VERSION"

# ── Шаг 4: найти приватный ключ ──────────────────────────────
echo ""
if [ ! -f "$KEY_FILE" ]; then
  echo "✗ Ключ не найден: $KEY_FILE"
  echo ""
  echo "Ищем ключ в других местах..."
  FOUND=$(find "$HOME" -name "*.key" -not -name "*.key.pub" 2>/dev/null | grep -i "tauri\|cc-manager\|ccmanager" | head -5)
  if [ -n "$FOUND" ]; then
    echo "Найдены ключи:"
    echo "$FOUND"
    echo ""
    echo "Укажи путь к ключу:"
    read -r KEY_FILE
  else
    echo ""
    echo "Ключ не найден. Генерируем новый..."
    echo "⚠️  ВНИМАНИЕ: если уже был ключ — старые клиенты не примут обновление!"
    echo "Продолжить генерацию? (y/n)"
    read -r GEN_CONFIRM
    if [ "$GEN_CONFIRM" != "y" ]; then
      echo "Отменено."
      exit 1
    fi
    mkdir -p "$HOME/.tauri"
    npm run tauri signer generate -- -w "$KEY_FILE" -p "" --ci
    echo ""
    echo "✓ Новый ключ сгенерирован: $KEY_FILE"
    echo "Публичный ключ (вставь в tauri.conf.json → plugins.updater.pubkey):"
    cat "$KEY_PUB_FILE"
  fi
fi

echo "✓ Ключ найден: $KEY_FILE"

# ── Шаг 5: экспортируем ключ ─────────────────────────────────
export TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY=$(cat "$KEY_FILE")

# BD-H04: Require password for signing key (security requirement)
if [ -z "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" ]; then
  echo "⚠️  WARNING: TAURI_SIGNING_PRIVATE_KEY_PASSWORD is not set!"
  echo "  This is a security risk — anyone with access to the key can sign malicious updates."
  echo "  Set the environment variable with a strong password (20+ characters)."
  echo ""
  echo "  Continue without password protection? (NOT RECOMMENDED) [y/n]: "
  read -r SKIP_PASSWORD
  if [ "$SKIP_PASSWORD" != "y" ]; then
    echo "  Aborted. Set TAURI_SIGNING_PRIVATE_KEY_PASSWORD and re-run."
    exit 1
  fi
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
else
  echo "✓ Password protection enabled"
fi

echo "✓ Ключ загружен ($(echo "$TAURI_SIGNING_PRIVATE_KEY" | wc -c | tr -d ' ') байт)"

# ── Шаг 6: сборка ────────────────────────────────────────────
echo ""
echo "→ Запускаем tauri build (aarch64-apple-darwin)..."
echo "  Версия: $FULL_VERSION | Канал: $CHANNEL"
echo ""

if [ "$CHANNEL" = "beta" ]; then
  echo "  (Beta: собираем только .app — DMG не поддерживает дефис в версии)"
  npm run tauri build -- --target aarch64-apple-darwin --bundles app
else
  npm run tauri build -- --target aarch64-apple-darwin
fi

BUILD_EXIT=$?
if [ $BUILD_EXIT -ne 0 ]; then
  echo ""
  echo "✗ Сборка завершилась с ошибкой (код $BUILD_EXIT)"
  exit $BUILD_EXIT
fi

# ── Шаг 7: найти артефакты ───────────────────────────────────
echo ""
echo "════ Артефакты сборки ════"
BUNDLE_DIR="src-tauri/target/aarch64-apple-darwin/release/bundle"

DMG=$(find "$BUNDLE_DIR/dmg"    -name "*.dmg"         2>/dev/null | head -1)
TARGZ=$(find "$BUNDLE_DIR/macos" -name "*.tar.gz"     2>/dev/null | head -1)
SIG=$(find "$BUNDLE_DIR/macos"   -name "*.tar.gz.sig" 2>/dev/null | head -1)

echo ""
if [ -n "$DMG" ];   then echo "✓ DMG:    $DMG  ($(du -h "$DMG" | cut -f1))"; fi
if [ -n "$TARGZ" ]; then echo "✓ tar.gz: $TARGZ  ($(du -h "$TARGZ" | cut -f1))"; fi

if [ -n "$SIG" ]; then
  echo "✓ .sig:   $SIG"
  echo ""
  echo "════ Содержимое .sig (скопируй в админку) ════"
  cat "$SIG"
  echo ""
else
  echo ""
  echo "✗ .sig не найден — подпись не сработала"
  echo "  Проверь что KEY_FILE читается: $KEY_FILE"
fi

echo ""
echo "════════════════════════════════════════"
echo "  Готово!"
echo "  Версия:  $FULL_VERSION"
echo "  Канал:   $CHANNEL"
echo ""
echo "  Загрузи в админку:"
echo "  1. DMG-файл"
echo "  2. Подпись (.sig)"
echo "  3. Укажи канал: $CHANNEL"
echo "════════════════════════════════════════"
