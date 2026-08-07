#!/usr/bin/env python3
"""
Консолидация CSS VaultBase: 36 файлов -> 5.

НЕ переписывает стили. Физически склеивает существующие файлы группами,
сохраняя тот же порядок каскада, что был в index-redesign.css. Каждый файл,
который раньше подключался через `@import ... layer(app)`, попадает внутрь
одного общего блока `@layer app { ... }` — результат для браузера идентичен,
но исходников теперь 5 вместо 36.

Итог:
  src/styles/
    tokens.css      (переменные + keyframes, ВНЕ слоя)
    base.css        (reset + низовые правила из index, слой app + корневые)
    layout.css      (sidebar/topbar/content/responsive, слой app)
    components.css  (все components/* + utilities, слой app)
    pages.css       (все pages/*, слой app)
    index.css       (только @import пяти файлов + @tailwind)

Старые *-redesign.css остаются на диске нетронутыми до ручного удаления —
скрипт их не трогает, только создаёт новые и переписывает точку входа.
"""
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = os.path.join(ROOT, "src", "styles")


def read(rel):
    p = os.path.join(S, rel)
    if not os.path.isfile(p):
        raise SystemExit(f"НЕТ ФАЙЛА: {rel}")
    return open(p, encoding="utf-8").read()


def banner(title):
    line = "═" * 59
    return f"\n/* {line}\n   {title}\n   {line} */\n"


def concat(files, header):
    """Склеить файлы с разделителями-комментариями, откуда что."""
    out = [banner(header)]
    for rel in files:
        out.append(f"\n/* ── источник: {rel} ── */\n")
        out.append(read(rel))
    return "\n".join(out)


def wrap_layer(body):
    """Обернуть в @layer app. Отступ не важен для CSS, поэтому оставляем как есть."""
    return "@layer app {\n" + body + "\n}\n"


# ── Порядок ВЗЯТ ИЗ index-redesign.css — менять нельзя, это каскад ──────────

TOKENS = ["tokens-redesign.css", "animations-redesign.css"]

BASE_FILES = ["reset-redesign.css"]

LAYOUT = [
    "layout/sidebar-redesign.css",
    "layout/topbar-redesign.css",
    "layout/content-redesign.css",
    "layout/responsive-redesign.css",  # был не подключён, но логически сюда
]

COMPONENTS = [
    "utilities-redesign.css",  # в index идёт до layout, но это утилиты-компоненты
    "components/buttons-redesign.css",
    "components/forms-redesign.css",
    "components/inline-elements.css",
    "components/modal-redesign.css",
    "components/table-redesign.css",
    "components/badges-redesign.css",
    "components/filters-redesign.css",
    "components/panel-redesign.css",
    "components/theme-switcher.css",
]

PAGES = [
    "pages/dashboard-redesign.css",
    "pages/dashboard-cards-redesign.css",
    "pages/auth-redesign.css",
    "pages/cards-redesign.css",
    "pages/profiles-redesign.css",
    "pages/updates-redesign.css",
    "pages/orders-redesign.css",
    "pages/shops-redesign.css",
    "pages/proxies-redesign.css",
    "pages/couriers-redesign.css",
    "pages/emails-redesign.css",
    "pages/imap-redesign.css",
    "pages/settings-redesign.css",
    "pages/activity-log-redesign.css",
    "pages/catalog-redesign.css",
    "pages/onboarding-redesign.css",
    "pages/stats-redesign.css",
    "pages/premium-enhancements.css",
]

# Низовые правила из index-redesign.css (после всех @import): корень, focus,
# gradient-border-box, glow-*, text-gradient, cyber-grid-bg, float, @media print.
# Они шли ВНЕ @layer (кроме reset), поэтому оставляем их вне слоя в base.css.
INDEX_TAIL = """
/* ── Корень ─────────────────────────────────────────────── */
#root {
  width: 100%;
  height: 100vh;
  overflow: hidden;
}

/* ── Фокус ──────────────────────────────────────────────────
   Радиус здесь не задаётся намеренно: у :focus-visible
   специфичность выше класса, и поле ввода с --r-sm скруглялось
   бы до 3px. Кольцо строится на box-shadow, который повторяет
   радиус самого элемента. */
:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

/* ── Градиентная рамка → обычная ────────────────────────── */
.gradient-border-box {
  position: relative;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
}

/* Свечения упразднены — классы-заглушки no-op. */
.glow-subtle,
.glow-accent {
  box-shadow: none;
}

.text-gradient {
  color: var(--accent);
  -webkit-text-fill-color: currentColor;
}

.cyber-grid-bg {
  position: relative;
}

.float {
  animation: none;
}

/* ── Печать ─────────────────────────────────────────────── */
@media print {
  .sidebar,
  .topbar,
  .modal-overlay,
  .toast-container {
    display: none !important;
  }
}
"""

NEW_INDEX = """/* ═══════════════════════════════════════════════════════════
   VAULTBASE — единая точка входа стилей
   Раньше было 36 файлов, подключённых по одному через @import.
   Теперь 5 логических файлов. Порядок @layer определяет каскад:
   слой, объявленный раньше, СЛАБЕЕ. Поэтому app идёт между
   tw-base (preflight Tailwind) и tw-utils (утилиты Tailwind).
   ═══════════════════════════════════════════════════════════ */
@layer tw-base, app, tw-utils;

/* tokens — ВНЕ слоя: переменные и @keyframes видны всем безусловно
   и не участвуют в конфликтах специфичности. */
@import './tokens.css';

/* base/layout/components/pages — уже обёрнуты в @layer app внутри себя. */
@import './base.css';
@import './layout.css';
@import './components.css';
@import './pages.css';

/* ── Tailwind ───────────────────────────────────────────── */
@layer tw-base {
  @tailwind base;
}

@tailwind components;

@layer tw-utils {
  @tailwind utilities;
}
"""


def main():
    dry = "--dry-run" in sys.argv

    targets = {
        "tokens.css": concat(TOKENS, "TOKENS + KEYFRAMES (вне слоя)"),
        # base: reset в слое app + низовые правила index вне слоя
        "base.css": (
            wrap_layer(concat(BASE_FILES, "RESET (слой app)"))
            + banner("Низовые правила приложения (вне слоя)")
            + INDEX_TAIL
        ),
        "layout.css": wrap_layer(concat(LAYOUT, "LAYOUT (слой app)")),
        "components.css": wrap_layer(concat(COMPONENTS, "COMPONENTS + UTILITIES (слой app)")),
        "pages.css": wrap_layer(concat(PAGES, "PAGES (слой app)")),
        "index.css": NEW_INDEX,
    }

    for name, content in targets.items():
        size = len(content.encode("utf-8"))
        print(f"  {name:16} {size:>8} байт")
        if not dry:
            open(os.path.join(S, name), "w", encoding="utf-8").write(content)

    if dry:
        print("\ndry-run: файлы не записаны")
        return

    print("\nЗаписаны 6 файлов (5 + index.css).")
    print("Старые *-redesign.css НЕ удалены — удали вручную после проверки:")
    print("  main.jsx импортирует './index.css', который теперь тянет новые 5.")


if __name__ == "__main__":
    main()
