#!/usr/bin/env python3
"""Аудит фронтенда VaultBase: ловит «тихий дрейф», который не видят
ни сборка, ни тесты.

Три класса тихих багов, из-за которых плодятся затычки:

1. Сиротский className — класс используется в JSX, но НЕ определён ни в
   одном CSS-файле. `className="modal-box"` молча ничего не стилизует.
2. Фантомный токен — `var(--x)` используется, но `--x` нигде не объявлен.
   CSS отдаёт `unset`, цвет/отступ наследуется — визуальный баг без ошибки.
3. Дубли-определения одного селектора/токена (следы незаконченных миграций).

Плюс отчётные метрики: пустые catch{}, файлы >300 строк, дубли-хелперы.

Выход — читаемый отчёт + ненулевой код возврата, если есть критичное
(сироты/фантомы/дубли). Ноль зависимостей, только stdlib: запускается везде.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# Windows-консоль по умолчанию cp1251 и падает на юникоде — форсируем UTF-8.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
STYLES = SRC / "styles"

# ── Наборы имён, которые НЕ считаем сиротами ────────────────────────────────
# Tailwind-утилиты генерируются на лету — их нет в наших .css исходниках.
TAILWIND_PREFIXES = (
    "flex", "grid", "gap-", "p-", "px-", "py-", "pt-", "pb-", "pl-", "pr-",
    "m-", "mx-", "my-", "mt-", "mb-", "ml-", "mr-", "w-", "h-", "min-",
    "max-", "text-", "bg-", "border", "rounded", "shadow", "opacity-",
    "z-", "top-", "left-", "right-", "bottom-", "absolute", "relative",
    "fixed", "sticky", "hidden", "block", "inline", "items-", "justify-",
    "self-", "col-", "row-", "space-", "overflow-", "cursor-", "select-",
    "font-", "leading-", "tracking-", "uppercase", "lowercase", "capitalize",
    "truncate", "whitespace", "transition", "duration-", "ease-", "animate-",
    "hover:", "focus:", "active:", "disabled:", "group", "peer", "aspect-",
    "object-", "order-", "basis-", "grow", "shrink", "translate", "scale-",
    "rotate-", "pointer-events-", "resize", "list-", "align-", "underline",
    "not-", "first", "last", "odd", "even", "placeholder", "ring", "divide-",
    "backdrop", "filter", "blur", "brightness", "contrast", "inset-",
)


# Точные имена Tailwind-утилит без цифрового/дефисного хвоста, которые
# фильтр по префиксу не ловит.
TAILWIND_EXACT = {
    "italic", "uppercase", "lowercase", "capitalize", "normal-case",
    "truncate", "underline", "block", "inline", "flex", "grid", "hidden",
    "absolute", "relative", "fixed", "sticky", "static", "grow", "shrink",
    "antialiased", "sr-only", "container", "isolate", "invisible", "visible",
}


def is_tailwind(cls: str) -> bool:
    if cls in TAILWIND_EXACT:
        return True
    if cls.startswith(TAILWIND_PREFIXES):
        return True
    # accent-<color> Tailwind-утилита формы accent-accent / accent-red-500
    if cls.startswith("accent-"):
        return True
    # Произвольные значения Tailwind: text-[11px], w-[480px], bg-red-900/20
    if "[" in cls or "/" in cls:
        return True
    return False


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="ignore")


def jsx_files() -> list[Path]:
    return [p for p in SRC.rglob("*.jsx") if "__tests__" not in p.parts]


def css_files() -> list[Path]:
    return sorted(STYLES.glob("*.css"))


# ── 1. Определённые классы в CSS ────────────────────────────────────────────
# Поддерживаем escape-последовательности (например, .xl\\:grid-cols-4 → xl:grid-cols-4)
CLASS_DEF_RE = re.compile(r"\.(-?[a-zA-Z_][\w\\:-]*)")


def defined_classes() -> set[str]:
    defined: set[str] = set()
    for f in css_files():
        text = read(f)
        # Убираем содержимое {...} чтобы не ловить значения свойств как классы
        # Грубо, но достаточно: берём только часть строки до первой '{'
        for line in text.splitlines():
            head = line.split("{", 1)[0]
            if "." in head:
                for m in CLASS_DEF_RE.finditer(head):
                    defined.add(m.group(1).replace("\:", ":"))
    return defined


# ── 2. Используемые классы в JSX ────────────────────────────────────────────
# className="a b c"  и  className={'a ' + x}  — берём только строковые литералы
CLASSNAME_RE = re.compile(r'className\s*=\s*(?:"([^"]*)"|\{`([^`]*)`|\{\s*"([^"]*)"|\{\s*\'([^\']*)\')')


def used_classes() -> dict[str, list[str]]:
    """cls -> список файлов, где встречается."""
    used: dict[str, list[str]] = {}
    for f in jsx_files():
        rel = str(f.relative_to(ROOT))
        for m in CLASSNAME_RE.finditer(read(f)):
            blob = next(g for g in m.groups() if g is not None)
            # Строки с интерполяцией `${...}` пропускаем целиком: динамические
            # имена классов (`sbi-badge${color}`, `st-${status}`) нельзя
            # проверить статически, и их куски дают ложные «сироты».
            if "${" in blob:
                continue
            for cls in blob.split():
                cls = cls.strip()
                # Отбрасываем мусор парсинга: пустое, знаки, обрезки
                if not cls or not re.fullmatch(r"[a-zA-Z][\w:/.\[\]%-]*", cls):
                    continue
                used.setdefault(cls, [])
                if rel not in used[cls]:
                    used[cls].append(rel)
    return used


# ── 3. Токены ───────────────────────────────────────────────────────────────
TOKEN_DEF_RE = re.compile(r"(?m)^\s*(--[\w-]+)\s*:")
TOKEN_USE_RE = re.compile(r"var\(\s*(--[\w-]+)")


def defined_tokens() -> set[str]:
    tokens: set[str] = set()
    for f in css_files():
        for m in TOKEN_DEF_RE.finditer(read(f)):
            tokens.add(m.group(1))
    return tokens


def used_tokens() -> dict[str, list[str]]:
    used: dict[str, list[str]] = {}
    for f in [*css_files(), *jsx_files()]:
        rel = str(f.relative_to(ROOT))
        for m in TOKEN_USE_RE.finditer(read(f)):
            tok = m.group(1)
            used.setdefault(tok, [])
            if rel not in used[tok]:
                used[tok].append(rel)
    return used


# ── 4. Дубли определений класса/токена внутри CSS ───────────────────────────
def duplicate_class_defs() -> dict[str, tuple[int, bool]]:
    """Класс как одиночный селектор >1 раза ВНЕ @media/@supports.

    Возвращает {класс: (кол-во, расходятся_ли_тела)}. Идентичные дубли
    безвредны (одна и та же utility в двух файлах); опасны РАСХОДЯЩИЕСЯ —
    два разных тела правила под одним именем (как был мёртвый `.form-input`
    с border-radius:12px против токенного). Именно их и надо чинить."""
    bodies: dict[str, list[str]] = {}
    single_sel = re.compile(r"^\s*(\.[\w-]+)\s*\{(.*)$")
    at_rule = re.compile(r"^\s*@(media|supports|container)")
    for f in css_files():
        lines = read(f).splitlines()
        in_at = False
        depth = 0
        i = 0
        while i < len(lines):
            line = lines[i]
            if at_rule.match(line):
                in_at = True
                depth = 0
            if in_at:
                depth += line.count("{") - line.count("}")
                if depth <= 0:
                    in_at = False
                i += 1
                continue
            m = single_sel.match(line)
            if m:
                cls = m.group(1)
                # Собираем тело правила до закрывающей }
                body = m.group(2)
                j = i
                while "}" not in body and j + 1 < len(lines):
                    j += 1
                    body += " " + lines[j]
                norm = re.sub(r"\s+", "", body.split("}", 1)[0])
                bodies.setdefault(cls, []).append(norm)
                i = j + 1
                continue
            i += 1
    out: dict[str, tuple[int, bool]] = {}
    for cls, bs in bodies.items():
        if len(bs) > 1:
            out[cls] = (len(bs), len(set(bs)) > 1)
    return out


# ── 5. Пустые catch ─────────────────────────────────────────────────────────
EMPTY_CATCH_RE = re.compile(r"catch\s*(?:\([^)]*\))?\s*\{\s*\}|catch\s*\{[^}]*?\}")
BARE_CATCH_RE = re.compile(r"catch\s*\{")  # catch без (e)
EMPTY_DOT_CATCH_RE = re.compile(r"\.catch\(\s*\(\s*\)\s*=>\s*\{?\s*\}?\s*\)")


def bare_catches() -> dict[str, int]:
    out: dict[str, int] = {}
    for f in jsx_files():
        text = read(f)
        n = len(BARE_CATCH_RE.findall(text)) + len(EMPTY_DOT_CATCH_RE.findall(text))
        if n:
            out[str(f.relative_to(ROOT))] = n
    return out


# ── 6. Большие файлы ────────────────────────────────────────────────────────
def big_files(limit: int = 300) -> list[tuple[str, int]]:
    out = []
    for f in jsx_files():
        n = len(read(f).splitlines())
        if n > limit:
            out.append((str(f.relative_to(ROOT)), n))
    return sorted(out, key=lambda x: -x[1])


# ── 7. Дубли хелперов ───────────────────────────────────────────────────────
HELPER_RE = re.compile(r"(?m)^\s*(?:function|const)\s+(fmtDate|fmtMoney|formatDate|formatMoney|copyToClipboard)\b")


def duplicate_helpers() -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for f in jsx_files():
        rel = str(f.relative_to(ROOT))
        for m in HELPER_RE.finditer(read(f)):
            out.setdefault(m.group(1), []).append(rel)
    return {k: v for k, v in out.items() if len(v) > 1}


def main() -> int:
    defined_cls = defined_classes()
    used_cls = used_classes()
    orphans = {
        c: files for c, files in sorted(used_cls.items())
        if c not in defined_cls and not is_tailwind(c)
    }

    def_tok = defined_tokens()
    use_tok = used_tokens()
    phantom = {
        t: files for t, files in sorted(use_tok.items()) if t not in def_tok
    }

    dup_cls = duplicate_class_defs()
    diverging = {c: n for c, (n, div) in dup_cls.items() if div}
    identical = {c: n for c, (n, div) in dup_cls.items() if not div}
    catches = bare_catches()
    bigs = big_files()
    dup_help = duplicate_helpers()

    critical = bool(orphans or phantom or diverging)

    print("=" * 70)
    print("  VAULTBASE FRONTEND AUDIT")
    print("=" * 70)

    print(f"\n[КРИТИЧНО] Сиротские классы (используются, НЕ определены): {len(orphans)}")
    for c, files in orphans.items():
        print(f"  .{c:<28} ← {', '.join(files)}")

    print(f"\n[КРИТИЧНО] Фантомные токены (var используется, НЕ объявлен): {len(phantom)}")
    for t, files in phantom.items():
        print(f"  {t:<28} ← {', '.join(f.split(chr(92))[-1] for f in files)}")

    print(f"\n[КРИТИЧНО] Расходящиеся дубли класса (разные тела, каскад-рулетка): {len(diverging)}")
    for c, n in sorted(diverging.items(), key=lambda x: -x[1]):
        print(f"  {c:<28} ×{n}")

    print(f"\n[ИНФО] Идентичные дубли (безвредны, но лишни): {len(identical)}")
    for c, n in sorted(identical.items(), key=lambda x: -x[1])[:8]:
        print(f"  {c:<28} ×{n}")
    if len(identical) > 8:
        print(f"  … ещё {len(identical) - 8}")

    print(f"\n[ДОЛГ] Пустые/bare catch (CLAUDE.md запрещает): {sum(catches.values())} в {len(catches)} файлах")
    for f, n in sorted(catches.items(), key=lambda x: -x[1]):
        print(f"  {n:>3}  {f}")

    print(f"\n[ДОЛГ] Файлы >300 строк: {len(bigs)}")
    for f, n in bigs[:12]:
        print(f"  {n:>5}  {f}")

    print(f"\n[ДОЛГ] Дубли-хелперы: {len(dup_help)}")
    for h, files in dup_help.items():
        print(f"  {h:<16} в {', '.join(f.split('/')[-1] for f in files)}")

    print("\n" + "=" * 70)
    if critical:
        print("  ❌ ЕСТЬ КРИТИЧНЫЕ ПРОБЛЕМЫ (сироты/фантомы/дубли)")
    else:
        print("  ✅ Критичных проблем нет")
    print("=" * 70)

    return 1 if critical else 0


if __name__ == "__main__":
    sys.exit(main())
