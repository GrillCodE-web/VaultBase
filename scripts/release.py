#!/usr/bin/env python3
"""
Выпуск новой версии VaultBase: версия -> сборка -> заливка в панель -> CHANGELOG.

Один вход на весь релизный цикл:

    python scripts/release.py --version 2.5.2 --notes-file RELEASE_NOTES.md --publish

Что делает по шагам:
  1. Сверяет версию в package.json / Cargo.toml / tauri.conf.json и поднимает её.
  2. Собирает выбранные платформы (Windows локально, Linux через WSL).
  3. Находит артефакты и их .sig-подписи (нужны встроенному апдейтеру Tauri).
  4. Заливает каждый файл в админ-панель через POST <ADMIN_PATH>/upload.
  5. Дописывает раздел в CHANGELOG.md на русском.
  6. Проверяет, что /update отдаёт новую версию клиенту на предыдущей.

Креды и ключи — только из окружения, в репозиторий не попадают:

    SERVER_URL   https://sec201-www.otpmanager.pro   (по умолчанию)
    ADMIN_PATH   /ghostadmin/1asfd-54-local          (по умолчанию)
    ADMIN_USER   admin
    ADMIN_PASS   <пароль админки>
    TAURI_SIGNING_PRIVATE_KEY_PATH   .secrets/vaultbase-updater.key

Примеры:
    python scripts/release.py --version 2.5.2 --notes "Починили синхронизацию"
    python scripts/release.py --version 2.5.2 --platforms win --dry-run
    python scripts/release.py --skip-build --publish      # залить уже собранное
"""
import argparse
import base64
import datetime
import json
import mimetypes
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER_URL = os.environ.get("SERVER_URL", "https://sec201-www.otpmanager.pro").rstrip("/")
ADMIN_PATH = os.environ.get("ADMIN_PATH", "/ghostadmin/1asfd-54-local").rstrip("/")
# Cloudflare отбивает запросы без браузерного User-Agent (ошибка 1010).
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

VERSION_FILES = [
    ("package.json", r'("version":\s*)"(?P<v>[\d.]+)"'),
    ("src-tauri/Cargo.toml", r'(?m)^(version\s*=\s*)"(?P<v>[\d.]+)"'),
    ("src-tauri/tauri.conf.json", r'("version":\s*)"(?P<v>[\d.]+)"'),
]

# platform-строки должны совпадать с тем, что ждёт Tauri в platforms{} ответа /update.
TARGETS = {
    "win": {
        "platform": "windows-x86_64",
        "bundle_dir": "src-tauri/target/release/bundle",
        "patterns": [
            ("installer-msi", r"\.msi$"),
            ("installer-nsis", r"-setup\.exe$"),
            ("updater", r"\.msi\.zip$|-setup\.nsis\.zip$"),
        ],
    },
    "linux": {
        "platform": "linux-x86_64",
        "bundle_dir": "src-tauri/target/release/bundle",
        "patterns": [
            ("installer-deb", r"\.deb$"),
            ("installer-appimage", r"\.AppImage$"),
            ("updater", r"\.AppImage\.tar\.gz$"),
        ],
    },
}


def log(m):
    print(m, flush=True)


def die(m):
    sys.exit(f"ОШИБКА: {m}")


def read_versions():
    found = {}
    for rel, pat in VERSION_FILES:
        p = os.path.join(ROOT, rel)
        m = re.search(pat, open(p, encoding="utf-8").read())
        if not m:
            die(f"не нашёл версию в {rel}")
        found[rel] = m.group("v")
    return found


def set_version(new):
    for rel, pat in VERSION_FILES:
        p = os.path.join(ROOT, rel)
        s = open(p, encoding="utf-8").read()
        s = re.sub(pat, lambda m: f'{m.group(1)}"{new}"', s, count=1)
        open(p, "w", encoding="utf-8").write(s)
    log(f"  версия -> {new} в трёх файлах")


def run(cmd, cwd=ROOT, env=None, timeout=3600):
    log(f"  $ {cmd}")
    e = dict(os.environ)
    if env:
        e.update(env)
    p = subprocess.run(cmd, shell=True, cwd=cwd, env=e, timeout=timeout,
                       capture_output=True, text=True, errors="replace")
    if p.returncode != 0:
        log((p.stdout or "")[-1500:])
        log((p.stderr or "")[-1500:])
        die(f"команда упала (код {p.returncode})")
    return p.stdout


def build(platform, key_path):
    env = {}
    if key_path and os.path.isfile(key_path):
        env["TAURI_SIGNING_PRIVATE_KEY_PATH"] = key_path
        env.setdefault("TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "")
    else:
        log("  ! ключа подписи нет — апдейтер не примет такую сборку")

    if platform == "win":
        env["PATH"] = "/c/msys64/mingw64/bin:" + os.environ.get("PATH", "")
        run("npx tauri build --bundles msi,nsis", env=env)
    elif platform == "linux":
        # Сборка внутри WSL: Linux-бандлы нельзя собрать из Windows напрямую.
        keyenv = ""
        if key_path and os.path.isfile(key_path):
            wsl_key = run(f'wsl wslpath -a "{key_path}"').strip()
            keyenv = f'TAURI_SIGNING_PRIVATE_KEY_PATH="{wsl_key}" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" '
        wsl_root = run(f'wsl wslpath -a "{ROOT}"').strip()
        run(f'wsl bash -lc "cd \'{wsl_root}\' && {keyenv}npx tauri build --bundles deb,appimage"',
            timeout=5400)


def find_artifacts(platform, version):
    cfg = TARGETS[platform]
    base = os.path.join(ROOT, cfg["bundle_dir"])
    if not os.path.isdir(base):
        log(f"  ! нет каталога сборки {base}")
        return []
    out = []
    for cur, _d, files in os.walk(base):
        for fn in files:
            if fn.endswith(".sig"):
                continue
            for ftype, pat in cfg["patterns"]:
                if re.search(pat, fn):
                    full = os.path.join(cur, fn)
                    sig = ""
                    sp = full + ".sig"
                    if os.path.isfile(sp):
                        sig = open(sp, encoding="utf-8").read().strip()
                    out.append({"path": full, "file_type": ftype,
                                "platform": cfg["platform"], "signature": sig})
                    break
    # updater обязан быть подписан, иначе Tauri молча отвергнет обновление.
    for a in out:
        if a["file_type"] == "updater" and not a["signature"]:
            log(f"  ! {os.path.basename(a['path'])}: нет .sig — апдейт не примут")
    return out


def multipart(fields, filepath):
    """Собрать multipart-тело вручную: сервер парсит его сам, без multer."""
    boundary = "----vaultbase" + base64.b16encode(os.urandom(8)).decode()
    body = b""
    for k, v in fields.items():
        body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n"
                 f"{v}\r\n").encode()
    fn = os.path.basename(filepath)
    ctype = mimetypes.guess_type(fn)[0] or "application/octet-stream"
    body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
             f"filename=\"{fn}\"\r\nContent-Type: {ctype}\r\n\r\n").encode()
    body += open(filepath, "rb").read() + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    return boundary, body


def upload(art, version, notes, publish, user, pw):
    fields = {"version": version, "notes": notes, "platform": art["platform"],
              "file_type": art["file_type"], "signature": art["signature"],
              "publish": "1" if publish else "0"}
    boundary, body = multipart(fields, art["path"])
    auth = base64.b64encode(f"{user}:{pw}".encode()).decode()
    req = urllib.request.Request(
        f"{SERVER_URL}{ADMIN_PATH}/upload", data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}",
                 "Authorization": f"Basic {auth}", "User-Agent": UA,
                 "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=900) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}: {e.read().decode()[:300]}"}


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            if r.status == 204:
                return 204, None
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, None


def write_changelog(version, notes):
    p = os.path.join(ROOT, "CHANGELOG.md")
    s = open(p, encoding="utf-8").read()
    today = datetime.date.today().isoformat()
    body = "\n".join(f"- {ln.strip()}" if not ln.strip().startswith(("-", "#", "*")) else ln
                     for ln in notes.strip().splitlines() if ln.strip())
    entry = f"\n## [{version}] — {today}\n\n### Изменения\n\n{body}\n"
    marker = "and this project adheres to [Semantic Versioning]"
    i = s.find(marker)
    i = s.find("\n", i) + 1 if i != -1 else 0
    open(p, "w", encoding="utf-8").write(s[:i] + entry + s[i:])
    log(f"  CHANGELOG.md: добавлен раздел [{version}]")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", help="новая версия, напр. 2.5.2")
    ap.add_argument("--notes", default="", help="описание релиза (или --notes-file)")
    ap.add_argument("--notes-file", help="файл с описанием релиза")
    ap.add_argument("--platforms", default="win", help="win,linux (через запятую)")
    ap.add_argument("--publish", action="store_true", help="сразу опубликовать")
    ap.add_argument("--skip-build", action="store_true", help="не собирать, взять готовое")
    ap.add_argument("--dry-run", action="store_true", help="ничего не заливать")
    a = ap.parse_args()

    notes = a.notes
    if a.notes_file:
        notes = open(os.path.join(ROOT, a.notes_file), encoding="utf-8").read()
    if not notes.strip():
        notes = "Обновление VaultBase."

    cur = read_versions()
    if len(set(cur.values())) != 1:
        die("версии рассинхронизированы: " + ", ".join(f"{k}={v}" for k, v in cur.items()))
    old = list(cur.values())[0]
    version = a.version or old
    log(f"Текущая версия: {old} -> релиз: {version}")

    if version != old and not a.dry_run:
        set_version(version)

    plats = [p.strip() for p in a.platforms.split(",") if p.strip()]
    for p in plats:
        if p not in TARGETS:
            die(f"неизвестная платформа {p}; доступны: {', '.join(TARGETS)}")

    key = os.environ.get("TAURI_SIGNING_PRIVATE_KEY_PATH",
                         os.path.join(ROOT, ".secrets", "vaultbase-updater.key"))

    if not a.skip_build:
        for p in plats:
            log(f"\n[сборка] {p}")
            if a.dry_run:
                log("  dry-run: пропуск")
            else:
                build(p, key)

    arts = []
    for p in plats:
        found = find_artifacts(p, version)
        log(f"\n[артефакты] {p}: найдено {len(found)}")
        for x in found:
            mb = os.path.getsize(x["path"]) / 1048576
            log(f"  {x['file_type']:20} {mb:7.1f} MB  {'подписан' if x['signature'] else 'БЕЗ ПОДПИСИ'}  {os.path.basename(x['path'])}")
        arts += found
    if not arts:
        die("артефактов не найдено — сборка не прошла?")

    if a.dry_run:
        log("\ndry-run: заливка пропущена")
        return

    user = os.environ.get("ADMIN_USER", "admin")
    pw = os.environ.get("ADMIN_PASS")
    if not pw:
        die("задайте ADMIN_PASS в окружении")

    log(f"\n[заливка] в {SERVER_URL}{ADMIN_PATH}/upload")
    ok = 0
    for x in arts:
        res = upload(x, version, notes, a.publish, user, pw)
        if res.get("ok"):
            ok += 1
            log(f"  OK   {res['filename']}  ({res['file_size_mb']} MB)")
        else:
            log(f"  СБОЙ {os.path.basename(x['path'])}: {res.get('error')}")
    log(f"  залито {ok}/{len(arts)}")

    write_changelog(version, notes)

    log("\n[проверка апдейтера]")
    code, data = get_json(f"{SERVER_URL}/update?current_version={old}")
    if code == 200 and data:
        log(f"  клиент {old} увидит {data.get('version')}, платформы: {', '.join(data.get('platforms', {}))}")
    elif code == 204:
        log(f"  204 — обновление НЕ видно (не опубликовано? нужен --publish)")
    else:
        log(f"  HTTP {code}")
    code, _ = get_json(f"{SERVER_URL}/update?current_version={version}")
    log(f"  клиент {version}: HTTP {code} (ожидается 204 — он уже свежий)")

    log("\nГОТОВО.")


if __name__ == "__main__":
    main()
