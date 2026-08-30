#!/usr/bin/env python3
"""
Публикация сборок напрямую на сервер по SSH (без пароля админ-панели).

Альтернатива scripts/upload-artifacts.py: тот ходит по HTTP в
<ADMIN_PATH>/upload и требует ADMIN_PASS. Здесь файлы кладутся в releases по
SFTP, а запись в БД делается локальным node-скриптом на самом сервере — нужны
только SSH-креды, которые и так есть у того, кто деплоит.

    VPS_HOST=... VPS_USER=root VPS_PASS=... \
        python scripts/publish-release.py --version 2.5.1 --notes "Прод-сборка"

Что записывается:
  * release_files — по строке на каждый артефакт (для страницы загрузки);
  * versions      — строка для updater-артефакта (её читает GET /update).

Про updater на Windows: Tauri v2 подписывает .msi напрямую (.msi.sig рядом),
отдельного .msi.zip не создаёт. Поэтому один и тот же .msi публикуется дважды —
как installer-msi (кнопка «Скачать») и как updater (авто-обновление).
"""
import argparse
import json
import os
import re
import sys

try:
    import paramiko
except ImportError:
    sys.exit("Нужен paramiko:  pip install paramiko")

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE_URL = os.environ.get("SERVER_URL", "https://sec201-www.otpmanager.pro").rstrip("/")
REMOTE_REL = "/opt/cc-sync-server/public/releases"
REMOTE_DB = "/opt/cc-sync-server/data.db"

# (регулярка имени, тип, платформа). Первое совпадение выигрывает.
RULES = [
    (r"\.msi\.zip$", "updater", "windows-x86_64"),
    (r"\.AppImage\.tar\.gz$", "updater", "linux-x86_64"),
    (r"\.msi$", "installer-msi", "windows-x86_64"),
    (r"-setup\.exe$", "installer-nsis", "windows-x86_64"),
    (r"\.deb$", "installer-deb", "linux-x86_64"),
    (r"\.AppImage$", "installer-appimage", "linux-x86_64"),
    (r"\.dmg$", "installer-dmg", None),
    (r"\.app\.tar\.gz$", "updater", None),
]
# Если отдельного updater-архива нет, источником обновления служит инсталлятор.
UPDATER_SOURCE = {"installer-msi": "windows-x86_64",
                  "installer-appimage": "linux-x86_64"}

# Регистрация в БД идёт этим скриптом уже на сервере: там есть better-sqlite3,
# и не нужно тащить БД на локальную машину.
REGISTER_JS = r"""
const Database = require('better-sqlite3');
const fs = require('fs');
const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const db = new Database(process.argv[3]);
for (const it of p.items) {
  const url = `${p.base}/releases/${it.name}`;
  // Ключ — (version, file_type, platform): с миграции v17 release_files
  // хранит по строке на ОС; поиск только по (version, file_type) находил бы
  // чужую платформу и затирал её (баг «живёт одна ОС»).
  const ex = db.prepare('SELECT id FROM release_files WHERE version=? AND file_type=? AND platform=?')
               .get(p.version, it.ftype, it.plat);
  if (ex) {
    db.prepare(`UPDATE release_files SET notes=?,download_url=?,signature=?,file_size=?,
      is_published=1,published_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(p.notes, url, it.sig || null, it.size, ex.id);
  } else {
    db.prepare(`INSERT INTO release_files
      (version,file_type,notes,download_url,signature,file_size,platform,is_published)
      VALUES (?,?,?,?,?,?,?,1)`)
      .run(p.version, it.ftype, p.notes, url, it.sig || null, it.size, it.plat);
  }
  if (it.ftype === 'updater') {
    const v = db.prepare('SELECT version FROM versions WHERE version=?').get(p.version);
    if (v) {
      db.prepare(`UPDATE versions SET notes=?,download_url=?,signature=?,file_size=?,
        platform=?,is_published=1,published_at=CURRENT_TIMESTAMP WHERE version=?`)
        .run(p.notes, url, it.sig || null, it.size, it.plat, p.version);
    } else {
      db.prepare(`INSERT INTO versions
        (version,notes,download_url,signature,file_size,platform,is_published)
        VALUES (?,?,?,?,?,?,1)`)
        .run(p.version, p.notes, url, it.sig || null, it.size, it.plat);
    }
  }
  console.log('  записан:', it.ftype, it.plat);
}
console.log('всего release_files:', db.prepare('SELECT COUNT(*) c FROM release_files').get().c);
"""


def mac_platform(path):
    p = path.replace("\\", "/").lower()
    return "darwin-aarch64" if ("aarch64" in p or "arm64" in p) else "darwin-x86_64"


def classify(path):
    name = os.path.basename(path)
    for pat, ftype, plat in RULES:
        if re.search(pat, name, re.I):
            return ftype, (plat or mac_platform(path))
    return None, None


def collect(root):
    out = []
    for cur, _d, files in os.walk(root):
        for fn in files:
            if fn.endswith(".sig"):
                continue
            full = os.path.join(cur, fn)
            ftype, plat = classify(full)
            if not ftype:
                continue
            sig = ""
            if os.path.isfile(full + ".sig"):
                sig = open(full + ".sig", encoding="utf-8").read().strip()
            out.append({"path": full, "ftype": ftype, "plat": plat, "sig": sig,
                        "size": os.path.getsize(full)})
    have = {x["plat"] for x in out if x["ftype"] == "updater"}
    for x in list(out):
        plat = UPDATER_SOURCE.get(x["ftype"])
        if plat and plat not in have and x["sig"]:
            out.append({**x, "ftype": "updater"})
            have.add(plat)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", required=True)
    ap.add_argument("--notes", default="")
    ap.add_argument("--dir", default="src-tauri/target/release/bundle")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    host, user = os.environ.get("VPS_HOST"), os.environ.get("VPS_USER", "root")
    pw = os.environ.get("VPS_PASS") or None
    if not host:
        sys.exit("Задайте VPS_HOST в окружении. VPS_PASS необязателен: без него "
                 "используется ключ из ~/.ssh / ssh-agent.")

    src = a.dir if os.path.isabs(a.dir) else os.path.join(ROOT, a.dir)
    arts = collect(src)
    if not arts:
        sys.exit(f"В {src} артефактов не найдено")

    print(f"Артефактов: {len(arts)}")
    for x in arts:
        mark = "подписан" if x["sig"] else ("БЕЗ ПОДПИСИ" if x["ftype"] == "updater" else "-")
        print(f"  {x['ftype']:20} {x['plat']:18} {x['size']/1048576:7.1f} MB  {mark}  {os.path.basename(x['path'])}")

    bad = [x for x in arts if x["ftype"] == "updater" and not x["sig"]]
    if bad:
        sys.exit("updater без .sig — пересоберите с TAURI_SIGNING_PRIVATE_KEY")
    if a.dry_run:
        print("dry-run: ничего не залито")
        return

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(host, username=user, password=pw, timeout=30)

    def run(cmd, t=180):
        _i, o, e = c.exec_command(cmd, timeout=t)
        code = o.channel.recv_exit_status()
        return code, re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "",
                            (o.read() + e.read()).decode("utf-8", "replace")).strip()

    try:
        run(f"mkdir -p {REMOTE_REL}")
        sftp = c.open_sftp()
        items = []
        seen = set()
        for x in arts:
            ext = ".tar.gz" if x["path"].lower().endswith(".tar.gz") else os.path.splitext(x["path"])[1]
            name = f"vaultbase-{a.version}-{x['plat']}-{x['ftype']}{ext}"
            if x["path"] not in seen:
                print(f"заливаю {name} ...")
                sftp.put(x["path"], f"{REMOTE_REL}/{name}")
            items.append({"name": name, "ftype": x["ftype"], "plat": x["plat"],
                          "sig": x["sig"], "size": x["size"]})
        payload = json.dumps({"version": a.version, "notes": a.notes,
                              "base": BASE_URL, "items": items})
        # Скрипт кладём В КАТАЛОГ ПРИЛОЖЕНИЯ, а не в /tmp: require() ищет
        # node_modules вверх от файла, и из /tmp better-sqlite3 не находится.
        remote_js = "/opt/cc-sync-server/.vb-register.js"
        remote_json = "/opt/cc-sync-server/.vb-release.json"
        with sftp.open(remote_json, "w") as f:
            f.write(payload)
        with sftp.open(remote_js, "w") as f:
            f.write(REGISTER_JS)
        sftp.close()

        code, out = run(f"cd /opt/cc-sync-server && node {remote_js} "
                        f"{remote_json} {REMOTE_DB}")
        print(out)
        run(f"rm -f {remote_json} {remote_js}")
        if code != 0:
            sys.exit("регистрация в БД не удалась")
        _c, out = run(f"ls -la {REMOTE_REL}")
        print("\nВ каталоге релизов:\n" + out)
        print("\nГОТОВО.")
    finally:
        c.close()


if __name__ == "__main__":
    main()
