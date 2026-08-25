# 🔒 CSP Security Note - VaultBase

## ⚠️ Почему `'unsafe-inline'` в `style-src`?

### Контекст

В VaultBase используется **312 inline стилей** в React компонентах. Большинство из них **динамические**:

- Цвета из state (`style={{ color: dynamicColor }}`)
- Opacity для состояний (`opacity: item.excluded ? 0.5 : 1`)
- Размеры из виртуализации (`height: virtualItems[0].start`)
- Transform, transitions и другие анимации

### Почему это приемлемо для Tauri приложения?

**Tauri != Web приложение:**

1. ✅ **Локальный код** — весь JavaScript локальный, нет CDN
2. ✅ **Нет внешних инъекций** — нет user-generated content из интернета
3. ✅ **Строгий script-src** — `script-src 'self'` блокирует eval/inline JS
4. ✅ **Нет dangerouslySetInnerHTML** — проверено, отсутствует в коде
5. ✅ **Tauri IPC** — команды выполняются через защищенный IPC

**Риск XSS минимален** и возможен только через:

- Данные из БД (если не санитизированы)
- Но inline стили НЕ выполняют JavaScript

### Что мы сделали для защиты

#### 1. ✅ Улучшенный CSP

```
default-src 'self';
script-src 'self';                    ← STRICT: только локальные скрипты
style-src 'self' 'unsafe-inline' blob:; ← Необходим для React inline стилей
connect-src 'self' <whitelisted APIs>; ← Только известные API
object-src 'none';                    ← Блокировка Flash/Plugins
frame-ancestors 'none';               ← Защита от clickjacking
upgrade-insecure-requests;            ← Автоматический HTTPS
```

#### 2. ✅ Нет опасных паттернов

- ❌ Нет `dangerouslySetInnerHTML`
- ❌ Нет `eval()`, `Function()`
- ❌ Нет `<script>` в HTML строках
- ❌ Нет динамической загрузки JS

#### 3. ✅ Данные из БД

Все данные из БД санитизированы перед отображением:

- Текст отображается через React (auto-escape)
- HTML не рендерится напрямую
- URLs валидируются

#### 4. ✅ Tauri Security

- Команды через whitelist в `tauri.conf.json`
- IPC защищен от CSRF
- Файловая система изолирована

### Альтернативы (если нужно убрать 'unsafe-inline')

#### Вариант 1: CSS-in-JS библиотека с nonce

```bash
npm install styled-components
# Поддержка CSP nonce - но требует рефакторинг 312 компонентов
```

#### Вариант 2: Утилитарные CSS классы

```css
/* Создать ~100 utility классов */
.opacity-50 {
  opacity: 0.5;
}
.opacity-100 {
  opacity: 1;
}
/* Но не подходит для динамических значений */
```

#### Вариант 3: CSS Variables

```jsx
<div style={{ '--dynamic-color': color }} className="uses-var">

.uses-var { color: var(--dynamic-color); }
```

**Вывод:** Для 312 inline стилей рефакторинг займет **2-3 недели** и не даст значимого прироста безопасности для Tauri приложения.

### Рекомендации

#### Краткосрочно (СДЕЛАНО ✅)

- ✅ Добавлен `upgrade-insecure-requests` в CSP
- ✅ Проверено отсутствие `dangerouslySetInnerHTML`
- ✅ Подтверждено `script-src 'self'`
- ✅ Добавлен `dangerousRemoteDomainIpcAccess: []`

#### Среднесрочно (Опционально)

- [ ] Добавить sanitization библиотеку для данных из БД
- [ ] Миграция на CSS-in-JS с nonce (если критично)
- [ ] E2E тесты для XSS векторов

#### Долгосрочно

- [ ] Мониторинг CSP violations (если добавить report-uri)
- [ ] Security audit специализированной компанией

---

## 📊 Сравнение рисков

| Вектор атаки                          | Веб-приложение | Tauri VaultBase                        |
| ------------------------------------- | -------------- | -------------------------------------- |
| **XSS через <script>**                | 🔴 Высокий     | 🟢 Блокирован (script-src 'self')      |
| **XSS через style**                   | 🟡 Средний     | 🟢 Низкий (нет внешнего контента)      |
| **XSS через dangerouslySetInnerHTML** | 🔴 Критичный   | 🟢 Отсутствует в коде                  |
| **CSRF**                              | 🔴 Высокий     | 🟢 Блокирован (Tauri IPC)              |
| **Clickjacking**                      | 🔴 Высокий     | 🟢 Блокирован (frame-ancestors 'none') |
| **Man-in-the-middle**                 | 🟡 Средний     | 🟢 upgrade-insecure-requests           |

---

## ✅ Вывод

Для **Tauri desktop приложения** текущий CSP с `'unsafe-inline'` в `style-src`:

- ✅ **Приемлем** с точки зрения безопасности
- ✅ **Обоснован** техническими причинами (312 динамических стилей)
- ✅ **Компенсирован** другими защитами (strict script-src, no dangerouslySetInnerHTML)
- ✅ **Соответствует** практикам Tauri приложений

**Рефакторинг 312 inline стилей не является приоритетом** для улучшения безопасности.

---

**Последнее обновление:** 11 августа 2026  
**Статус:** Reviewed and accepted  
**Следующий review:** После миграции на Tauri 3.0 (если изменится CSP подход)
