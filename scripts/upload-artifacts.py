#!/usr/bin/env python3
"""
Заливка собранных артефактов в админ-панель VaultBase.

Используется и из GitHub Actions (после сборки всех платформ), и локально.
Рекурсивно обходит каталог, распознаёт тип и платформу по имени файла,
подхватывает рядом лежащие .sig-подписи и отправляет всё в <ADMIN_PATH>/upload.

    python3 scripts/upload-artifacts.py --dir artifacts --version 2.5.1 \
        --notes "Автосборка v2.5.1" --publish

Режим менеджера (VaultBase Manager, CI-теги mgr-v*):

    python3 scripts/upload-artifacts.py --dir artifacts --app manager \
        --version 0.2.0 --publish [--channel beta] [--rollout 25]

Заливает ТОЛЬКО updater-артефакты как file_type=manager-updater: инсталлеры
для ручной загрузки на сервер не идут (менеджер не раздаётся с публичной
страницы воркера), а /update?app=manager читает ровно этот тип.

Окружение (в код ничего не зашивается):
    SERVER_URL   https://sec201-www.otpmanager.pro
    ADMIN_PATH   /ghostadmin/1asfd-54-local
    ADMIN_USER   admin
    ADMIN_PASS   <пароль админки>
"""
import argparse
import base64
import json
import mimetypes
import os
import re
import sys
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SERVER_URL = os.environ.get("SERVER_URL", "https://sec201-www.otpmanager.pro").rstrip("/")
ADMIN_PATH = os.environ.get("ADMIN_PATH", "/ghostadmin/1asfd-54-local").rstrip("/")
# Перед Node стоит Cloudflare: без браузерного UA он отдаёт 403 (код 1010).
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

# Порядок важен: первое совпадение выигрывает, поэтому архивы апдейтера
# (.msi.zip, .app.tar.gz) стоят выше «голых» .msi/.dmg.
RULES = [
    (r"\.msi\.zip$",          "updater",            "windows-x86_64"),
    (r"-setup\.nsis\.zip$",   "updater",            "windows-x86_64"),
    (r"\.AppImage\.tar\.gz$", "updater",            "linux-x86_64"),
    (r"\.app\.tar\.gz$",      "updater",            None),  # платформа по имени файла
    (r"\.msi$",               "installer-msi",      "windows-x86_64"),
    (r"-setup\.exe$",         "installer-nsis",     "windows-x86_64"),
    (r"\.deb$",               "installer-deb",      "linux-x86_64"),
    (r"\.AppImage$",          "installer-appimage", "linux-x86_64"),
    (r"\.dmg$",               "installer-dmg",      None),
]

# Какой installer-тип служит источником обновления для платформы, если Tauri
# не создал отдельный updater-архив.
#
# В Tauri v2 на Windows апдейтер скачивает подписанный .msi напрямую — файлов
# .msi.zip больше нет, подпись кладётся рядом как .msi.sig. Поэтому такой .msi
# заливается ДВАЖДЫ: как installer-msi (кнопка «скачать» на странице) и как
# updater (то, что подтянет встроенное обновление). На Linux ту же роль играет
# .AppImage. Без этого /update отдавал бы пустой platforms{} и обновление
# не приезжало бы вообще.
UPDATER_SOURCE = {
    "installer-msi": "windows-x86_64",
    "installer-appimage": "linux-x86_64",
}


def mac_platform(path):
    """Отличить Apple Silicon от Intel по пути артефакта GitHub Actions."""
    p = path.replace("\\", "/").lower()
    if "aarch64" in p or "arm64" in p or "silicon" in p:
        return "darwin-aarch64"
    return "darwin-x86_64"


def classify(path):
    name = os.path.basename(path)
    for pat, ftype, plat in RULES:
        if re.search(pat, name, re.I):
            return ftype, (plat or mac_platform(path))
    return None, None


def collect(root):
    out = []
    for cur, _dirs, files in os.walk(root):
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
            out.append({"path": full, "file_type": ftype, "platform": plat,
                        "signature": sig})

    # Если для платформы нет отдельного updater-архива, назначаем им
    # подписанный инсталлятор (см. UPDATER_SOURCE). Дубликат создаётся только
    # при наличии подписи: без неё Tauri обновление всё равно отвергнет.
    have = {x["platform"] for x in out if x["file_type"] == "updater"}
    for x in list(out):
        plat = UPDATER_SOURCE.get(x["file_type"])
        if plat and plat not in have and x["signature"]:
            out.append({**x, "file_type": "updater"})
            have.add(plat)
    return out


def multipart(fields, filepath):
    boundary = "----vaultbase" + base64.b16encode(os.urandom(8)).decode()
    body = b""
    for k, v in fields.items():
        body += (f"--{boundary}\r\nContent-Disposition: form-data; "
                 f"name=\"{k}\"\r\n\r\n{v}\r\n").encode()
    fn = os.path.basename(filepath)
    ctype = mimetypes.guess_type(fn)[0] or "application/octet-stream"
    body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
             f"filename=\"{fn}\"\r\nContent-Type: {ctype}\r\n\r\n").encode()
    body += open(filepath, "rb").read() + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    return boundary, body


def upload(art, version, notes, publish, user, pw, channel="stable", rollout=100):
    fields = {"version": version, "notes": notes, "platform": art["platform"],
              "file_type": art["file_type"], "signature": art["signature"],
              "publish": "1" if publish else "0",
              "channel": channel, "rollout_percent": str(rollout)}
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
    except Exception as e:
        return {"error": str(e)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True, help="каталог со сборками")
    ap.add_argument("--version", required=True)
    ap.add_argument("--notes", default="")
    ap.add_argument("--publish", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--app", choices=["worker", "manager"], default="worker",
                    help="worker — воркер (по умолчанию); manager — VaultBase Manager")
    ap.add_argument("--channel", choices=["stable", "beta"], default="stable",
                    help="канал релиза (staged rollout менеджера)")
    ap.add_argument("--rollout", type=int, default=100,
                    help="процент флота для staged rollout менеджера (0..100)")
    a = ap.parse_args()

    arts = collect(a.dir)
    if not arts:
        sys.exit(f"В {a.dir} не найдено ни одного распознанного артефакта")

    if a.app == "manager":
        # Менеджер заливает ТОЛЬКО updater-артефакты под своим file_type:
        # инсталлеры для ручной загрузки на сервер не идут (менеджер не
        # раздаётся с публичной страницы воркера), а ветка /update?app=manager
        # читает ровно file_type='manager-updater'.
        arts = [{**x, "file_type": "manager-updater"} for x in arts if x["file_type"] == "updater"]
        if not arts:
            sys.exit(f"В {a.dir} нет updater-артефактов менеджера (.app.tar.gz / .msi / .AppImage)")
    elif a.channel != "stable" or a.rollout != 100:
        sys.exit("--channel/--rollout имеют смысл только с --app manager")

    print(f"Найдено артефактов: {len(arts)}")
    for x in arts:
        mb = os.path.getsize(x["path"]) / 1048576
        mark = "подписан" if x["signature"] else ("БЕЗ ПОДПИСИ" if x["file_type"].endswith("updater") else "—")
        print(f"  {x['file_type']:20} {x['platform']:18} {mb:7.1f} MB  {mark}  {os.path.basename(x['path'])}")

    # Апдейтер без подписи Tauri молча отвергнет — лучше упасть здесь.
    unsigned = [x for x in arts if x["file_type"].endswith("updater") and not x["signature"]]
    if unsigned and not a.dry_run:
        sys.exit("Есть updater-артефакты без .sig — задайте TAURI_SIGNING_PRIVATE_KEY при сборке")

    if a.dry_run:
        print("dry-run: заливка пропущена")
        return

    pw = os.environ.get("ADMIN_PASS")
    if not pw:
        sys.exit("Задайте ADMIN_PASS в окружении")
    user = os.environ.get("ADMIN_USER", "admin")

    print(f"\nЗаливаю в {SERVER_URL}{ADMIN_PATH}/upload")
    if a.app == "manager":
        print(f"  app=manager, канал={a.channel}, rollout={a.rollout}%")
    ok = 0
    for x in arts:
        res = upload(x, a.version, a.notes, a.publish, user, pw, a.channel, a.rollout)
        if res.get("ok"):
            ok += 1
            print(f"  OK   {res['filename']} ({res['file_size_mb']} MB)")
        else:
            print(f"  СБОЙ {os.path.basename(x['path'])}: {res.get('error')}")
    print(f"\nЗалито {ok}/{len(arts)}")
    if ok != len(arts):
        sys.exit(1)


if __name__ == "__main__":
    main()
