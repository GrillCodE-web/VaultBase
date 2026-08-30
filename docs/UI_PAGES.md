# VaultBase — Вёрстка экранов: каждая страница, модалка, окно

> Второй том дизайн-документации. [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) описывает
> **систему** (токены, слои, правила); этот документ — **конкретную вёрстку**:
> из каких блоков собран каждый экран, какие кнопки/бейджи/цвета/шрифты/размеры
> где стоят, и где факт расходится с системой.
>
> Актуально на 2026-08-29. Все ссылки — `файл:строка`.

---

## 1. Шелл приложения (`src/App.jsx`, 1758 строк)

### 1.1 Дерево каркаса

```
#root
└─ .app-container
   ├─ <nav class="sidebar[.expanded]">            App.jsx:1226
   │   ├─ .sidebar-drag-region (data-tauri-drag-region)   ← перетаскивание окна macOS
   │   ├─ .sidebar-logo  «VB» + .sidebar-logo-text «VaultBase» (только expanded)
   │   ├─ кнопки .sbi[.active] × 12 (NAV_DEFS, App.jsx:1043–1110)
   │   │    <Icon size={16}/> + .sbi-tip (тултип) + .sbi-label (текст) + .sbi-badge?
   │   ├─ .sidebar-divider после ключей updates / orders / imap   (App.jsx:1253)
   │   ├─ .sidebar-spacer
   │   ├─ .sbi «Поиск» (⌘K → setSearchOpen)      App.jsx:1325
   │   ├─ .sbi «Настройки»
   │   └─ (ниже — переключатель темы, user-блок)
   └─ .main-content-wrapper                        App.jsx:1484
       ├─ <NewsAlert/>                             (MGR-006, новости менеджера)
       ├─ .session-warning-banner? (role=alert, «сессия истекает через Nс»)
       ├─ .topbar?  (только если у страницы есть TOPBAR_TABS)
       │    └─ .tab[.active] + .tab-badge[.y]
       └─ <main class="main-content-scroll[.main-content-fill]">   App.jsx:1530
            └─ ErrorBoundary(resetKey=page) → Suspense(fallback=.spinner-xs)
                 └─ .page-enter → <PageComponent/>
```

### 1.2 Сайдбар — детали

- **Пункт меню `.sbi`**: иконка lucide **16px** (НЕ 18 — 18px это CSS-правило
  `.sbi svg` в `layout.css:120`, которое перебивается инлайн-пропом `size={16}`;
  фактический рендер 16px), текст дважды: `.sbi-tip` (всплывающая подсказка в
  свёрнутом режиме) и `.sbi-label` (в развёрнутом). При редизайне править оба.
- **Бейджи**: `.sbi-badge` — число (`>99 → '99+'`), цветовые модификаторы через
  `badgeColor` (`g` — зелёный и др.). Точка «доступно обновление» — тот же
  `.sbi-badge g`, ужатый инлайном до 8×8 круга (`App.jsx:1308`).
- **DnD-порядок**: пункты перетаскиваются (`draggable`), порядок в localStorage
  `cc_nav_order`; разделители жёстко после `updates`, `orders`, `imap`.
- Навигация фильтруется по пермишенам (`hasPerm`), прокси/курьёры условны.

### 1.3 Топбар-табы

Рендерятся только для страниц из `TOPBAR_TABS`. `.tab` — 22px высотой,
13px/500, активный = `--card` + `--shadow-xs` (`layout.css:359–397`).
`.tab-badge` — красная капсула 15px, 10px/600, tabular-nums; вариант `.y`
(жёлтый) используется на страницах **cards** и **profiles** (`App.jsx:1513` —
`isYellow = page === 'cards' || page === 'profiles'`).
Бейджи табов: orders→pending_orders, cards→expiring_cards, profiles→no_drop_profiles.

### 1.4 Контент-зона

- `.main-content-scroll` — скролл + padding 24/28 (см. DESIGN_SYSTEM §7.2);
  **IMAP** получает `.main-content-fill` (без паддингов, свой скролл).
- `.page-enter` remount при смене страницы (`key={page}`) — анимация `page-in`.
- Suspense-fallback — `.spinner-xs` по центру; страницы ленивые (lazy import).

---

## 2. Анатомия «стандартной страницы списка»

Карты, Профили, Заказы, Магазины, Прокси, Каталог, Журнал построены по одному
шаблону:

```
.content                                     layout.css:622
├─ .ph                                       layout.css:546
│   ├─ .ph-title  (22px/600, letter-spacing -0.01em,
│   │             ::before = cyan-тик 3×18px слева)   layout.css:555,569
│   ├─ .ph-sub?   (12px, --muted)              layout.css:582
│   └─ .ph-actions (flex gap 12px, wrap)      layout.css:492
│        └─ главная кнопка .btn .btn-g|btn-b + утилитарные .btn .btn-ghost .btn-sm
├─ .filters?  (карточка: --card, --r-lg, padding 12/16,
│              ::before = акцент-полоса 1px opacity .15)   components.css:2984
│    ├─ .flt[.active] — чипы-фильтры          pages.css:2816/2836
│    └─ .search-box                           components.css:3223
├─ .bulk-action-panel? (при выборе строк)     components.css:1301
├─ .panel.p-0 → <table class="tbl">           §3
├─ <Pagination/>                              §7.4
└─ модалки (§5)
```

### Отступления от шаблона (факт)

- **IMAP** — вообще свой layout (§6.8).
- **Couriers** — своя `.pkg-table` на div-гриде и `.couriers-grid` карточек.
- **Dashboard** — нет `.filters`, есть `.period-bar` + сетка виджетов.
- **Bulk-панели не унифицированы**: Orders — `.bulk-action-panel`
  (`components.css:1301`, синий инфо-фон, **rgba бордер захардкожен**),
  Profiles — инлайн-Tailwind `bg-accent/10 rounded-md`, Shops —
  `bg-card-hi border-hi rounded-md`. Три разных вида одного и того же паттерна.

---

## 3. Таблицы (`.tbl`)

Система описана в DESIGN_SYSTEM §8.3; фактические детали вёрстки:

- Обёртка всегда `.panel.p-0` (панель без паддинга), у Orders —
  `.table-scroll-container` с **фиксированной высотой 760px**
  (`components.css:1318`) + виртуальный скролл (ARCH-008).
- Шапка `thead.sticky top-0 z-[3] bg-card` — 26px, **Geist Mono 10px uppercase**,
  разрядка 0.06em; липкая (`--z-sticky`).
- Ячейки-данные: преобладают **`text-[11px]` (136 использований в JSX)** и
  `text-[12px]` (117) — см. §9 про обход токен-шкалы.
- Зебра: `tbody tr:nth-child(even)` = `--card-hi`; строка 28px.
- Выделение: чекбокс `.cb` (`accent-color: var(--accent)`) в первой колонке.
- Ресайз колонок: `.col-grip` (виден при наведении), перетаскивание меняет
  инлайн-ширины; набор колонок Cards настраивается `ColumnPicker`.
- Пустое состояние в таблице: `<EmptyState colSpan={N}/>` (строка-заглушка);
  загрузка: `<SkeletonRows count cols/>`.

---

## 4. Статус-бейджи: система `.st` и JS-карты

### 4.1 `.st` — доминантный бейдж списков (`pages.css:1928`)

```
.st = inline-flex, padding 4px 10px, radius --r-sm, 11px/700,
      Geist Mono, UPPERCASE, letter-spacing 0.05em, border 1px
```

Формула цвета каждого варианта: **фон = rgba(цвет, 0.12), бордер = rgba(цвет, 0.25),
текст = `var(--{color}-t)`**. Важно: rgba-литералы **захардкожены** в pages.css
(не из токенов) — при редизайне статусной палитры править дважды (см. §10).

| Класс                                                        | Цвет-литерал      | Текст        | Где                   |
| ------------------------------------------------------------ | ----------------- | ------------ | --------------------- |
| `.st-pending`                                                | `#eab308` жёлтый  | `--yellow-t` | заказы, курьёры       |
| `.st-active` / `.st-processing`                              | `#3b82f6` синий   | `--blue-t`   | заказы                |
| `.st-shipped`                                                | `#0ea5e9`         | `--teal-t`   | заказы                |
| `.st-delivered` / `.st-clean` / `.st-free`                   | `#22c55e` зелёный | `--green-t`  | заказы, прокси, карты |
| `.st-decline` / `.st-cancelled` / `.st-blocked` / `.st-dead` | `#ef4444` красный | `--red-t`    | заказы, прокси, карты |
| `.st-used`                                                   | `#a855f7` фиолет  | `--purple-t` | прокси, курьёры       |
| `.st-inuse`                                                  | `#f59e11` янтарь  | `--yellow-t` | карты                 |
| `.st-archive`                                                | `#6b7280` серый   | `--text-2`   | всё                   |
| `.st-transit`                                                | `#3b82f6` синий   | `--blue-t`   | треки                 |

Маппинг статус→класс для заказов: `ORDER_STATUS_CSS` в
`src/constants/status.js` (именно её используют OrderRow и float.jsx).

### 4.2 JS-карты цветов (`src/constants/status.js`)

`CARD_STATUS_COLORS` / `ORDER_STATUS_COLORS` — объекты `{ bg, text, label }`,
где `text` = токен (`var(--yellow-t)`), а **`bg` — rgba-литерал в JS**
(`rgba(234, 179, 8, 0.1)`). Т.е. статусные фоны живут в ТРЁХ местах:
`pages.css` (.st-_), `tokens.css` (--color-card-_, частично), `status.js`.
При редизайне статусов — синхронизировать все три.

### 4.3 Прочие бейджи

- `.badge-status` с **формой-индикатором** (круг/квадрат/ромб) — карты
  (DESIGN_SYSTEM §8.5); `.badge-network` — платёжные сети.
- `.badge-mini` (`components.css:1237`) — микробейдж «primary» в селекторах.
- `EntityBadge` (встроен в ActivityLog) — категории журнала.
- `NeedsAttentionBadge` (`Orders/OrderRow.jsx:47`) — «требует внимания».
- `ImapActionBadge`, `.unread-badge` (`pages.css:2690`) — почта.
- Риски: `.risk-badge` + `risk-safe/warning/high` (float.jsx:64 — **с эмодзи**
  🟢🟡🔴 внутри), `.risk-icon-high-risk` и пр. в `Orders/RiskBlock.jsx`.

---

## 5. Модалки: ДВЕ системы (ключевая находка)

### 5.1 Система A — компонент `<Modal>` (`src/components/Modal.jsx`)

Полный фарш: **портал в `document.body`** (защита от transform/overflow предков),
**focus-trap** (`useFocusTrap`), закрытие по **Escape** и клику на оверлей,
возврат фокуса, `role="dialog" aria-modal`, размеры через проп
`size: sm/md/lg/xl` → инлайн `style={{ '--modal-size': var(--modal-*) }}`
(420/560/720/900). Хром: `.modal-header` + `.modal-header__title` +
`.modal-close` (X 18px) + `.modal-body` + `.modal-footer`.

**Используется всего в 4 местах:** Couriers ×3 (`size md/md/lg`),
Settings ×1 (отчёт stuffer-теста, md).

### 5.2 Система B — ручные модалки (14 файлов)

Паттерн `<div class="modal-overlay"> → <div class="modal w-modal-{md|lg}">`
с **самодельной шапкой** (обычно `flex items-center justify-between px-6 py-4
border-b` + `.modal-close`). Ширины — утилиты `w-modal-sm/md/lg`
(`components.css:695/799/698`). Файлы:

| Файл                                                                                                            | Размер                      | Особенности хрома                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Orders/CreateOrderModal.jsx:397`                                                                               | `w-modal-lg`                | overlay `items-start overflow-y-auto py-6` (скроллит оверлей, не body), **sticky-шапка** (`sticky top-0 bg-card z-10`), тело `p-6 flex flex-col gap-5` |
| `Orders/BatchImportModal.jsx`, `RepeatOrderModal.jsx`, `ShippedModal.jsx`                                       | —                           | тот же ручной паттерн                                                                                                                                  |
| `Profiles/ProfileModal.jsx` (458 стр.)                                                                          | —                           | форма профиля                                                                                                                                          |
| `Profiles/QuickOrderModal.jsx`, `DuplicateProfilesModal.jsx`, `ImportDropsModal.jsx`, `DuplicateDropsModal.jsx` | —                           |                                                                                                                                                        |
| `Cards/ImportModal.jsx` (409 стр.)                                                                              | —                           | внутри `.tbl`-превью                                                                                                                                   |
| `Imap.jsx:99` (аккаунт) / `:267` (compose)                                                                      | `w-modal-md` / `w-modal-lg` | overlay закрывает по клику (`onClick={onClose}`)                                                                                                       |
| `ImapDomainRoutes.jsx`                                                                                          | —                           |                                                                                                                                                        |
| `Proxies.jsx` ×3, `Proxies/upanel.jsx` ×2                                                                       | —                           | add/stats/import и пр.                                                                                                                                 |
| `Shops.jsx:173,351` ×2                                                                                          | —                           | new/edit магазина                                                                                                                                      |

**Последствия для редизайна:** правка `.modal`/`.modal-overlay` заденет обе
системы (хорошо), но поведение (Esc/фокус/портал) есть только у системы A —
переделывая хром модалок, нужно либо мигрировать B→A, либо править 14 шапок
вручную. Третий «почти-модальный» компонент — `ShortcutsHelp`
(`shortcuts-overlay/shortcuts-modal`, свой хром с `shortcuts-icon-box`).

### 5.3 CreateOrderModal (879 строк) — крупнейшая модалка, 8 шагов

1. **Profile** — селектор; 2. **Shop**; 3. **Drop** — кастомные радио
   `.radio-label` + `.radio-circle` + `.radio-dot` (`components.css:1362`),
   выбранный = `.selected`, `badge-mini` «primary»;
2. **Email** — `.mode-toggle-btn` Pool/Custom (`components.css:1212`), пул —
   `.inline-select` с маркерами `✔/⚠️/⛔` (blocked/used), custom — `.form-input`;
3. **Proxy** — `.inline-select` с теми же маркерами + `.info-hint-box`
   («🎯 geo-match», `components.css:1218`);
4. **Risk Check** — `<RiskBlock/>`;
5. **Order Number** — `.form-input.mono`;
6. **Items** — строки позиций.
   Иконки-эмодзи в option'ах (`⛔⚠️✔🔴🎯`) — наследие до lucide-миграции,
   кандидаты на замену (это текст в `<option>`, lucide туда не вставить —
   только переработкой селекта).

---

## 6. Страницы — поэкранно

Формат: **header** (кнопки `.ph-actions`) → **фильтры** → **контент** →
**модалки** → шрифты/цвета/иконки. «Главная кнопка» = единственная яркая
(`.btn-g`/`.btn-b`/`.btn-primary`), остальное — `.btn-ghost btn-sm`.

### 6.1 Dashboard (`DashboardRedesigned.jsx` + `Dashboard/*`)

- **Header**: `.ph-title` с `.live-dot` (зелёная точка 8px, glow
  `0 0 8px rgba(34,197,94,.6)` — **hex-литерал**, layout.css:612) + sr-only
  «auto-refresh every 30 seconds»; `.ph-sub` = подпись автообновления.
  **Кнопки**: `+ Импорт карт` (.btn-b), `+ Профиль` (.btn-g), `+ Заказ` (.btn-b),
  Refresh/Download/FileDown/RotateCcw (ghost-sm, иконки 13px).
- **Инлайн `<style>` для печати** прямо в JSX (`DashboardRedesigned.jsx:236`) —
  исключение из правила «стили только в styles/», прячет sidebar/filters,
  `break-inside: avoid` панелям.
- **Period-bar**: `.period-bar` (inset-подложка, `pages.css:228`) + `.pb` чипы
  (6×14px, 12px/600; active = `--accent-dim`+`--accent-border`+`--accent-text`,
  `pages.css:194–226`) + date-инпуты `.inline-select-sm` при custom.
- **Сетка виджетов**: `WidgetGrid.jsx` (react-grid-layout, ROW_HEIGHT 30,
  MARGIN 12, персист `vb_ui_dashboard_layout_v1`); карточки —
  `Dashboard/cards.jsx` (`.dash-*`, 620 стр.), алерты — `AlertsPanel.jsx`,
  графики — `charts.jsx` (**recharts** + `.heatmap-table`, pages.css:297).
- **Loading**: `SkeletonRows count=8 cols=6` внутри `.panel>.tbl`.
- **Empty**: `.panel` + `.empty-state-icon-box` (Download 20px).

### 6.2 Карты (`Cards.jsx` + `Cards/*`)

- **Header**: `CC <total> (muted 14px) · <free> free (green-t 12px)`;
  кнопки: вид Compact/Extended (toggle btn-b), «Group by bank» (toggle),
  «Carder View» (жёсткий набор из 12 колонок — прописан массивом в JSX:644),
  «Columns» → `ColumnPicker` (дропдаун с backdrop `fixed inset-0 z-10`),
  «Archive dead» (Archive 12px).
- **Таблица** `CardTable.jsx` (`.tbl`), строки `CardRow.jsx` (606 стр.):
  номер `.mono text-[12px]` (маскированный), CVV/ZIP/phone —
  `.cell-text-sm-mono` + `cursor-copy` (клик = копировать), даты
  `text-[11px] mono muted`, срок — **`.expiry-cell`** с состояниями
  `expired` (muted + line-through) / `critical` (red) / `soon` (warning) /
  `normal` (`components.css:3032`), сеть — `.badge-network`, статус —
  `.badge-status` с формой.
- **Режимы**: compact (узкие строки), groupByBank (секции по банкам),
  carder view (12 колонок «под работу»).
- **Модалки**: `ImportModal` (409 стр., превью `.tbl`), ColumnPicker.
- Side-panel карточки: `.side-panel` (keyframe `side-panel-in`).

### 6.3 Профили (`Profiles.jsx` + `Profiles/*`)

- **Header**: Export CSV (Download 13px, ghost), `+ New Profile` (**.btn-g**,
  shortcut `p`), «Find duplicates» (ghost).
- **Bulk-панель**: своя, Tailwind-инлайн `bg-accent/10` (рассинхрон §2):
  BIN-enrich (SearchCode 13px, прогресс `Enriching n/m`), Clear (X 13px).
- **Таблица** `ProfilesTable.jsx` (`.tbl`, **dnd строк** `.row-grip`),
  строки `ProfileRow.jsx`; раскрытие строки → `ProfileDetailPanel.jsx`
  (845 стр., side-panel; внутри дропы, заказы, модалки ImportDrops/DuplicateDrops).
- **Модалки**: `ProfileModal` (создание), `DuplicateProfilesModal`,
  `QuickOrderModal`.
- Drops живут здесь (`DropsSection.jsx`), отдельная страница Drops — заглушка
  (§6.15).

### 6.4 Заказы (`Orders.jsx` + `Orders/*`)

- **Header**: `+ Create order` (**.btn-g**, shortcut `o`), Batch import
  (Upload 13px), Export (**disabled**, «coming soon»).
- **Фильтры**: `OrderFilters.jsx` (116 стр.).
- **Bulk-панель**: `.bulk-action-panel` — счётчик `.text-info-bold`,
  кнопки →Processing (btn-b sm), →Shipped (ghost), Delete (btn-r sm), Deselect.
- **Таблица** `OrdersTable.jsx`: виртуальный скролл, контейнер **760px**;
  строки `OrderRow.jsx` (352 стр.): holder 12px + `•••last4` mono 10px muted,
  статус `.st ${ORDER_STATUS_CSS[status]}`, сумма **`text-blue-t mono` +
  выравнивание вправо**, трек — `.input input-sm font-mono text-[10px] w-28`
  (инлайн-редактирование), carrier/proxy/email — `text-[11px] text-muted`,
  дата `slice(0,10)` 11px muted; `NeedsAttentionBadge`.
- **Модалки**: CreateOrder (§5.3), RepeatOrder, BatchImport; `StatusMenu.jsx`
  (меню смены статуса + `ShippedModal`).

### 6.5 Каталог (`Catalog.jsx`)

- Тонкий: header (`BookOpen 14px` в title) + два таба через `activeTab`
  (items/shops) → `ItemsTab`/`ShopsTab` с `.tbl`-таблицами (строки 195, 423).
  Данные — статические JSON из `public/catalog_*.json`.

### 6.6 Магазины (`Shops.jsx`, 1387 строк)

- **Header**: `Store 14px` + title + счётчик; Refresh (ghost, **символы ⟳/↺
  вместо иконки** — анахронизм), `+ New shop` (.btn-b).
- **Stat-bar**: внутри `.filters` рядом с `.search-box` (260px) —
  `.stat-bar-item.{info,success,error}` (pages.css:2325): точка 5px
  `.stat-bar-dot` (инлайн-цвет из `STATUS_COLORS`) + значение
  `.stat-bar-value` 12px/500 + подпись 11px muted. Цвета инлайнятся из
  `STATUS_COLORS` + один литерал `var(--blue-t)`.
- **Bulk-панель**: третья по счёту реализация (`bg-card-hi border-hi`).
- **Таблица** `.tbl` (922) + `.grp-name` и пр.; модалки new/edit — ручные
  (система B, строки 173/351).

### 6.7 Прокси (`Proxies.jsx`, 1244 строк + `Proxies/upanel.jsx`, 892)

- **Header**: `Globe 14px` + title + `.ph-sub` счётчик пула; кнопки: Import
  (btn-b, Upload 13), Test all (ghost, RefreshCw с **инлайн**
  `animation: spin 1s linear infinite` при работе — единственный случай
  инлайн-ссылки на keyframe), Check Now (Wifi 13), Usage Stats (BarChart2 13),
  `+ Add proxy` (**.btn-g**).
- **Фильтры**: `.filters` — чипы `.flt` по статусу (Все/Чистые/В использовании/
  Заблокированные со счётчиками) + разделитель `w-px bg-border` + чипы типа
  `.flt mono` (HTTP/SOCKS5/SOCKS4/PPTP — **mono-шрифт на чипах**).
- **Таблицы**: 5 штук `.tbl` (основная + в модалках; skeleton-шапка с
  `sticky top-0 z-[3]`); виртуальный контейнер `.virtual-scroll-container`
  (600px, Proxies).
- **upanel.jsx** — вкладка PPTP (`activeTab === 'pptp'` + пермишен
  `manage_proxies`): свой под-интерфейс (2 таблицы, 2 ручные модалки,
  `.upl-*` классы).
- **Модалки** (система B): add, import (`ImportModal`), stats + upanel ×2.

### 6.8 IMAP (`Imap.jsx`, 805 строк) — единственная «не-шаблонная» страница

- Корень: **`h-full min-h-0 flex flex-col bg-app`** — без `.content`,
  без `.ph` (получает `.main-content-fill`, §1.4).
- **Своя шапка `h-14`** (56px — на 4px выше стандартного `--h-toolbar` 52px!):
  `Mail 18px text-accent` + `h1 text-sm font-semibold` + счётчик аккаунтов
  (`text-xs px-2 py-0.5 bg-border rounded-full` — пилюля); переключатель
  Inbox/Sent — **сегмент-контрол** (`flex border rounded-lg`, активный =
  `bg-accent text-white` — единственное место, где акцент заливает кнопку
  помимо btn-primary); Compose (`.btn-primary btn-sm`, PenSquare 14),
  Check All (`.btn-secondary btn-sm`), Domain routes / Add / Refresh
  (ghost-sm `p-2`, иконки 16).
- **Тело — три панели**: дерево папок (`.folder-tree-item`, pages.css:2656),
  список писем (`email-item`, непрочитанные `.message-subject-unread` 2728 +
  `.unread-badge` 2690), просмотр письма (`message-*`, viewer.html — HTML
  писем рендерится отдельно).
- **Модалки**: аккаунт (`w-modal-md`), compose (`w-modal-lg`), domain routes —
  все система B; overlay закрывается кликом.

### 6.9 Курьёры (`Couriers.jsx`, 687 строк)

- Два режима: **shared** (курьёры по аккаунтам) — `.couriers-grid` карточки
  (pages.css:2431): `.courier-card` с `__head` (имя + `.st`), `__addr`
  (MapPin 13px), `__exp` (аккаунт как `.st st-pending`); **packages** —
  `.pkg-table` (pages.css:2488): **div-грид, не `<table>`** —
  `.pkg-row.pkg-row--head` + строки; ID `#123` mono, цена mono text-xs,
  статус `.st st-*`.
- **Модалки ×3 — единственное место с системой A**: new/edit пакета (md),
  детали (lg). Кнопка создания `.btn-primary btn-sm` (Plus 14) — требует
  пермишен `create_packages`.

### 6.10 Обновления (`Updates.jsx`)

- **Header**: title + muted-суффикс «while you slept»; Refresh (ghost),
  `✓ Apply all` (btn-g sm — **эмодзи ✓ в кнопке**).
- **Баннер обновления приложения**: инлайн-цвета — stable = `--red-t`/
  `--color-error-bg`, beta = `--yellow-t`/`--color-warning-bg`
  (`Updates.jsx:303-306`); эмодзи-маркеры `🧪 Beta` / `🆕 Stable`; прогресс
  скачивания — полоса `h-1` с `backgroundColor: var(--blue-t)` инлайн.
- **Лента**: `.sum-*` (sum-header/chip/dot/body), группы по типам,
  `.upd-item`, иконки типов.

### 6.11 Журнал (`ActivityLog.jsx`)

- Стандартный шаблон: Refresh (ghost-sm `btn-icon`), Clear (**.btn-r sm**).
- Фильтры: `.flt`-чипы по entity + `.search-box`.
- Таблица `.tbl`: время `mono text-[11px] muted` (`toLocaleString` —
  **не fmtDate**, формат зависит от локали ОС), категория — `EntityBadge`,
  событие — `text-blue-t text-[11px] font-mono`, описание 12px с ellipsis
  (max-w 400px).

### 6.12 Настройки (`Settings.jsx`, 1652 строки)

- Header стандартный + `ph-sub` «App configuration».
- **Структура**: `<LicenseSection/>` (свой модуль) + `.grid2` из панелей
  `.panel` с `.ptitle` (12px/700 mono UPPERCASE muted, бордер снизу,
  `components.css:3898`) и строками `.setting-row` (label+desc слева,
  контрол справа — тоглы `.toggle-wrap`, §8.2 DESIGN_SYSTEM: **второй** тогл,
  не `.toggle`).
- Секции: Window (always on top), Dock Badge, OS-уведомления (UX-012), и др.;
  модалка отчёта stuffer-теста — система A (`stest-list/stest-row`,
  статусы `.st st-*`).
- **Внимание**: в файле Settings.jsx на 2026-08-29 присутствует
  **кракозябра в комментарии** (строка ~1124, «FEAT-012: РѕС‚С‡С‘С‚…» —
  двойная кодировка UTF-8→CP1251). Та же история, что была у float.jsx
  (см. коммит e17970a). На рендер не влияет (комментарий), но при редизайне
  зачищения требует. Проверить кодировку всего файла перед правками.

### 6.13 Пользователи и статистика (`UsersPage.jsx`, `MyStats.jsx`)

- UsersPage — таблица пользователей, роли `.role-admin-bg/color` и
  `.role-user-*` токены; `fmtDate` принимает UTC `YYYY-MM-DD HH:MM:SS` и ISO.
- MyStats — `.mstats-*` (pages.css:2915–3064): hero-панель, гриды метрик,
  `.mstats-loading-panel .spinner`.

### 6.14 Экраны входа (`Login.jsx`, `UserLogin.jsx`, `Activate.jsx`)

Секция CSS `pages.css:828–1171`. Каркас: `.auth-screen` (центрирование) +
`.auth-bg-glow` (862, декоративное свечение) + колонка `max-w-[400px]`.

- `.auth-logo-wrap` → `.auth-logo-icon` (911: Lock/CreditCard 24px белые на
  акцентной плашке) → `.auth-title` (963) → `.auth-sub`.
- `.auth-card` (875) — карточка формы; поля `PasswordInput` с `auth-label`;
  ошибки — `.auth-error` (role=alert); бан менеджера (MGR-005) — ShieldAlert.
- **Индикатор силы пароля** (setup): `.auth-strength-bar` из 4
  `.auth-strength-seg` (1106), цвета сегментов — массив токенов в JSX
  (`--red/--yellow/--color-success`).
- UserLogin — вход оператора (после разблокировки), Activate — ввод ключа
  лицензии; оба на том же `.auth-*` каркасе.

### 6.15 Прочие экраны

- **Onboarding**: чек-лист шагов, карточка `max-w-[480px]`, прогресс-бар
  `h-1 bg-accent`, шаги 16/20px паддинги, круглые чек-иконки 36px.
- **Drops** — заглушка `.premium-empty-state` (частицы 12 шт., **анимации
  заглушены** — см. DESIGN_SYSTEM §11), MapPin 48px accent, 3 шага-инструкции.
- **Revoked/expired** — `.revoked-container` (components.css:1997).

---

## 7. Float-окно (`float.jsx`, 678 строк + `float.html`)

Отдельное окно Tauri (второй entrypoint: свой `ReactDOM.createRoot`,
float.jsx:666). `decorations: false` — окно прозрачное, радиус рисует CSS.
Свой `FloatErrorBoundary` (636). **Важно:** комментарий float.jsx:669-671
всё ещё кракозябра (двойная кодировка) — фикс e17970a его не покрыл.

### 7.1 Каркас (components.css:3485-3777 — «FLOAT WINDOW»)

| Класс                  | Строка | Ключевое                                                                                                   |
| ---------------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| `.float-window`        | 3489   | 100vh flex-col, `--r-window`, bg `--card`, `--shadow-window`; `[data-vibrancy='on']` → `--glass-bg` + blur |
| `.float-header`        | 3513   | `--h-titlebar`, bg `--surface`, `data-tauri-drag-region`; имя 13px/600 + `••last4` 11px muted              |
| `.float-close-btn`     | 3698   | **круг 14×14 `--red`** (macOS-стиль), «×» 9px, hover `--red-t`                                             |
| `.float-tabs-bar`      | 3686   | обёртка: **bg `rgba(13,17,26,0.65)` захардкожен** (не темизируется!) + border-bottom                       |
| `.float-tabs`          | 3525   | segmented control: inset bg, `--r-md`; **двойные margin/padding с обёрткой**                               |
| `.ftab`                | 3535   | h-22px, 11px/500, `cursor: default`; `.active` = bg `--card` + `--shadow-xs`                               |
| `.float-field`         | 3580   | h-26px, разделитель `--separator` снизу                                                                    |
| `.float-lbl`           | 3592   | 11px `--text-3`, min-width 76px                                                                            |
| `.float-val`           | 3599   | **mono 12px tabular-nums**, ellipsis, `user-select: text`                                                  |
| `.float-copy`          | 3614   | 20×20, глифы **юникод `⎘ ✓ ✗`** (не lucide!), hover `--hover`                                              |
| `.float-footer`        | 3570   | border-top, bg `--surface`, gap 6px                                                                        |
| `.float-state`         | 3650   | состояния 100vh: **bg `rgba(11,15,22,0.82)` захардкожен**, gap 40px                                        |
| `.float-spinner`       | 3676   | 24px, `rgba(59,130,246,0.3)` + `--blue`                                                                    |
| `.float-quick-order`   | 3740   | `var(--surface, #1f2429)` — fallback-hex                                                                   |
| `.float-order-row`     | 3753   | **bg `rgba(255,255,255,0.04)`** — в светлой теме почти невидим                                             |
| `.float-status-select` | 3762   | `var(--surface, #1f2429)`                                                                                  |
| `.btn-disabled`        | 3769   | opacity .35                                                                                                |

**Тройное объявление `.float-copy.copied`**: 3638 (`--green-t`) → 3735
(`--color-success`) → 3775 (`#4ade80 !important`, побеждает). При редизайне
оставить одно.

### 7.2 Разметка по табам (4 таба: card / billing / shipping / orders)

- **Шапка**: имя держателя + RiskBadge + `.st st-free|st-archive` карты +
  крестик. `CardHealth` (float.jsx:81): 🟢Fresh/🟡Used/🔴Burned через
  `.health-fresh/.health-used/.health-burned` (components.css:3722-3732 →
  `--color-success/warning/error`), 11px, счётчик ордеров.
- **RiskBadge** (float.jsx:64): `.st.rounded-full.risk-badge.risk-*`;
  единственное определение — components.css:4138-4168 (pill, 11px/500,
  `-t`/`-dim`/`-border` токены); иконки — **эмодзи 🟢🟡🔴 в JSX**.
- **card**: ряды `Field` (label + value + CopyBtn) — номер, expiry, CVV,
  holder, email, phone, bank, type/level.
- **billing**: 5 Field + `btn btn-b w-full` «копировать адрес»; при входе на
  таб адрес **автокопируется** (float.jsx:236-254).
- **shipping**: 7 Field дропа + аналогичная кнопка; без дропа — muted-заглушка.
- **orders**: кнопка `+ Order` (btn-g btn-s, 10px) → инлайн-форма
  `.float-quick-order` (Enter создаёт ордер через `find_or_create_shop`);
  до 5 `.float-order-row`: shop 12px/500 + `.st` статус 10px + **нативный
  `<select>` быстрой смены статуса** (hardcoded англ. опции); внизу
  `btn-ghost btn-sm` «View all orders →».
- **Футер**: `+ Order` (ghost) | `✓ Delivered` (btn-g) | `✗ Declined` (btn-r)
  — **эмодзи ✓/✗ в лейблах**, обе flex-1, disabled без `latestOrderId`.
- Состояния: locked (Lock 28px), waiting, loading (спиннер), error
  (12px `--red-t` + Retry). SEC-011: `app_locked` чистит все данные.

---

## 8. Типографика — фактическое использование

### 8.1 Шрифты и шкала (tokens.css:23-42)

- `--font-ui`: **Geist** (self-hosted, fonts.css) + системный fallback.
- `--font-mono`: **Geist Mono** + ui-monospace fallback.
- Шкала: `--fs-title` 20 · `--fs-heading` 15 · `--fs-body`/`--fs-control` 13 ·
  `--fs-mono` 12 · `--fs-caption` 11. Line-height: 24/20/18/14.

### 8.2 Гистограмма инлайн-размеров `text-[Npx]` (JSX, всего 354)

| px                         | ×   | Где доминирует                                       |
| -------------------------- | --- | ---------------------------------------------------- |
| 11                         | 136 | ячейки таблиц, подписи, мета-инфо                    |
| 12                         | 117 | вторичный текст, dropdown-пункты, заголовки карточек |
| 10                         | 52  | бейджи `.st`, чипы, микрокнопки                      |
| 13                         | 27  | primary-текст строк, имена                           |
| 14                         | 10  | заголовки панелей/модалок                            |
| 9 / 15 / 16 / 18 / 28 / 32 | 12  | единичные (28/32 — hero-цифры дашборда)              |

Вывод: реальная система живёт в коридоре **10-13px**; токены `--fs-*`
используются только в CSS-классах, JSX опирается на Tailwind-литералы.

### 8.3 Моноширинный текст (`.mono`, 141 вхождение в JSX)

- Определение: base.css:161-169 — `.mono, code, pre, [data-numeric]` →
  `--font-mono`, `--fs-mono` 12px, **tabular-nums**; components.css:61 —
  дубль font-family. `.float-val` (3599) ставит mono сам, без класса.
- По файлам (топ): upanel 21, Shops 18, Proxies 13, CardSidePanel 10,
  CreateOrderModal 10, CardRow 6, Couriers 6, Settings 6, OrderRow 5,
  ImportDropsModal 5.
- Семантика: номера карт, треки, суммы, IP/host:port, ID (`#123`), домены.
  В Proxies mono сидит даже на **чипах типа прокси** (.flt mono).

---

## 9. Цвета в JSX — где живут литералы

JSX почти чист от hex: **0 hex-литералов** в продакшен-разметке (кроме
тестов useConfirm.test.jsx). Найденные rgba/исключения:

| Место                         | Литерал                                                      | Комментарий                                                                                                     |
| ----------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `constants/status.js:47-83`   | 7 × `rgba(...,0.1)` в `ORDER_STATUS_COLORS.bg`               | фоны статусов ордеров **захардкожены** (текст — `-t` токены); карточные статусы — полностью на `--color-card-*` |
| `constants/status.js:100-108` | `ORDER_STATUS_DOT_COLORS`                                    | все на `-t` токенах                                                                                             |
| `AppTour.jsx:62`              | `rgba(0,0,0,0.5)` overlay                                    | остальное тур берёт из токенов; `zIndex: 12000` инлайн                                                          |
| `Cards/ImportModal.jsx:32`    | `rgba(255,255,255,0.3)`                                      | спиннер кнопки                                                                                                  |
| `Profiles/ProfileRow.jsx:58`  | `rgba(59,130,246,0.3)`                                       | outline выбранной строки                                                                                        |
| `Updates.jsx:303-306`         | `--red-t/--yellow-t` + `--color-error-bg/--color-warning-bg` | баннер версий, токены инлайн                                                                                    |
| `Settings.jsx` (strength bar) | массив `--red/--yellow/--color-success`                      | сегменты `.auth-strength-seg`                                                                                   |

### 9.1 Три источника правды для цветов статуса

1. **Токены** `-t`/`-dim`/`-border` (tokens.css);
2. **`.st-*` бейджи** с rgba-литералами (pages.css:1925-2030, таблица в §6.1);
3. **status.js** (`*_STATUS_COLORS` для инлайн-стилей + `*_STATUS_CSS` для
   классов).

Редизайн статусной палитры = правка всех трёх, иначе разъезд бейджей,
графиков и таймлайнов. `ORDER_STATUS_CSS` (status.js:119-126) мапит
processing→`st-inuse`, shipped→`st-transit` и т.д. — имена классов
не совпадают с именами статусов, учитывать при переименованиях.

### 9.2 Захардкоженные цвета в CSS (кандидаты на токенизацию)

- `.float-state` bg `rgba(11,15,22,0.82)`, `.float-tabs-bar`
  `rgba(13,17,26,0.65)`, `.float-order-row` `rgba(255,255,255,0.04)`,
  `.float-spinner` `rgba(59,130,246,0.3)`, `.float-copy.copied`
  `#4ade80 !important` (всё — components.css:3485-3777);
- `.live-dot` glow `rgba(34,197,94,.6)` (layout.css:612);
- `.st-*` rgba-литералы (pages.css:1925-2030).

---

## 10. Общие компоненты (`src/components/`)

| Компонент                                                                                                                                                  | Разметка / классы                                                                                                                                                                             | Особенности                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `Modal.jsx` (система A)                                                                                                                                    | portal + focus-trap + Escape, `.modal-overlay`                                                                                                                                                | используется только в 4 местах (Couriers ×3, Settings ×1); остальные 14 файлов — ручная система B                       |
| `EmptyState.jsx`                                                                                                                                           | иконка **38px opacity-25**, title 14px/600, subtitle 12px muted max-w 260px, action                                                                                                           | `colSpan`-режим рендерит `<tr><td>` для таблиц                                                                          |
| `Pagination.jsx`                                                                                                                                           | `btn btn-ghost btn-sm` + `.active.pagination-btn-active`; многоточия `px-2 py-1` 12px muted; слева счётчик 12px                                                                               | `buildPageNumbers` из utils; скрывается при 1 странице                                                                  |
| `ActionsMenu.jsx`                                                                                                                                          | триггер `btn-ghost btn-sm btn-icon-only` 26×26 (MoreHorizontal 16); меню **fixed** от `getBoundingClientRect`, `w-40 bg-card-hi border-border-hi rounded-md`, `z-index: var(--z-menu)` инлайн | пункты 12px `p-[7px_12px]`, danger = `text-red-t`, иконки 14px; полная клавиатурная навигация (стрелки/Home/End/Escape) |
| `SkeletonRow(s).jsx`                                                                                                                                       | `<td>` с инлайн-градиентом `--card`→`--card-hi`, `skeleton-shimmer 1.5s`, h-11px r-5px, ширины из массива                                                                                     | `SkeletonBlock` — div-вариант для не-таблиц (role=status)                                                               |
| `SkeletonCard.jsx`                                                                                                                                         | `card card-pad` + те же inline-шиммеры; `SkeletonStats` — grid auto-fit 200px, каскад `animationDelay: i*50ms`                                                                                | дашборд и карточные страницы                                                                                            |
| `LoadingSpinner.jsx`                                                                                                                                       | `.spinner`/`overlay`-варианты                                                                                                                                                                 | токенные цвета                                                                                                          |
| `ErrorBoundary.jsx`                                                                                                                                        | fallback-экран с Retry                                                                                                                                                                        | float-окно имеет СВОЙ boundary                                                                                          |
| `NewsAlert.jsx`, `AppTour.jsx` (react-joyride, zIndex 12000), `ShortcutsHelp.jsx` (свои `shortcuts-overlay/modal`), `DataLoader.jsx`, `LicenseSection.jsx` | см. DESIGN_SYSTEM §8                                                                                                                                                                          | —                                                                                                                       |

## 11. Матрица влияния редизайна (что трогаем → что ломается)

| Изменение                                 | Затронуто                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Токен в `:root`                           | ВСЁ; проверить dark + **system-dark (23 токена там отсутствуют — DESIGN_SYSTEM §3.4)**                                   |
| `.btn-*` / `--h-control`                  | все страницы + float-окно + модалки обеих систем                                                                         |
| `.tbl` (строка 28px, зебра, sticky-шапка) | Orders, Cards, Profiles, Shops, Proxies ×5 таблиц, ActivityLog, UsersPage, upanel                                        |
| `.st-*` палитра                           | pages.css:1925-2030 + status.js + токены — **три места синхронно** (§9.1)                                                |
| `.filters` / `.flt` / `.search-box`       | Orders, Profiles, Cards, Shops, Proxies, ActivityLog; артефакт `.filters::before` (нет `position: relative` на родителе) |
| `.ph` шапка страницы                      | все страницы кроме Imap (у него своя h-14)                                                                               |
| Система модалок                           | A = 4 использования, B = 14 файлов вручную + ShortcutsHelp свой; унификация = правка 15+ файлов                          |
| Сайдбар/топбар (layout.css)               | App.jsx NAV_DEFS + бейджи + глобальный поиск                                                                             |
| `.float-*` (components.css:3485-3777)     | только float.jsx — можно редизайнить изолированно                                                                        |
| `.auth-*` (pages.css:828-1171)            | Login, UserLogin, Activate — изолированный контур                                                                        |
| `--z-*` шкала                             | модалки, ActionsMenu (инлайн `--z-menu`), AppTour (инлайн 12000!)                                                        |
| keyframes                                 | `fadeIn` вызывается (layout.css:628), но **не определён** — чистая добавка, не поломка                                   |
