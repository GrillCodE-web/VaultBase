# Варианты Улучшений CC Manager

**Дата:** 22 марта 2026
**Текущая версия:** 2.0.0
**Статус:** Production Ready ✅

---

## 🎯 Быстрые Улучшения (1-2 дня)

### Опция 1: Довести покрытие тестами до 90%+

**Усилия:** 1-2 дня
**Текущее состояние:** 85.47%
**Цель:** 90%+

**Что сделать:**

- Улучшить покрытие хуков:
  - useFocusTrap: 46.66% → 80%+ (добавить тесты для Tab navigation, focus trap)
  - useToast: 75% → 90%+ (добавить тесты для auto-dismiss, multiple toasts)
  - useConfirm: 84% → 95%+ (добавить edge cases)
- Добавить тесты для компонентов:
  - ActionsMenu
  - CardField
  - ExpiryCell
  - NoteCell

**Файлы для создания:**

- `src/hooks/__tests__/useFocusTrap.test.js` (расширить)
- `src/hooks/__tests__/useToast.test.jsx` (расширить)
- `src/components/__tests__/ActionsMenu.test.jsx`
- `src/components/__tests__/CardField.test.jsx`

**Польза:**

- Больше уверенности при рефакторинге
- Меньше регрессий
- Лучшая документация через тесты

**Риски:** Низкие

---

### Опция 2: Почистить ESLint warnings (47 → 0)

**Усилия:** 1 день
**Текущее состояние:** 47 warnings (некритичные)

**Что сделать:**

- Убрать неиспользуемые переменные (15 warnings)
  - `_primaryDrop`, `_copyCard`, `_handleSearch` в Profiles.jsx
  - `_pairCode`, `_syncing`, `_serverOnline` в Settings.jsx
  - `shopCache`, `handleBlock` в Proxies.jsx
- Исправить react-hooks/exhaustive-deps (10 warnings)
  - Добавить недостающие зависимости или eslint-disable с комментариями
- Исправить react-refresh warnings (8 warnings)
  - Переместить экспорты констант в отдельные файлы
- Убрать unused imports (5 warnings)
  - React в OrderRow.jsx, OrderFilters.jsx, BatchImportModal.jsx

**Польза:**

- Чистый код без warnings
- Легче заметить новые проблемы
- Профессиональный вид

**Риски:** Низкие

---

### Опция 3: Оптимизировать inline стили → CSS классы

**Усилия:** 1-2 дня
**Текущее состояние:** 524 inline стилей

**Что сделать:**

- Проанализировать 524 inline стиля
- Переместить статические стили в CSS классы
- Оставить только динамические (selected, hover, calculated)
- Создать utility классы для частых паттернов

**Примеры:**

```css
/* Вместо style={{ display: 'flex', gap: 8 }} */
.flex-gap-8 {
  display: flex;
  gap: 8px;
}

/* Вместо style={{ fontSize: 12, color: 'var(--muted)' }} */
.text-sm-muted {
  font-size: 12px;
  color: var(--muted);
}
```

**Польза:**

- Меньше JS в bundle
- Быстрее рендеринг
- Легче поддерживать стили

**Риски:** Низкие

---

## 🔧 Средние Улучшения (3-5 дней)

### Опция 4: Централизованное управление состоянием (Zustand)

**Усилия:** 4-5 дней
**Текущее состояние:** useState в каждом компоненте

**Что сделать:**

- Установить Zustand
- Создать stores для:
  - Cards (cards, filters, pagination, selection)
  - Orders (orders, filters, pagination)
  - Profiles (profiles, filters, pagination)
  - UI (modals, sidepanel, loading states)
- Добавить data caching
- Добавить request deduplication
- Добавить optimistic updates

**Файлы для создания:**

```
src/store/
├── cards.js
├── orders.js
├── profiles.js
├── ui.js
└── index.js
```

**Польза:**

- Нет props drilling
- Кеширование данных (меньше запросов)
- Optimistic updates (лучше UX)
- Легче дебажить (DevTools)
- Меньше ре-рендеров

**Риски:** Средние - требует рефакторинга компонентов

---

### Опция 5: Error Boundaries + Structured Error Handling

**Усилия:** 3-4 дня
**Текущее состояние:** Generic `catch (e) { toast(String(e)) }`

**Что сделать:**

- Создать React Error Boundary
- Создать типы ошибок:
  - NetworkError
  - ValidationError
  - AuthenticationError
  - DatabaseError
  - EncryptionError
- Создать централизованный error handler
- Добавить error recovery UI
- Добавить error logging

**Файлы для создания:**

```
src/components/ErrorBoundary.jsx
src/utils/errorHandler.js
src/utils/apiClient.js (wrapper для invoke)
src/types/errors.js
```

**Польза:**

- Нет белого экрана при ошибках
- Лучшие сообщения для пользователей
- Легче дебажить
- Можно добавить error tracking (Sentry)

**Риски:** Средние - нужно обновить все catch блоки

---

### Опция 6: Улучшить виртуализацию таблиц

**Усилия:** 3-4 дня
**Текущее состояние:** Работает в Cards, Orders, Profiles

**Что сделать:**

- Добавить виртуализацию в Proxies, Shops, Emails
- Оптимизировать динамические высоты строк
- Добавить smooth scrolling
- Добавить scroll restoration
- Оптимизировать selection state

**Польза:**

- Все таблицы быстрые
- Меньше памяти
- Лучше UX

**Риски:** Низкие-Средние

---

## 🏗️ Крупные Улучшения (1-2 недели)

### Опция 7: Полноценная тема (Dark/Light + кастомизация)

**Усилия:** 1 неделя
**Текущее состояние:** Только dark theme

**Что сделать:**

- Создать light theme
- Добавать переключатель тем
- Добавить кастомизацию цветов
- Сохранять настройки в localStorage
- Добавить preview тем

**Файлы для создания:**

```
src/themes/
├── dark.js
├── light.js
├── custom.js
└── index.js
src/components/ThemeCustomizer.jsx
```

**Польза:**

- Пользователи могут выбрать тему
- Кастомизация под бренд
- Лучше accessibility (light theme для некоторых)

**Риски:** Средние - нужно протестировать все компоненты

---

### Опция 8: Интеграционные тесты (E2E)

**Усилия:** 1-2 недели
**Текущее состояние:** Только unit тесты

**Что сделать:**

- Установить Playwright или Cypress
- Написать E2E тесты для:
  - Import cards flow
  - Create order flow
  - Create profile flow
  - Search functionality
  - Filters
- Добавить в CI/CD

**Польза:**

- Уверенность что всё работает вместе
- Catch integration bugs
- Regression testing

**Риски:** Средние - требует времени на setup

---

### Опция 9: Performance Monitoring

**Усилия:** 1 неделя
**Текущее состояние:** Нет мониторинга

**Что сделать:**

- Добавить React Profiler
- Добавить performance metrics
- Добавить bundle size monitoring
- Добавить render time tracking
- Создать performance dashboard

**Польза:**

- Видно где тормозит
- Можно оптимизировать целенаправленно
- Track performance regressions

**Риски:** Низкие

---

## 🎨 UI/UX Улучшения

### Опция 10: Анимации и микроинтеракции

**Усилия:** 2-3 дня

**Что сделать:**

- Добавить loading skeletons везде
- Добавить smooth transitions
- Добавить hover effects
- Добавить success animations
- Добавить page transitions

**Польза:**

- Более живой интерфейс
- Лучше perceived performance
- Современный вид

**Риски:** Низкие

---

### Опция 11: Keyboard shortcuts расширенные

**Усилия:** 2 дня
**Текущее состояние:** Alt+1-9, Cmd+K, f, r, n

**Что сделать:**

- Добавить больше shortcuts:
  - Ctrl+N - New item
  - Ctrl+F - Focus search
  - Ctrl+S - Save
  - Escape - Close modals
  - / - Focus search
  - ? - Show shortcuts
- Добавить shortcuts hint UI
- Добавить customizable shortcuts

**Польза:**

- Быстрее работа
- Power users будут рады

**Риски:** Низкие

---

## 📊 Рекомендации по Приоритетам

### Если важна стабильность:

1. **Опция 5** - Error Boundaries (защита от крашей)
2. **Опция 1** - Тесты до 90% (меньше багов)
3. **Опция 2** - Почистить warnings (чистый код)

### Если важна производительность:

1. **Опция 4** - Zustand (кеширование, меньше запросов)
2. **Опция 6** - Виртуализация везде
3. **Опция 3** - Inline стили → CSS

### Если важен UX:

1. **Опция 10** - Анимации
2. **Опция 11** - Keyboard shortcuts
3. **Опция 7** - Light theme

### Если важна поддерживаемость:

1. **Опция 4** - Zustand (централизация)
2. **Опция 5** - Error handling
3. **Опция 2** - Почистить warnings

---

## 🎯 Моя Рекомендация (Top 3)

### 1️⃣ Опция 4: Zustand State Management

**Почему:** Самое большое улучшение архитектуры. Упростит разработку в будущем.

### 2️⃣ Опция 5: Error Boundaries

**Почему:** Защита от крашей. Критично для production.

### 3️⃣ Опция 1: Тесты до 90%

**Почему:** Уверенность при изменениях. Меньше регрессий.

---

## 📝 Что Выбрать?

**Напиши номер опции (1-11) или несколько через запятую, и я начну работу!**

Примеры:

- `1` - только тесты
- `2,3` - warnings + inline стили
- `4,5` - Zustand + Error Boundaries
- `1,2,3` - все быстрые улучшения

**Или скажи свой приоритет:**

- "стабильность"
- "производительность"
- "UX"
- "поддерживаемость"

И я предложу оптимальную комбинацию!
