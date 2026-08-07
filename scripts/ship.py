#!/usr/bin/env python3
"""
Полный выпуск версии одной командой: версия -> коммит -> тег -> CI -> сервер.

    python scripts/ship.py --version 2.5.4 --notes "Починили курьеров"
    python scripts/ship.py --patch                 # 2.5.3 -> 2.5.4 автоматически
    python scripts/ship.py --patch --notes-file NOTES.md

Что делает по шагам:
  1. Проверяет, что рабочее дерево чистое (или коммитит сам с --commit-all).
  2. Поднимает версию синхронно в package.json / Cargo.toml / tauri.conf.json.
  3. Дописывает раздел в CHANGELOG.md на русском.
  4. Коммитит, пушит main.
  5. Ставит тег vX.Y.Z НА НУЖНЫЙ КОММИТ и пушит (перевыпускает, если тег занят).
  6. Ждёт сборку GitHub Actions (4 платформы), показывает прогресс.
  7. Скачивает артефакты и заливает их на сервер с регистрацией в БД.
  8. Проверяет, что /update отдаёт новую версию.

Ключевая деталь, из-за которой раньше ломалось: тег ДОЛЖЕН указывать на коммит,
где версия внутри файлов уже равна версии тега. Иначе CI соберёт старый номер,
а апдейтер такую сборку не покажет. Скрипт делает это в правильном порядке.

Окружение:
    GITHUB_TOKEN  токен с правами repo (для опроса статуса сборки и скачивания)
    VPS_HOST / VPS_USER / VPS_PASS      для заливки на сервер

"""
import argparse
import io
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "vaultbase-ship/1.0"

VERSION_FILES = [
    ("package.json", r'("version":\s*)"(?P<v>[\d.]+)"'),
    ("src-tauri/Cargo.toml", r'(?m)^(version\s*=\s*)"(?P<v>[\d.]+)"'),
    ("src-tauri/tauri.conf.json", r'("version":\s*)"(?P<v>[\d.]+)"'),
]


def log(m=""):
    print(m, flush=True)


def die(m):
    sys.exit(f"\nОШИБКА: {m}")


def git(*args, check=True, quiet=False):
    p = subprocess.run(["git", *args], cwd=ROOT, capture_output=True,
                       text=True, errors="replace")
    if check and p.returncode != 0:
        die(f"git {' '.join(args)}\n{p.stdout}\n{p.stderr}")
    out = (p.stdout or "").strip()
    if not quiet and out:
        log("  " + out.replace("\n", "\n  "))
    return out


def repo_slug():
    """owner/repo из origin."""
    url = git("remote", "get-url", "origin", quiet=True)
    m = re.search(r"github\.com[:/]([^/]+)/([^/.]+)", url)
    if not m:
        die(f"не могу разобрать origin: {url}")
    return f"{m.group(1)}/{m.group(2)}"


def read_versions():
    out = {}
    for rel, pat in VERSION_FILES:
        s = open(os.path.join(ROOT, rel), encoding="utf-8").read()
        m = re.search(pat, s)
        if not m:
            die(f"не нашёл версию в {rel}")
        out[rel] = m.group("v")
    return out


def set_version(new):
    for rel, pat in VERSION_FILES:
        p = os.path.join(ROOT, rel)
        s = open(p, encoding="utf-8").read()
        s = re.sub(pat, lambda m: f'{m.group(1)}"{new}"', s, count=1)
        open(p, "w", encoding="utf-8").write(s)


def bump(cur, part):
    a, b, c = (list(map(int, cur.split("."))) + [0, 0, 0])[:3]
    if part == "major":
        return f"{a+1}.0.0"
    if part == "minor":
        return f"{a}.{b+1}.0"
    return f"{a}.{b}.{c+1}"


def write_changelog(version, notes):
    p = os.path.join(ROOT, "CHANGELOG.md")
    s = open(p, encoding="utf-8").read()
    if f"## [{version}]" in s:
        log(f"  CHANGELOG: раздел [{version}] уже есть, пропускаю")
        return
    today = time.strftime("%Y-%m-%d")
    body = "\n".join(
        ln if ln.strip().startswith(("-", "*", "#")) else f"- {ln.strip()}"
        for ln in notes.strip().splitlines() if ln.strip()
    )
    entry = f"\n## [{version}] — {today}\n\n### Изменения\n\n{body}\n"
    marker = "and this project adheres to [Semantic Versioning]"
    i = s.find(marker)
    i = s.find("\n", i) + 1 if i != -1 else 0
    open(p, "w", encoding="utf-8").write(s[:i] + entry + s[i:])
    log(f"  CHANGELOG: добавлен раздел [{version}]")


def api(path, token, raw=False):
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        headers={"Authorization": f"Bearer {token}", "User-Agent": UA,
                 "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read() if raw else json.loads(r.read().decode())


def wait_ci(slug, tag, token, timeout_min=45):
    """Ждём завершения workflow для тега. Возвращает run_id или None."""
    log(f"\n[CI] жду сборку для {tag} (до {timeout_min} мин)")
    deadline = time.time() + timeout_min * 60
    run_id = None
    last = None
    while time.time() < deadline:
        try:
            data = api(f"/repos/{slug}/actions/runs?per_page=20", token)
        except urllib.error.HTTPError as e:
            die(f"GitHub API {e.code}: нужен GITHUB_TOKEN с правами repo")
        runs = [r for r in data.get("workflow_runs", [])
                if r.get("head_branch") == tag or tag in (r.get("display_title") or "")]
        if not runs:
            time.sleep(15)
            continue
        run = runs[0]
        run_id = run["id"]
        status, concl = run["status"], run.get("conclusion")
        if (status, concl) != last:
            log(f"  {status}{(' → ' + concl) if concl else ''}")
            last = (status, concl)
        if status == "completed":
            if concl != "success":
                log(f"  сборка завершилась как «{concl}»")
                log(f"  логи: https://github.com/{slug}/actions/runs/{run_id}")
                return None
            return run_id
        time.sleep(20)
    log("  таймаут ожидания")
    return None


def download_artifacts(slug, run_id, token, dest):
    """Скачать и распаковать все артефакты сборки."""
    os.makedirs(dest, exist_ok=True)
    data = api(f"/repos/{slug}/actions/runs/{run_id}/artifacts", token)
    arts = data.get("artifacts", [])
    if not arts:
        die("артефактов в сборке нет")
    log(f"\n[артефакты] скачиваю {len(arts)} шт.")
    for a in arts:
        blob = api(f"/repos/{slug}/actions/artifacts/{a['id']}/zip", token, raw=True)
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            z.extractall(os.path.join(dest, a["name"]))
        log(f"  {a['name']}  ({a['size_in_bytes']/1048576:.1f} MB)")
    return dest


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--version", help="точная версия, напр. 2.5.4")
    g.add_argument("--patch", action="store_true", help="+1 к патчу")
    g.add_argument("--minor", action="store_true")
    g.add_argument("--major", action="store_true")
    ap.add_argument("--notes", default="")
    ap.add_argument("--notes-file")
    ap.add_argument("--commit-all", action="store_true",
                    help="закоммитить все текущие изменения")
    ap.add_argument("--no-wait", action="store_true", help="не ждать CI")
    ap.add_argument("--no-publish", action="store_true", help="не заливать на сервер")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    notes = a.notes
    if a.notes_file:
        notes = open(os.path.join(ROOT, a.notes_file), encoding="utf-8").read()
    if not notes.strip():
        notes = "Обновление VaultBase."

    # ── 1. Состояние дерева ────────────────────────────────────────────
    dirty = git("status", "--porcelain", quiet=True)
    if dirty and not a.commit_all and not a.dry_run:
        log("Есть незакоммиченные изменения:")
        log("  " + dirty.replace("\n", "\n  ")[:800])
        die("закоммить их или запусти с --commit-all")

    cur = read_versions()
    if len(set(cur.values())) != 1:
        die("версии рассинхронизированы: " + ", ".join(f"{k}={v}" for k, v in cur.items()))
    old = list(cur.values())[0]

    if a.version:
        new = a.version
    elif a.major:
        new = bump(old, "major")
    elif a.minor:
        new = bump(old, "minor")
    else:
        new = bump(old, "patch")

    tag = f"v{new}"
    slug = repo_slug()
    log(f"Репозиторий: {slug}")
    log(f"Версия: {old} → {new}   тег: {tag}")

    if a.dry_run:
        log("\ndry-run: дальше ничего не выполняется")
        return

    # ── 2. Версия + CHANGELOG ──────────────────────────────────────────
    log("\n[1/6] Версия и CHANGELOG")
    if new != old:
        set_version(new)
        log(f"  версия проставлена в 3 файлах")
    write_changelog(new, notes)

    # ── 3. Коммит и push ───────────────────────────────────────────────
    log("\n[2/6] Коммит и push")
    git("add", "-A", quiet=True)
    staged = git("diff", "--cached", "--name-only", quiet=True)
    if staged:
        subprocess.run(["git", "-c", "user.name=VaultBase Release",
                        "-c", "user.email=release@vaultbase.local",
                        "commit", "-q", "-m", f"release: {new}\n\n{notes.strip()}"],
                       cwd=ROOT, capture_output=True, text=True)
        log(f"  закоммичено файлов: {len(staged.splitlines())}")
    else:
        log("  нечего коммитить")
    git("push", "origin", "HEAD", quiet=True)
    head = git("rev-parse", "--short", "HEAD", quiet=True)
    log(f"  main запушен, HEAD={head}")

    # ── 4. Тег ─────────────────────────────────────────────────────────
    # Ставим ПОСЛЕ коммита с версией — иначе CI соберёт старый номер.
    log("\n[3/6] Тег")
    existing = git("tag", "-l", tag, quiet=True)
    if existing:
        log(f"  тег {tag} уже есть — перевыпускаю на текущий коммит")
        git("tag", "-d", tag, quiet=True)
        subprocess.run(["git", "push", "origin", f":refs/tags/{tag}"],
                       cwd=ROOT, capture_output=True, text=True)
    git("tag", tag, quiet=True)
    git("push", "origin", tag, quiet=True)
    log(f"  {tag} → {head}")

    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if a.no_wait or not token:
        if not token:
            log("\nGITHUB_TOKEN не задан — не могу следить за сборкой.")
        log(f"Следи вручную: https://github.com/{slug}/actions")
        return

    # ── 5. Ждём CI ─────────────────────────────────────────────────────
    log("\n[4/6] Сборка в GitHub Actions")
    run_id = wait_ci(slug, tag, token)
    if not run_id:
        die("сборка не удалась — смотри логи в Actions")
    log(f"  успешно, run={run_id}")

    if a.no_publish:
        log("\n--no-publish: на сервер не заливаю")
        return

    # ── 6. Скачать и залить ────────────────────────────────────────────
    log("\n[5/6] Скачивание артефактов")
    dest = os.path.join(ROOT, ".release-artifacts", new)
    download_artifacts(slug, run_id, token, dest)

    log("\n[6/6] Публикация на сервер")
    if not os.environ.get("VPS_HOST"):
        log("  VPS_HOST не задан — пропускаю. Залить позже:")
        log(f"  python scripts/publish-release.py --version {new} --dir {dest}")
        return
    r = subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "publish-release.py"),
                        "--version", new, "--notes", notes.strip().splitlines()[0],
                        "--dir", dest], cwd=ROOT)
    if r.returncode != 0:
        die("публикация не удалась")

    # ── Проверка ───────────────────────────────────────────────────────
    base = os.environ.get("SERVER_URL", "https://sec201-www.otpmanager.pro").rstrip("/")
    try:
        req = urllib.request.Request(f"{base}/update?current_version={old}",
                                     headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status == 204:
                log(f"\n! /update отдаёт 204 — клиенты {old} обновление не увидят")
            else:
                d = json.loads(resp.read().decode())
                log(f"\nПроверка: клиент {old} увидит {d.get('version')}, "
                    f"платформы: {', '.join(d.get('platforms', {}))}")
    except Exception as e:
        log(f"\nне смог проверить /update: {e}")

    log(f"\nГОТОВО. Версия {new} выпущена.")


if __name__ == "__main__":
    main()
