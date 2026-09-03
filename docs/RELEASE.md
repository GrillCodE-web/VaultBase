# Выпуск версий VaultBase

**Обновлено:** 2026-08-30

Как собрать прод-версию, опубликовать её и как это работает у пользователя.
Воркер — теги `v*`, менеджер (VaultBase Manager) — теги `mgr-v*` (см. §9).

---

## 1. Быстрый путь: всё через GitHub Actions

Один тег — три платформы (Windows, Linux, macOS Apple Silicon) и
автоматическая заливка в панель.

```bash
# 1. Поднять версию в трёх файлах и закоммитить
python scripts/release.py --version 2.5.2 --skip-build --dry-run   # проверка
# 2. Тег
git tag v2.5.2 && git push origin v2.5.2
```

Дальше `.github/workflows/build-release.yml` сам:
собирает 3 таргета → подписывает → создаёт GitHub Release →
job `publish` заливает всё в админ-панель.

### Секреты репозитория (без них не заработает)

| Секрет                               | Что                                                 | Обязателен                                                  |
| ------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | содержимое `.secrets/vaultbase-updater.key`         | да — без него нет `.sig` и авто-апдейт не примут            |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | пароль ключа (у нас пустой)                         | нет                                                         |
| `TAURI_SIGNING_PRIVATE_KEY_MANAGER`  | содержимое `.secrets/vaultbase-manager-updater.key` | только для workflow менеджера (`build-manager-release.yml`) |
| `SERVER_URL`                         | `https://sec201-www.otpmanager.pro`                 | для job `publish`                                           |
| `ADMIN_PATH`                         | путь админки                                        | для job `publish`                                           |
| `ADMIN_USER` / `ADMIN_PASS`          | креды панели                                        | для job `publish`                                           |

Добавить: `Settings → Secrets and variables → Actions → New repository secret`.

Только macOS так и собирается — с Windows `.dmg` не сделать в принципе.

---

## 2. Локальная сборка (Windows)

```bash
export PATH="/c/msys64/mingw64/bin:$PATH"
export TAURI_SIGNING_PRIVATE_KEY="$(cat .secrets/vaultbase-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
npx tauri build --bundles msi,nsis,updater --target x86_64-pc-windows-gnu
```

**`--target x86_64-pc-windows-gnu` обязателен.** Без него tauri-cli (MSVC-бинарь
из npm) считает таргетом свой хост-triple, проверка `windows-gnu` в бандлере не
срабатывает, и NSIS **не кладёт WebView2Loader.dll** рядом с exe — свежая
установка падает молча, 0xC0000135 (DLL not found). MSI кладёт всегда.
Проверено на CLI 2.11.4 (2026-09-03): с флагом DLL в установщике есть,
без флага — нет.

**`updater` в списке бандлов обязателен.** Без него Tauri не создаёт `.sig`, и
встроенное обновление молча не работает — сборка ставится руками, но
авто-апдейт её отвергает. Проверка: рядом с `.msi` должен лежать `.msi.sig`.

Результат в `src-tauri/target/x86_64-pc-windows-gnu/release/bundle/`:
`msi/VaultBase_<ver>_x64_en-US.msi` и `nsis/VaultBase_<ver>_x64-setup.exe`.

---

## 3. Публикация

Два способа, оба идемпотентны (повторный запуск обновляет запись, а не плодит).

### По SSH — когда пароля панели под рукой нет

```bash
VPS_HOST=... VPS_USER=root VPS_PASS=... \
  python scripts/publish-release.py --version 2.5.1 --notes "Прод-сборка 2.5.1"
```

Кладёт файлы в `/opt/cc-sync-server/public/releases` по SFTP и регистрирует их
в БД node-скриптом на самом сервере.

### По HTTP — из CI

```bash
SERVER_URL=... ADMIN_PATH=... ADMIN_USER=admin ADMIN_PASS=... \
  python scripts/upload-artifacts.py --dir artifacts --version 2.5.1 --publish
```

### Про updater на Windows

Tauri v2 подписывает `.msi` **напрямую** — отдельного `.msi.zip` больше нет,
подпись лежит рядом как `.msi.sig`. Поэтому один и тот же файл публикуется
дважды: как `installer-msi` (кнопка «Скачать») и как `updater` (то, что
подтянет авто-обновление). Оба скрипта делают это сами.

---

## 4. Как работает авто-обновление

```
Клиент 2.5.0                      Сервер
   │
   ├─ GET /update?current_version=2.5.0 ──►  routes/update.js
   │                                          берёт последнюю версию,
   │                                          собирает platforms{} из
   │                                          release_files (file_type=updater)
   │  ◄── 200 {version, notes, platforms{...}, signature}
   │
   ├─ скачивает platforms["windows-x86_64"].url
   ├─ проверяет подпись публичным ключом из tauri.conf.json
   └─ ставит обновление
```

Если версия клиента ≥ серверной — **204 No Content**, обновления нет.

Эндпоинт задан в `tauri.conf.json`:

```
https://sec201-www.otpmanager.pro/update?current_version={{current_version}}
```

Версия передаётся **в query**, потому что `routes/update.js` читает
`req.query.current_version`. Шаблон вида `/update/{{target}}/{{arch}}/...`
этот роутер не обслуживает — будет 404.

`update.js` собирает `platforms{}` из **всех** строк `release_files` для версии.
Раньше отдавалась одна платформа из `versions`, из-за чего обновлялась ровно
одна ОС, а остальным Tauri отвечал «нет подходящей платформы».

> ⚠️ Миграция БД v17 (DEVOPS-006): раньше `release_files` имела
> `UNIQUE(version, file_type)` — БЕЗ платформы. Заливка одного релиза под 3 ОС
> перезаписывала одну строку, и в `platforms{}` выживала последняя залитая ОС
> (по факту Linux): Windows/macOS-клиенты обновлений не видели. Сейчас ключ —
> `UNIQUE(version, file_type, platform)`, upsert в `upload.js` — по тройке
> `(version, file_type, platform)`. Требуется деплой сервера
> (`scripts/deploy-server.py`): до него на проде баг жив.

---

## 5. Ключ подписи

```bash
npx tauri signer generate -w .secrets/vaultbase-updater.key -p ""
```

- Приватный ключ — `.secrets/` (в `.gitignore`, **в репозиторий не коммитить**).
- Публичный — в `tauri.conf.json`, поле `updater.pubkey`.

**Потеря приватного ключа = невозможность выпускать обновления** для уже
установленных клиентов: они проверяют подпись публичным ключом, вшитым в их
сборку. Новый ключ примут только те, кто переустановит приложение вручную.
Держите копию в надёжном месте.

---

## 6. Проверка после релиза

```bash
B=https://sec201-www.otpmanager.pro

curl -sI "$B/releases/vaultbase-2.5.1-windows-x86_64-installer-msi.msi" | head -1
# HTTP 200 (или 206 при докачке)

curl -s "$B/api/releases" | head -c 300
# список сборок для страницы загрузки

curl -s "$B/update?current_version=2.5.0" | head -c 200
# {"version":"2.5.1", ... "platforms":{"windows-x86_64":{...,"signature":"..."}}}

curl -s -o /dev/null -w "%{http_code}\n" "$B/update?current_version=2.5.1"
# 204 — свежий клиент обновление не увидит
```

---

## 7. Частые проблемы

| Симптом                                 | Причина                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------ |
| Нет `.sig` рядом со сборкой             | Собирали без `updater` в `--bundles` или без `TAURI_SIGNING_PRIVATE_KEY` |
| `/update` отдаёт 204, хотя версия новее | Релиз не опубликован (`is_published=0`) — нужен `--publish`              |
| `platforms{}` пустой                    | В `release_files` нет строк с `file_type='updater'` для этой версии      |
| Клиент не ставит обновление             | Подпись сделана другим ключом, чем `pubkey` в его сборке                 |
| Скачивание даёт 404                     | nginx блокирует `/releases/` — см. `scripts/deploy-server.py`            |
| 403 «error code 1010»                   | Cloudflare режет запросы без браузерного User-Agent                      |
| Заливка по HTTP даёт 401                | Пароль админки — не пароль SSH, это разные креды из `.env`               |

---

## 8. Файлы

| Файл                                          | Роль                                                        |
| --------------------------------------------- | ----------------------------------------------------------- |
| `.github/workflows/build-release.yml`         | сборка воркера (3 ОС) + публикация                          |
| `.github/workflows/build-manager-release.yml` | сборка менеджера (теги `mgr-v*`, 3 ОС) + публикация         |
| `scripts/release.py`                          | полный цикл локально: версия → сборка → заливка → CHANGELOG |
| `scripts/publish-release.py`                  | публикация по SSH (без пароля панели)                       |
| `scripts/upload-artifacts.py`                 | публикация по HTTP (для CI; `--app manager` для менеджера)  |
| `scripts/deploy-server.py`                    | деплой самого сервера с бэкапом и откатом                   |
| `cc-sync-server/routes/update.js`             | эндпоинт авто-обновления (воркер + `?app=manager`)          |
| `cc-sync-server/routes/upload.js`             | приём артефактов в панель                                   |

---

## 9. Релиз manager-app (MGR-009 + DEVOPS-006)

### CI (основной способ)

Отдельный workflow `.github/workflows/build-manager-release.yml` со **своими
тегами** (версии менеджера независимы от воркерских):

```bash
git tag mgr-v0.2.0 && git push origin mgr-v0.2.0
```

CI собирает те же 3 ОС (Windows x64 / Linux x64 / macOS Apple Silicon) из
каталога `manager-app/`, подписывает **менеджерским** ключом, кладёт файлы в
GitHub Release и заливает updater-артефакты на сервер как
`file_type=manager-updater` (канал stable, rollout 100%). Инсталлеры для
ручной загрузки на сервер не заливаются — менеджер не раздаётся с публичной
страницы воркера. Для `workflow_dispatch` заливка на сервер включается
галочкой `publish_to_panel`.

Требуемый секрет: `TAURI_SIGNING_PRIVATE_KEY_MANAGER` (содержимое
`.secrets/vaultbase-manager-updater.key`, пароль пустой).

Локальный эквивалент: `scripts/release.py --app manager --version 0.2.0`
(бамп версий в `manager-app/`, сборка, заливка; `--channel beta --rollout 25`
для постепенного роллаута).

### Ключ подписи

Отдельный пайплайн и **отдельный ключ подписи** (не воркерский):

| Что            | Значение                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------ |
| Приватный ключ | `.secrets/vaultbase-manager-updater.key` (вне git, `*.key` в .gitignore)                         |
| Публичный ключ | `manager-app/src-tauri/tauri.conf.json` → `plugins.updater.pubkey`                               |
| Перегенерация  | `cd manager-app && npx tauri signer generate -w ..\.secrets\vaultbase-manager-updater.key -p ""` |

Локальная сборка (Windows, PowerShell):

```powershell
$env:PATH = "C:\msys64\mingw64\bin;$env:PATH"   # dlltool/as для свежих crate-ов
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content .secrets\vaultbase-manager-updater.key -Raw)
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
cd manager-app; npx tauri build --bundles nsis,updater --target x86_64-pc-windows-gnu
```

`--target x86_64-pc-windows-gnu` обязателен — иначе NSIS выходит без
WebView2Loader.dll (см. раздел про воркера выше). Артефакты окажутся в
`manager-app/src-tauri/target/x86_64-pc-windows-gnu/release/bundle/`.

Рядом с `*-setup.exe` должен появиться `*-setup.exe.sig` — без него апдейт
не примут клиенты.

Публикация: админ-панель → загрузка с `file_type=manager-updater` (поля
`channel` = stable|beta, `rollout_percent` = 0..100). Staged rollout:
клиент видит релиз, если канал видим (beta-клиенту — оба канала) и
`sha256(installation_id:version) % 100 < rollout_percent`; без `iid` — только
100%-релизы. Канал и процент меняются на лету из manager-app («Апдейты») или
`PATCH /manager/api/releases/:version`. Откат роллаута — выставить 0%.
