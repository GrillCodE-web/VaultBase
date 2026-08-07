# Выпуск версий VaultBase

**Обновлено:** 2026-08-07

Как собрать прод-версию, опубликовать её и как это работает у пользователя.

---

## 1. Быстрый путь: всё через GitHub Actions

Один тег — четыре платформы (Windows, Linux, macOS ARM, macOS Intel) и
автоматическая заливка в панель.

```bash
# 1. Поднять версию в трёх файлах и закоммитить
python scripts/release.py --version 2.5.2 --skip-build --dry-run   # проверка
# 2. Тег
git tag v2.5.2 && git push origin v2.5.2
```

Дальше `.github/workflows/build-release.yml` сам:
собирает 4 таргета → подписывает → создаёт черновик GitHub Release →
job `publish` заливает всё в админ-панель.

### Секреты репозитория (без них не заработает)

| Секрет                               | Что                                         | Обязателен                                       |
| ------------------------------------ | ------------------------------------------- | ------------------------------------------------ |
| `TAURI_SIGNING_PRIVATE_KEY`          | содержимое `.secrets/vaultbase-updater.key` | да — без него нет `.sig` и авто-апдейт не примут |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | пароль ключа (у нас пустой)                 | нет                                              |
| `SERVER_URL`                         | `https://sec201-www.otpmanager.pro`         | для job `publish`                                |
| `ADMIN_PATH`                         | путь админки                                | для job `publish`                                |
| `ADMIN_USER` / `ADMIN_PASS`          | креды панели                                | для job `publish`                                |

Добавить: `Settings → Secrets and variables → Actions → New repository secret`.

Только macOS так и собирается — с Windows `.dmg` не сделать в принципе.

---

## 2. Локальная сборка (Windows)

```bash
export PATH="/c/msys64/mingw64/bin:$PATH"
export TAURI_SIGNING_PRIVATE_KEY="$(cat .secrets/vaultbase-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
npx tauri build --bundles msi,nsis,updater
```

**`updater` в списке бандлов обязателен.** Без него Tauri не создаёт `.sig`, и
встроенное обновление молча не работает — сборка ставится руками, но
авто-апдейт её отвергает. Проверка: рядом с `.msi` должен лежать `.msi.sig`.

Результат в `src-tauri/target/release/bundle/`:
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

| Файл                                  | Роль                                                        |
| ------------------------------------- | ----------------------------------------------------------- |
| `.github/workflows/build-release.yml` | сборка 4 платформ + публикация                              |
| `scripts/release.py`                  | полный цикл локально: версия → сборка → заливка → CHANGELOG |
| `scripts/publish-release.py`          | публикация по SSH (без пароля панели)                       |
| `scripts/upload-artifacts.py`         | публикация по HTTP (для CI)                                 |
| `scripts/deploy-server.py`            | деплой самого сервера с бэкапом и откатом                   |
| `cc-sync-server/routes/update.js`     | эндпоинт авто-обновления                                    |
| `cc-sync-server/routes/upload.js`     | приём артефактов в панель                                   |
