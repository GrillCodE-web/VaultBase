#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
VaultBase — аудит инфраструктуры: sync-сервер, API, WS, релизы, обновления.

Использование:
    python scripts/audit-infrastructure.py
    python scripts/audit-infrastructure.py --base-url https://sec201-www.otpmanager.pro
    python scripts/audit-infrastructure.py --json
    python scripts/audit-infrastructure.py --deep    # auth-flow WS с реальной лицензией из локальной БД
    python scripts/audit-infrastructure.py --deep --iid <installation_id>   # если лицензии нет в %LOCALAPPDATA%

Без --deep пингует только публичную поверхность (никаких токенов).
С --deep извлекает license_token/installation_id из локальной БД юзера
(%LOCALAPPDATA%\\vaultbase\\vaultbase.db — читает на машине, не утекает наружу)
и проверяет полный WS-callback: auth_challenge -> auth -> auth_ok.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sqlite3
import socket
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    import websocket  # pip install websocket-client
    _HAS_WS = True
except ImportError:
    websocket = None  # type: ignore
    _HAS_WS = False

DEFAULT_BASE = "https://sec201-www.otpmanager.pro"
UA = {"User-Agent": "VaultBaseAudit/1.0"}

# ── цветной вывод ────────────────────────────────────────────
_OK, _WARN, _FAIL, _SKIP, _INFO = "OK", "WARN", "FAIL", "SKIP", "INFO"
_REPORT: list[dict] = []


def _emit(sev: str, area: str, msg: str, detail: str = "") -> None:
    _REPORT.append({"sev": sev, "area": area, "msg": msg, "detail": detail})
    sym = {_OK: "[+] ", _WARN: "[!] ", _FAIL: "[x] ", _SKIP: "[-] ", _INFO: "[i] "}[sev]
    line = f"{sym}{area}: {msg}"
    if detail:
        line += f"  ({detail})"
    print(line)


# ── HTTP helper ──────────────────────────────────────────────
def http(method: str, url: str, body: dict | None = None,
         token: str | None = None, timeout: int = 10) -> tuple[int, str]:
    data = None
    headers = dict(UA)
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        try:
            return e.code, e.read().decode("utf-8", "replace")
        except Exception:
            return e.code, ""
    except urllib.error.URLError as e:
        return -1, str(e.reason)
    except Exception as e:  # noqa
        return -1, str(e)


def join(base: str, p: str) -> str:
    return f"{base.rstrip('/')}/{p.lstrip('/')}"


# ── локальная БД (deep-режим) ────────────────────────────────
def load_local_license() -> dict | None:
    """Читает license_token/installation_id локально (Windows).

    БД — SQLCipher (SEC-005): файл без пароля юзера не открывается, desktop.json
    хранит только UI-настройки. Значит источники:
      1) AEG vault-кэш (расшифровывается ключом из MasterKeyring, без пароля)
      2) приглашение на включение: ручной ввод --token / --iid
      3) none → deep-этапы SKIP
    """
    lad = os.environ.get("LOCALAPPDATA")
    if not lad:
        return None
    base_dir = os.path.join(lad, "vaultbase")
    for cand in ("runtime.json", "license.json", "auth.json", "license.dat"):
        p = os.path.join(base_dir, cand)
        if os.path.exists(p):
            try:
                with open(p, encoding="utf-8") as fh:
                    cfg = json.load(fh)
                if cfg.get("license_token"):
                    return {"license_token": cfg["license_token"],
                            "installation_id": cfg.get("installation_id")}
            except (json.JSONDecodeError, OSError):
                continue
    return None


# ════════════════════════════════════════════════════════════
#  Проверки
# ════════════════════════════════════════════════════════════

def check_reachability(base: str) -> bool:
    code, body = http("GET", join(base, "/"), timeout=8)
    if code == 200:
        _emit(_OK, "http", "сервер отвечает", f"GET / -> {code}")
        return True
    if code in (301, 302, 401, 403, 404):
        _emit(_WARN, "http", "сервер жив, но корень не 200", f"GET / -> {code}")
        return True
    _emit(_FAIL, "http", "сервер не отвечает", f"GET / -> {code} {body[:80]}")
    return False


def check_version(base: str) -> dict | None:
    code, body = http("GET", join(base, "/version"), timeout=8)
    if code != 200:
        _emit(_FAIL, "version", "эндпоинт /version недоступен", f"{code}")
        return None
    try:
        data = json.loads(body)
        _emit(_OK, "version", f"latest={data.get('version')}",
              data.get("pub_date", ""))
        return data
    except json.JSONDecodeError:
        _emit(_FAIL, "version", "невалидный JSON", body[:80])
        return None


def check_update(base: str, current: str) -> None:
    url = join(base, f"/update?current_version={urllib.parse.quote(current)}")
    code, body = http("GET", url, timeout=10)
    if code == 204:
        _emit(_OK, "update", f"по /update свежей версии нет (latest == {current}?)", "204")
        return
    if code != 200:
        _emit(_FAIL, "update", "неожиданный код", f"{code} {body[:80]}")
        return
    try:
        data = json.loads(body)
        plats = list((data.get("platforms") or {}).keys())
        _emit(_OK, "update",
              f"доступна {data.get('version')} для {current}",
              f"platforms={plats}")
        if not plats:
            _emit(_FAIL, "update", "в ответе нет платформ",
                  "апдейтер ответит «нет подходящей ОС»")
        for key in ("windows-x86_64", "linux-x86_64", "darwin-aarch64"):
            if key not in plats:
                _emit(_WARN, "update", f"не хватает платформы {key}",
                      "юзеры этой ОС не обновятся")
        for key in plats:
            file_url = (data["platforms"][key] or {}).get("url")
            if not file_url:
                _emit(_FAIL, "update", f"у платформы {key} нет URL файла")
                continue
            sig = (data["platforms"][key] or {}).get("signature")
            if not sig:
                _emit(_WARN, "update", f"у платформы {key} нет подписи",
                      "апдейтер Tauri откажется ставить (unsigned)")
            fcode, _ = http("HEAD", file_url, timeout=8)
            if fcode == 200:
                _emit(_OK, "update", f"артефакт {key} доступен",
                      urllib.parse.urlparse(file_url).path.rsplit("/", 1)[-1])
            else:
                _emit(_FAIL, "update", f"артефакт {key} не качается",
                      f"{fcode} {file_url[:90]}")
    except json.JSONDecodeError:
        _emit(_FAIL, "update", "невалидный JSON", body[:80])


def check_https_and_tls(base: str) -> None:
    if not base.startswith("https://"):
        _emit(_FAIL, "tls", "базовый URL не https", base)
        return
    host = urllib.parse.urlparse(base).hostname
    try:
        ctx = ssl.create_default_context()
        with ctx.wrap_socket(
                # поднимаем TCP и берём сертификат
                socket.create_connection((host, 443), timeout=8),
                server_hostname=host) as s:
            cert = s.getpeercert()
            not_after = cert.get("notAfter", "?")
            _emit(_OK, "tls", "сертификат валиден", f"expires {not_after}")
    except Exception as e:  # noqa
        _emit(_FAIL, "tls", "TLS-подключение упало", str(e)[:100])


def check_api_surface(base: str) -> None:
    """Бьём публичные роуты — ждём 401/404/405 и по набору судим, что где живёт."""
    probes = [
        ("GET",  "/version",                    200,  "version"),
        ("GET",  "/update",                     (200, 204, 401), "updater"),
        ("POST", "/activate",                   (400, 401), "license activate"),
        ("POST", "/verify",                     (400, 401), "license verify"),
        ("POST", "/footprint",                  (400, 401), "footprint"),
        ("GET",  "/sync/chat/peers",            401,  "chat peers"),
        ("GET",  "/sync/chat/messages",         401,  "chat messages"),
        ("POST", "/sync/chat/send",             401,  "chat send"),
        ("GET",  "/sync/slices/pull",           401,  "slices pull"),
        ("POST", "/sync/group/stats",           401,  "LEGACY group stats"),
        ("GET",  "/sync/group/workers",         401,  "LEGACY group workers"),
        ("GET",  "/manager/api/connections",    401,  "LEGACY manager api"),
        ("POST", "/api/telemetry/heartbeat",    401,  "telemetry heartbeat"),
        ("GET",  "/api/telemetry/keys",         401,  "telemetry keys"),
        ("GET",  "/api/telemetry/news",         401,  "telemetry news"),
        ("GET",  "/api/telemetry/priorities",   401,  "telemetry priorities"),
    ]
    for method, path, expect, label in probes:
        code, body = http(method, join(base, path), timeout=8)
        ok = (code == expect) if isinstance(expect, int) \
            else (code in expect)
        if ok:
            _emit(_OK, "api", f"{label}", f"{method} {path} -> {code}")
        elif code == 404:
            _emit(_FAIL, "api", f"{label} ОТСУТСТВУЕТ НА СЕРВЕРЕ (404)",
                  f"{method} {path}")
        else:
            _emit(_WARN, "api", f"{label} — неожиданный код {code}",
                  f"{method} {path} тело: {body[:60]}")


def check_ws_handshake(base: str, token: str | None, iid: str | None) -> None:
    """Три уровня: 1) TLS+Upgrade, 2) ожидание auth_challenge, 3) auth->auth_ok."""
    host = urllib.parse.urlparse(base).hostname
    url = f"wss://{host}/ws"
    if not _HAS_WS:
        _emit(_SKIP, "ws", "нет пакета websocket-client", "pip install websocket-client")
        return
    # —— до auth_challenge
    try:
        ws = websocket.create_connection(url, timeout=8,
                                         sslopt={"cert_reqs": ssl.CERT_REQUIRED})
    except Exception as e:  # noqa
        _emit(_FAIL, "ws", "не удалось подключиться", str(e)[:120])
        return
    _emit(_OK, "ws", "WS рукопожатие", url)
    try:
        ws.settimeout(6)
        msg = ws.recv()
        try:
            data = json.loads(msg)
        except json.JSONDecodeError:
            _emit(_WARN, "ws", "первый фрейм не JSON", msg[:80])
            data = {}
        if data.get("type") == "auth_challenge" and data.get("nonce"):
            _emit(_OK, "ws", "auth_challenge + nonce (MGR-008)",
                  f"ts={data.get('ts')}")
        else:
            _emit(_WARN, "ws", "нет auth_challenge (старый протокол)",
                  f"type={data.get('type')}")
    except websocket.WebSocketTimeoutException:
        _emit(_WARN, "ws", "сервер не прислал auth_challenge за 6с",
              "ws_require_nonce может быть выкл")
        ws.close()
        return
    except Exception as e:  # noqa
        _emit(_FAIL, "ws", "сбой чтения auth_challenge", str(e)[:100])
        ws.close()
        return

    # —— deep: полный auth
    if token:
        tok_hash = hashlib.sha256(token.encode()).hexdigest()
        auth = {"type": "auth", "token": tok_hash}
        nonce = data.get("nonce")
        if nonce:
            auth["nonce"] = nonce
        if iid:
            auth["installation_id"] = iid
        try:
            ws.send(json.dumps(auth))
            ws.settimeout(6)
            reply = json.loads(ws.recv())
            if reply.get("type") == "auth_ok":
                _emit(_OK, "ws", "auth -> auth_ok",
                      f"iid={str(reply.get('installation_id'))[:8]}…")
            else:
                _emit(_FAIL, "ws", "auth отклонён",
                      f"{reply.get('type')}: {reply.get('error')}")
        except Exception as e:  # noqa
            _emit(_FAIL, "ws", "сбой auth-обмена", str(e)[:100])
    else:
        _emit(_SKIP, "ws", "нет license_token — auth-flow не проверялся",
              "нужен --deep или --token")
    ws.close()


def check_sync_endpoints(base: str, token: str | None) -> None:
    """Проверяем воркерские sync-роуты уже с токеном (deep)."""
    if not token:
        _emit(_SKIP, "sync", "нет license_token — sync-роуты не проверялись")
        return
    tok_hash = hashlib.sha256(token.encode()).hexdigest()
    for path in ("/sync/slices/pull", "/sync/chat/peers"):
        code, body = http("GET", join(base, path), token=tok_hash, timeout=10)
        if code == 200:
            _emit(_OK, "sync", f"{path}", body[:80])
        elif code in (401, 403):
            _emit(_FAIL, "sync", f"{path} — авторизация не прошла {code}",
                  body[:80])
        else:
            _emit(_WARN, "sync", f"{path} -> {code}", body[:60])



def local_app_version() -> str | None:
    lad = os.environ.get("LOCALAPPDATA")
    if not lad:
        return None
    p = os.path.join(lad, "com.vaultbase.app", ".build_version")
    if os.path.exists(p):
        try:
            return open(p, encoding="utf-8").read().strip()
        except OSError:
            return None
    return None


# ════════════════════════════════════════════════════════════

def main() -> int:
    ap = argparse.ArgumentParser(description="VaultBase infra audit")
    ap.add_argument("--base-url", default=os.environ.get("VAULTBASE_SERVER_URL", DEFAULT_BASE))
    ap.add_argument("--json", action="store_true", help="JSON-отчёт в stdout")
    ap.add_argument("--deep", action="store_true",
                    help="читать license_token из локальной БД и проверить WS auth-flow")
    ap.add_argument("--token", default=None, help="переопределить license_token")
    ap.add_argument("--iid", default=None, help="переопределить installation_id")
    args = ap.parse_args()

    base = args.base_url.rstrip("/")
    print(f"== VaultBase infra audit — {base} — {time.strftime('%Y-%m-%d %H:%M:%S')}\n")

    check_https_and_tls(base)
    if not check_reachability(base):
        if args.json:
            print(json.dumps(_REPORT, ensure_ascii=False, indent=2))
        return 1

    latest = check_version(base)
    current = local_app_version() or (latest or {}).get("version") or "0.0.0"
    check_update(base, current)
    check_api_surface(base)
    local_v = local_app_version()
    if local_v and latest and latest.get("version") != local_v:
        _emit(_WARN, "release",
              f"на машине {local_v}, на сервере latest={latest.get('version')}",
              "юзерам с ручной установкой не придёт upstream-обновление")
    elif local_v and latest:
        _emit(_OK, "release", f"версия на машине == latest ({local_v})")

    token = args.token
    iid = args.iid
    if args.deep and not token:
        lic = load_local_license()
        if lic:
            token = lic["license_token"]
            iid = iid or lic.get("installation_id")
            _emit(_INFO, "license", "license_token подхвачен из локальной БД",
                  f"iid={str(iid)[:8]}…")
        else:
            _emit(_WARN, "license", "локальная БД не найдена/пуста",
                  "deep-проверки sync/auth будут SKIP")
    check_ws_handshake(base, token, iid)
    check_sync_endpoints(base, token)

    print()
    fails = sum(1 for r in _REPORT if r["sev"] == _FAIL)
    warns = sum(1 for r in _REPORT if r["sev"] == _WARN)
    print(f"Итого: FAIL={fails} WARN={warns} OK={sum(1 for r in _REPORT if r['sev']==_OK)}")
    if args.json:
        print(json.dumps(_REPORT, ensure_ascii=False, indent=2))
    return 2 if fails else (1 if warns else 0)


if __name__ == "__main__":
    sys.exit(main())
