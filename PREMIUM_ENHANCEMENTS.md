# Premium Enhancements — CC Manager

Документация по премиум-компонентам и утилитам для CC Manager.

---

## 🎨 Design System

### Цветовая схема

- **Accent**: `#00d9ff` (cyan) — основной акцентный цвет
- **Purple**: `#a855f7` — вторичный акцент
- **Green**: `#14f195` — успех/позитив
- **Red**: `#ef4444` — ошибки/негатив
- **Background**: `#0d1117` — основной фон

### Типографика

- **Rajdhani** — заголовки (cyber-terminal стиль)
- **Manrope** — основной текст
- **JetBrains Mono** — код, числовые данные

---

## 📦 Компоненты

### 1. SmartToast Notifications

**Файл:** `src/hooks/useSmartToast.jsx`

Интеллектуальная система уведомлений с группировкой.

```javascript
import { useSmartToast } from './hooks/useSmartToast'

function MyComponent() {
  const { success, error, warning, info } = useSmartToast()

  const handleSave = () => {
    success('Data saved successfully', {
      duration: 4000,
      groupKey: 'save-operation',
      action: {
        label: 'Undo',
        onClick: () => {
          /* undo logic */
        },
      },
    })
  }
}
```

**Функции:**

- **Группировка**: Одинаковые сообщения в течение 2с группируются
- **Max 5 уведомлений**: Старые автоматически удаляются
- **Progress bar**: Визуальный таймер авто-закрытия
- **Hover pause**: Наведение приостанавливает таймер
- **Action buttons**: Кнопки действий в уведомлениях

**Длительность по умолчанию:**

- `success`: 4000ms
- `error`: 6000ms
- `warning`: 5000ms
- `info`: 4000ms

---

### 2. usePremiumToast Hook

**Файл:** `src/hooks/usePremiumToast.js`

Готовые шаблоны уведомлений для типовых операций.

```javascript
import { usePremiumToast } from './hooks/usePremiumToast'

function CardsPage() {
  const { successCreate, successDelete, errorLoad, warningUndo } = usePremiumToast()

  const handleDelete = ids => {
    successDelete('Card', ids.length)
  }

  const handleImport = data => {
    successImport('Card', data.length)
  }
}
```

**Доступные методы:**

| Метод                               | Описание                 | Пример                                            |
| ----------------------------------- | ------------------------ | ------------------------------------------------- |
| `successCreate(entity, count)`      | Успешное создание        | `successCreate('Card', 5)`                        |
| `successUpdate(entity)`             | Успешное обновление      | `successUpdate('Profile')`                        |
| `successDelete(entity, count)`      | Успешное удаление        | `successDelete('Order', 3)`                       |
| `successImport(entity, count)`      | Успешный импорт          | `successImport('Card', 150)`                      |
| `successExport(entity)`             | Успешный экспорт         | `successExport('Dashboard')`                      |
| `errorLoad(entity)`                 | Ошибка загрузки          | `errorLoad('Profiles')`                           |
| `errorSave(entity, message)`        | Ошибка сохранения        | `errorSave('Card', 'Invalid CVV')`                |
| `errorDelete(entity)`               | Ошибка удаления          | `errorDelete('Shop')`                             |
| `warningValidation(message)`        | Предупреждение валидации | `warningValidation('CVV required')`               |
| `warningConflict(message)`          | Конфликт данных          | `warningConflict('Duplicate BIN')`                |
| `infoSync(message)`                 | Синхронизация            | `infoSync('Connected to server')`                 |
| `infoBulkAction(action, count)`     | Массовое действие        | `infoBulkAction('Updating', 10)`                  |
| `successWithAction(msg, label, cb)` | С кнопкой действия       | `successWithAction('Exported', 'Open', openFile)` |
| `warningUndo(message, undoCb)`      | С кнопкой Undo           | `warningUndo('Deleted', undoDelete)`              |

---

### 3. PremiumPageHeader

**Файл:** `src/components/PremiumPageHeader.jsx`

Универсальный заголовок страницы с премиум-стилем.

```javascript
import { PremiumPageHeader, PremiumPageHeaderWithFilters } from './components/PremiumPageHeader'

function CardsPage() {
  return (
    <PremiumPageHeader
      title="Cards"
      totalCount={total}
      onRefresh={handleRefresh}
      loading={loading}
      actions={[
        {
          label: 'Import',
          icon: Upload,
          onClick: handleImport,
        },
        {
          label: 'Export',
          icon: Download,
          onClick: handleExport,
        },
      ]}
    />
  )
}

// С фильтрами
function OrdersPage() {
  return (
    <PremiumPageHeaderWithFilters
      title="Orders"
      totalCount={total}
      onRefresh={handleRefresh}
      primaryAction={{
        label: 'Create Order',
        icon: Plus,
        onClick: handleCreate,
      }}
    >
      <OrderFilters />
    </PremiumPageHeaderWithFilters>
  )
}
```

**Пропсы:**

| Пропс           | Тип      | Описание               |
| --------------- | -------- | ---------------------- |
| `title`         | string   | Заголовок страницы     |
| `subtitle`      | string   | Подзаголовок           |
| `totalCount`    | number   | Количество элементов   |
| `actions`       | Array    | Массив кнопок действий |
| `onRefresh`     | Function | Callback обновления    |
| `loading`       | boolean  | Состояние загрузки     |
| `primaryAction` | Object   | Основная кнопка (CTA)  |

---

### 4. Premium Enhancements CSS

**Файл:** `src/styles/pages/premium-enhancements.css`

Библиотека премиум-стилей и анимаций.

#### Анимации

```css
/* Анимированный фон-сетка */
.animated-grid-bg

/* Пульсирующая граница */
.glow-border

/* Shimmer-эффект загрузки */
.shimmer-loading

/* Плавающая анимация */
.float

/* Fade-in с задержкой */
.fade-in-stagger

/* Slide-up */
.slide-up

/* Scale-in */
.scale-in
```

#### Компоненты

```css
/* Floating label input */
.floating-input

/* Segmented control */
.segmented-control

/* Premium data table */
.premium-data-table

/* Tooltip с arrow */
.tooltip-premium

/* Badge variants */
.badge-premium.accent
.badge-premium.purple
.badge-premium.green
.badge-premium.red
.badge-premium.yellow

/* Icon button с ripple */
.icon-button-ripple

/* Loading spinner */
.loading-spinner (sm, default, lg)

/* Dropdown menu */
.premium-dropdown

/* Glass card */
.glass-card

/* Skeleton loading */
.skeleton-animated

/* Empty state */
.empty-state-animated

/* Quick action button */
.quick-action-btn

/* Tab button */
.tab-button-premium

/* Search input */
.search-input-premium
```

#### Page Header

```css
.premium-page-header
.premium-page-header__content
.premium-page-header__title-group
.premium-page-header__title
.premium-page-header__count
.premium-page-header__subtitle
.premium-page-header__actions
.premium-icon-button
.premium-action-button
.premium-action-button.primary
.premium-page-header--with-filters
.premium-page-header__filters
.premium-filter-bar
.premium-filter-chip
.premium-filter-chip.active
.premium-search-input
```

---

## 🎯 Использование

### 1. Подключение стилей

В `src/styles/index-redesign.css`:

```css
@import './pages/premium-enhancements.css';
```

### 2. Provider в App.jsx

```javascript
import { SmartToastProvider } from './hooks/useSmartToast'

function App() {
  return <SmartToastProvider>{/* остальное приложение */}</SmartToastProvider>
}
```

### 3. Backwards Compatibility

Старый код с `useToast` продолжит работать:

```javascript
// Старый код (работает через wrapper)
import { useToast } from './hooks/useToast'
const { toast, success, error } = useToast()

// Новый код (рекомендуется)
import { useSmartToast } from './hooks/useSmartToast'
const { success, error, warning, info } = useSmartToast()

// Или с готовыми шаблонами
import { usePremiumToast } from './hooks/usePremiumToast'
const { successCreate, successDelete, errorLoad } = usePremiumToast()
```

---

## 📊 Dashboard Redesign

**Файл:** `src/pages/DashboardRedesigned.jsx`

Премиум-дашборд с умными уведомлениями:

- **PremiumStatCard**: 8 вариантов карточек с градиентами
- **SmartAlertCard**: Контекстные предупреждения
- **Revenue trends**: Автоматический расчет трендов
- **Smart notifications**: Авто-уведомления при изменениях >$100

---

## 🚀 Примеры

### Уведомление о создании карты

```javascript
import { usePremiumToast } from './hooks/usePremiumToast'

function ImportModal() {
  const { successImport, errorSave } = usePremiumToast()

  const handleImport = async data => {
    try {
      await invoke('import_cards', { data })
      successImport('Card', data.length)
    } catch (e) {
      errorSave('Card', e.message)
    }
  }
}
```

### Уведомление с Undo

```javascript
import { useSmartToast } from './hooks/useSmartToast'

function CardsTable() {
  const { warningUndo } = useSmartToast()
  const deletedCardsRef = useRef([])

  const handleDelete = ids => {
    // Сохраняем для undo
    deletedCardsRef.current = cards.filter(c => ids.includes(c.id))

    // Удаляем
    bulkDelete(ids)

    // Показываем уведомление с Undo
    warningUndo(`${ids.length} card(s) deleted`, () => {
      // Undo логика
      restoreCards(deletedCardsRef.current)
    })
  }
}
```

### Premium Page Header

```javascript
import { PremiumPageHeaderWithFilters } from './components/PremiumPageHeader'
import { Plus, Upload, Download } from 'lucide-react'

function ProfilesPage() {
  return (
    <PremiumPageHeaderWithFilters
      title="Profiles"
      totalCount={total}
      onRefresh={fetchProfiles}
      loading={loading}
      primaryAction={{
        label: 'Create Profile',
        icon: Plus,
        onClick: handleCreate,
      }}
    >
      <ProfileFilters />
    </PremiumPageHeaderWithFilters>
  )
}
```

---

## 🔧 Конфигурация

### Изменение длительности уведомлений

В `src/hooks/useSmartToast.jsx`:

```javascript
const TOAST_CONFIG = {
  success: { defaultDuration: 4000 }, // Изменить здесь
  error: { defaultDuration: 6000 },
  warning: { defaultDuration: 5000 },
  info: { defaultDuration: 4000 },
}

const GROUP_WINDOW_MS = 2000 // Окно группировки
const MAX_TOASTS = 5 // Максимум видимых уведомлений
```

---

## 📝 Changelog

### v2.3.0 — Premium Enhancements Release

**Добавлено:**

- SmartToast notifications с группировкой
- usePremiumToast hook с готовыми шаблонами
- PremiumPageHeader компонент
- DashboardRedesign с премиум-карточками
- 40+ CSS компонентов в premium-enhancements.css
- Анимации: grid-scroll, shimmer, float, scale-in, slide-up

**Изменено:**

- App.jsx использует SmartToastProvider
- Dashboard по умолчанию — DashboardRedesigned
- Backwards compatibility для useToast

---

## 📚 Ресурсы

- [Design Tokens](./src/styles/tokens-redesign.css)
- [Animations](./src/styles/animations-redesign.css)
- [Components](./src/components/)
- [Hooks](./src/hooks/)
