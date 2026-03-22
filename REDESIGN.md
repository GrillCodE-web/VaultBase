# CC Manager — Cyber-Financial Terminal Redesign

## 🎨 Design Concept

**"Cyber-Financial Terminal"** — профессиональный интерфейс финансового терминала с киберпанк-эстетикой. Острый, технологичный, запоминающийся.

### Ключевые принципы

1. **Технологичность** — монопространственные шрифты, точные метрики, терминальная эстетика
2. **Контраст** — тёмная база с яркими акцентами (cyan/teal + electric purple)
3. **Глубина** — многослойные фоны, градиенты, тени, свечение
4. **Движение** — плавные анимации, staggered reveals, glow effects
5. **Профессионализм** — чёткая иерархия, читаемость, функциональность

---

## 🎯 Визуальная идентичность

### Цветовая палитра

**Акценты:**
- Primary: `#00d9ff` (Cyan) — основной акцент, интерактивные элементы
- Secondary: `#a855f7` (Electric Purple) — вторичный акцент, highlights
- Bright: `#14f195` (Neon Green) — success states, live indicators

**Статусы:**
- Success: `#10b981` (Emerald)
- Error: `#ef4444` (Red)
- Warning: `#f59e0b` (Amber)
- Info: `#3b82f6` (Blue)

**Нейтральные:**
- Background: `#0d1117` (Deep Dark)
- Surface: `#161b22` (Dark Gray)
- Card: `#1c2128` (Medium Dark)
- Border: `#30363d` (Subtle Gray)

### Типографика

**Заголовки:** Rajdhani (700) — геометричный, технологичный, острый
**Тело:** Manrope (400-700) — современный, читаемый, профессиональный
**Моно:** JetBrains Mono (400-700) — код, данные, метрики

### Эффекты

- **Noise texture** — тонкий шум для глубины (opacity: 0.015)
- **Scanline** — анимированная линия сканирования (opacity: 0.02)
- **Glow effects** — свечение на активных элементах
- **Gradient borders** — cyan-to-green градиенты на акцентах
- **Staggered animations** — последовательное появление элементов

---

## 📁 Структура файлов

```
src/styles/
├── tokens-redesign.css          # Дизайн-система (цвета, spacing, shadows)
├── reset-redesign.css           # CSS reset + базовые стили
├── animations-redesign.css      # Keyframes и анимации
├── index-redesign.css           # Главный файл (импорты)
│
├── layout/
│   ├── sidebar-redesign.css     # Боковая навигация
│   ├── topbar-redesign.css      # Верхняя панель + табы
│   └── content-redesign.css     # Контент-область + утилиты
│
├── components/
│   ├── buttons-redesign.css     # Кнопки (все варианты)
│   ├── forms-redesign.css       # Формы (input, select, checkbox, etc)
│   ├── modal-redesign.css       # Модалки + search overlay + toasts
│   ├── table-redesign.css       # Таблицы + pagination
│   ├── badges-redesign.css      # Бейджи + статусы
│   ├── filters-redesign.css     # Фильтры + chips
│   └── panel-redesign.css       # Панели + side panels
│
└── pages/
    ├── dashboard-redesign.css   # Dashboard (stats, charts, heatmap)
    ├── auth-redesign.css        # Login/Activate страницы
    └── cards-redesign.css       # Cards page специфика
```

---

## 🚀 Интеграция

### Вариант 1: Полная замена (рекомендуется)

Замените импорт в `src/index.css`:

```css
/* Старый импорт */
@import './styles/tokens.css';
@import './styles/reset.css';
/* ... */

/* Новый импорт */
@import './styles/index-redesign.css';
```

### Вариант 2: Постепенная миграция

Добавьте новые стили параллельно:

```css
/* Оригинальные стили */
@import './styles/tokens.css';
/* ... */

/* Новые стили (переопределят старые) */
@import './styles/index-redesign.css';
```

### Вариант 3: A/B тестирование

Используйте data-атрибут для переключения:

```html
<body data-theme="redesign">
```

```css
[data-theme="redesign"] {
  /* Применяются новые стили */
}
```

---

## 🎨 Ключевые компоненты

### Кнопки

```jsx
<button className="btn btn-accent">Primary Action</button>
<button className="btn btn-g">Success</button>
<button className="btn btn-r">Danger</button>
<button className="btn btn-ghost">Secondary</button>
<button className="btn-icon-only btn-b"><Icon /></button>
```

### Бейджи

```jsx
<span className="badge badge-success">Active</span>
<span className="badge badge-warning">Pending</span>
<span className="badge badge-error">Failed</span>
<span className="status-dot active"></span>
```

### Панели

```jsx
<div className="panel">
  <div className="panel-header">
    <h3 className="panel-title">Title</h3>
  </div>
  <div className="panel-body">Content</div>
</div>
```

### Модалки

```jsx
<div className="modal-overlay">
  <div className="modal">
    <div className="modal-title">
      <span>Modal Title</span>
      <button className="modal-close">×</button>
    </div>
    <div className="modal-body">Content</div>
    <div className="modal-footer">
      <button className="btn btn-ghost">Cancel</button>
      <button className="btn btn-accent">Confirm</button>
    </div>
  </div>
</div>
```

---

## ✨ Анимации

### Staggered Reveal

Добавьте класс `.stagger-item` к элементам списка:

```jsx
{items.map((item, i) => (
  <div key={i} className="stagger-item">
    {item}
  </div>
))}
```

### Glow Effect

```jsx
<div className="glow-pulse">Live indicator</div>
```

### Flash Animation (WebSocket updates)

```jsx
<tr className="row-flash">...</tr>
```

---

## 🎯 Особенности дизайна

### 1. Градиентные акценты

Все основные элементы используют `--gradient-accent`:
- Логотип
- Активные табы
- Primary кнопки
- Разделители

### 2. Многослойность

Каждая карточка/панель имеет:
- Базовый фон (`--card`)
- Тонкий градиент сверху (::before)
- Border с hover эффектом
- Тень при наведении

### 3. Типографическая иерархия

- **Заголовки:** Rajdhani 700, uppercase, letter-spacing
- **Метрики:** JetBrains Mono, monospace
- **Текст:** Manrope, readable, professional

### 4. Интерактивность

Все интерактивные элементы имеют:
- Hover state (transform, glow)
- Active state (scale, brightness)
- Focus state (outline, shadow)
- Disabled state (opacity)

---

## 🔧 Кастомизация

### Изменение акцентного цвета

В `tokens-redesign.css`:

```css
:root {
  --accent: #00d9ff;        /* Ваш цвет */
  --accent-bright: #14f195; /* Светлый вариант */
  --accent-dim: rgba(0, 217, 255, 0.08); /* Прозрачный */
}
```

### Отключение эффектов

```css
:root {
  --noise-opacity: 0;      /* Убрать шум */
  --scanline-opacity: 0;   /* Убрать scanline */
}
```

### Изменение шрифтов

```css
:root {
  --font-heading: 'Your Font', sans-serif;
  --font-body: 'Your Font', sans-serif;
  --font-mono: 'Your Mono', monospace;
}
```

---

## 📊 Производительность

### Оптимизации

1. **CSS Variables** — быстрое переключение тем
2. **Hardware acceleration** — transform вместо position
3. **Will-change** — для анимированных элементов
4. **Debounced animations** — не более 60fps

### Размер файлов

- Tokens: ~3KB
- Animations: ~4KB
- Components: ~25KB
- Pages: ~15KB
- **Total: ~50KB** (gzipped: ~12KB)

---

## 🎨 Примеры использования

### Dashboard Stats

```jsx
<div className="cards-grid">
  <div className="sc cg">
    <div className="sc-lbl">Total Revenue</div>
    <div className="sc-val">$24.5k</div>
    <div className="sc-sub up">+12.5%</div>
  </div>
</div>
```

### Card Row

```jsx
<tr className="card-row">
  <td>
    <div className="card-number">
      <span className="card-number-masked">****</span>
      <span className="card-number-last4">4242</span>
    </div>
  </td>
  <td>
    <span className="card-health fresh">
      <span className="card-health-dot"></span>
      Fresh
    </span>
  </td>
</tr>
```

### Filter Bar

```jsx
<div className="filters-bar">
  <div className="filter-group">
    <span className="filter-label">Status</span>
    <select className="filter-select">
      <option>All</option>
      <option>Active</option>
    </select>
  </div>
  <div className="filter-chips">
    <button className="filter-chip active">Fresh</button>
    <button className="filter-chip">Used</button>
  </div>
</div>
```

---

## 🐛 Troubleshooting

### Стили не применяются

1. Проверьте порядок импортов (redesign должен быть последним)
2. Очистите кеш браузера
3. Проверьте, что Tailwind не переопределяет стили

### Анимации тормозят

1. Уменьшите `--noise-opacity` до 0
2. Отключите `scanline-overlay`
3. Используйте `will-change` для часто анимируемых элементов

### Шрифты не загружаются

Проверьте подключение Google Fonts в `index-redesign.css`:

```css
@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
```

---

## 📝 Changelog

### v1.0.0 (2026-03-22)

- ✨ Полный редизайн в стиле Cyber-Financial Terminal
- 🎨 Новая цветовая схема (Cyan + Purple)
- 🔤 Новая типографика (Rajdhani + Manrope + JetBrains Mono)
- ✨ Анимации и эффекты (glow, stagger, scanline)
- 📦 Модульная структура CSS
- 🎯 17 новых CSS файлов
- 🚀 Оптимизация производительности

---

## 🤝 Contributing

При добавлении новых компонентов:

1. Следуйте naming convention (BEM-like)
2. Используйте CSS variables из `tokens-redesign.css`
3. Добавляйте hover/focus/active states
4. Тестируйте на разных разрешениях
5. Документируйте в этом файле

---

## 📄 License

Этот редизайн является частью CC Manager проекта.

---

**Создано с ❤️ для профессионалов финансовой индустрии**
