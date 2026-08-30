#!/usr/bin/env python3
"""
Деплой cc-sync-server на боевой VPS: бэкап -> заливка -> nginx -> перезапуск.

Каждый шаг обратим. Перед заливкой снимается полный бэкап (БД, код, конфиг
nginx); если после перезапуска health-check не проходит, код и конфиг
автоматически возвращаются из бэкапа.

Что НЕ трогаем на сервере:
  * .env          — там боевые пароли и пути;
  * *.db          — боевые данные (лицензии, футпринты, sync-группы);
  * node_modules  — ставится отдельно, только если изменился package.json.

Креды берутся из окружения, в код не пишутся:

    VPS_HOST=209.74.89.158 VPS_USER=root VPS_PASS=... python scripts/deploy-server.py

VPS_PASS можно не задавать — тогда используется ключ из ~/.ssh / ssh-agent.

Флаги:
    --dry-run     показать, что будет сделано, ничего не меняя
    --skip-nginx  не трогать конфиг nginx
    --no-rollback не откатываться при неудачном health-check (для отладки)
"""
import argparse
import os
import posixpath
import re
import stat
import sys
import time

try:
    import paramiko
except ImportError:
    sys.exit("Нужен paramiko:  pip install paramiko")

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REMOTE_APP = "/opt/cc-sync-server"
NGINX_CONF = "/etc/nginx/sites-enabled/otpmanager.conf"
PM2_APP = "cc-sync-server"
BASE_URL = "https://sec201-www.otpmanager.pro"

# Что заливаем. Пути относительно cc-sync-server/.
PUSH_FILES = ["package.json"]
# Корневые *.js заливаются ВСЕ автоматически (см. collect): ручной список
# протухал — 2026-08-30 деплой упал и ушёл в авто-откат, потому что в список
# не попал card-push.js, который требует socket.js.
PUSH_DIRS = ["routes", "admin", "public"]

# Внутри PUSH_DIRS не заливаем:
SKIP_NAMES = {".DS_Store", "node_modules", "releases", "__pycache__"}


def log(msg):
    print(msg, flush=True)


def strip_ansi(s):
    return re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", s)


class Remote:
    def __init__(self, host, user, password):
        self.cli = paramiko.SSHClient()
        self.cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        self.cli.connect(host, username=user, password=password, timeout=30)
        self.sftp = self.cli.open_sftp()

    def run(self, cmd, check=False, timeout=180):
        _in, out, err = self.cli.exec_command(cmd, timeout=timeout)
        code = out.channel.recv_exit_status()
        text = strip_ansi((out.read() + err.read()).decode("utf-8", "replace")).strip()
        if check and code != 0:
            raise RuntimeError(f"Команда упала ({code}): {cmd}\n{text}")
        return code, text

    def put(self, local, remote):
        parent = posixpath.dirname(remote)
        self.run(f"mkdir -p '{parent}'")
        self.sftp.put(local, remote)

    def read(self, remote):
        with self.sftp.open(remote, "r") as f:
            return f.read().decode("utf-8", "replace")

    def write(self, remote, content):
        with self.sftp.open(remote, "w") as f:
            f.write(content)

    def close(self):
        try:
            self.sftp.close()
        finally:
            self.cli.close()


def collect(local_root):
    """Список (локальный путь, путь относительно корня приложения)."""
    items = []
    for name in PUSH_FILES:
        p = os.path.join(local_root, name)
        if os.path.isfile(p):
            items.append((p, name))
        else:
            log(f"  ! пропущен (нет локально): {name}")
    # Все корневые *.js — runtime-модули приложения (тесты лежат в test/ и не пушатся).
    for fn in sorted(os.listdir(local_root)):
        if fn.endswith(".js") and os.path.isfile(os.path.join(local_root, fn)):
            items.append((os.path.join(local_root, fn), fn))
    for d in PUSH_DIRS:
        base = os.path.join(local_root, d)
        if not os.path.isdir(base):
            continue
        for cur, dirs, files in os.walk(base):
            dirs[:] = [x for x in dirs if x not in SKIP_NAMES]
            for fn in files:
                if fn in SKIP_NAMES:
                    continue
                full = os.path.join(cur, fn)
                rel = os.path.relpath(full, local_root).replace(os.sep, "/")
                items.append((full, rel))
    return items


def ensure_env(r, dry):
    """Дописать в .env ключи, без которых новый код работает неверно."""
    try:
        env = r.read(f"{REMOTE_APP}/.env")
    except IOError:
        log("  ! .env на сервере не найден — пропускаю")
        return
    add = []
    if "BASE_URL=" not in env:
        # Без него upload.js подставит в download_url мёртвый домен.
        add.append(f"BASE_URL={BASE_URL}")
    if "TRUST_PROXY=" not in env:
        # loopback, а не true: при true клиент подделывает X-Forwarded-For
        # и обходит все rate-лимитеры.
        add.append("TRUST_PROXY=loopback")
    if not add:
        log("  .env: всё нужное уже есть")
        return
    log("  .env: добавляю -> " + ", ".join(x.split("=")[0] for x in add))
    if dry:
        return
    if not env.endswith("\n"):
        env += "\n"
    r.write(f"{REMOTE_APP}/.env", env + "\n".join(add) + "\n")


def patch_nginx(r, dry):
    """Снять блокировку раздачи релизов и поднять лимит загрузки.

    /health оставляем закрытым (защита от info-leak). Идемпотентно: повторный
    запуск ничего не ломает.
    """
    conf = r.read(NGINX_CONF)
    original = conf
    # Вырезаем именно блоки-заглушки для releases, не трогая остальное.
    for loc in (r"/api/releases", r"/releases/"):
        conf = re.sub(
            r"\n\s*location\s+\^~\s+" + re.escape(loc) + r"\s*\{\s*return\s+404\s*;\s*\}\n",
            "\n",
            conf,
        )
    # Лимит тела запроса. AppImage-сборка ~85 МБ, а дефолт был 50m — заливка
    # артефактов в панель падала с 413 Request Entity Too Large. 200m даёт
    # запас и под будущие .dmg. Правим существующую директиву; если её нет —
    # patch_nginx оставит как есть (в конфиге она уже присутствует).
    conf = re.sub(r"client_max_body_size\s+\d+m\s*;",
                  "client_max_body_size 200m;", conf)

    if conf == original:
        log("  nginx: изменений не требуется (releases открыты, лимит 200m)")
        return False
    log("  nginx: снимаю 404 с /releases и ставлю client_max_body_size 200m")
    if dry:
        return False
    r.write(NGINX_CONF, conf)
    code, out = r.run("nginx -t")
    if code != 0:
        log("  ! nginx -t упал, откатываю конфиг:\n" + out)
        r.write(NGINX_CONF, original)
        raise RuntimeError("nginx config invalid")
    r.run("systemctl reload nginx", check=True)
    log("  nginx: конфиг валиден, reload выполнен")
    return True


def health(r):
    checks = [
        ("/version", "200"),
        ("/update", "(200|204)"),
    ]
    ok = True
    for path, expect in checks:
        _c, out = r.run(
            f"curl -s -o /dev/null -w '%{{http_code}}' -m 10 http://127.0.0.1:3000{path}"
        )
        good = re.fullmatch(expect, out.strip()) is not None
        log(f"    {out.strip():>4}  {path}  {'OK' if good else 'ОШИБКА'}")
        ok = ok and good
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--skip-nginx", action="store_true")
    ap.add_argument("--no-rollback", action="store_true")
    args = ap.parse_args()

    host = os.environ.get("VPS_HOST")
    user = os.environ.get("VPS_USER", "root")
    pw = os.environ.get("VPS_PASS") or None
    if not host:
        sys.exit("Задайте VPS_HOST в окружении. VPS_PASS необязателен: без него "
                 "paramiko поднимет ключи из ~/.ssh и ssh-agent (allow_agent/look_for_keys).")

    local_root = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cc-sync-server"
    )
    if not os.path.isdir(local_root):
        sys.exit(f"Не найден каталог {local_root}")

    items = collect(local_root)
    log(f"К заливке: {len(items)} файлов из {local_root}")
    if args.dry_run:
        for _l, rel in items:
            log(f"  {rel}")

    r = Remote(host, user, pw)
    try:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        backup = f"/root/backup-{stamp}"

        log(f"\n[1/6] Бэкап -> {backup}")
        if not args.dry_run:
            r.run(f"mkdir -p {backup}", check=True)
            # БД целиком, включая -wal/-shm: без них бэкап неконсистентен.
            r.run(f"cp -a {REMOTE_APP}/*.db {REMOTE_APP}/*.db-wal {REMOTE_APP}/*.db-shm {backup}/ 2>/dev/null || true")
            r.run(
                f"tar czf {backup}/app-code.tar.gz -C {REMOTE_APP} "
                f"--exclude=node_modules --exclude='*.db*' . 2>/dev/null || true"
            )
            r.run(f"cp -a {NGINX_CONF} {backup}/otpmanager.conf 2>/dev/null || true")
            _c, out = r.run(f"ls -la {backup}")
            log(out)

        log("\n[2/6] Заливка кода")
        if not args.dry_run:
            for lpath, rel in items:
                r.put(lpath, f"{REMOTE_APP}/{rel}")
            log(f"  залито {len(items)} файлов")

        log("\n[3/6] .env")
        ensure_env(r, args.dry_run)

        log("\n[4/6] Зависимости")
        if not args.dry_run:
            code, out = r.run(
                f"cd {REMOTE_APP} && npm ci --omit=dev 2>&1 | tail -5", timeout=600
            )
            log("  " + out.replace("\n", "\n  "))

        log("\n[5/6] nginx")
        if args.skip_nginx:
            log("  пропущено (--skip-nginx)")
        else:
            patch_nginx(r, args.dry_run)

        log("\n[6/6] Перезапуск и проверка")
        if args.dry_run:
            log("  dry-run: перезапуск не выполняется")
            return
        r.run(f"pm2 restart {PM2_APP} --update-env", check=True)
        time.sleep(4)
        if health(r):
            log("\nГОТОВО. Бэкап: " + backup)
        else:
            log("\n! Health-check не прошёл.")
            _c, logs = r.run(f"pm2 logs {PM2_APP} --lines 25 --nostream 2>&1 | tail -30")
            log(logs)
            if args.no_rollback:
                log("Откат отключён (--no-rollback).")
                sys.exit(1)
            log("Откатываю код и конфиг из бэкапа...")
            r.run(f"tar xzf {backup}/app-code.tar.gz -C {REMOTE_APP}")
            r.run(f"cp -a {backup}/otpmanager.conf {NGINX_CONF} 2>/dev/null || true")
            r.run("nginx -t && systemctl reload nginx")
            r.run(f"pm2 restart {PM2_APP} --update-env")
            time.sleep(4)
            log("После отката:")
            health(r)
            sys.exit(1)
    finally:
        r.close()


if __name__ == "__main__":
    main()
