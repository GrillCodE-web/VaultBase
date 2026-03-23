# CC Manager — Прогресс по плану (Сессия 3)

## ✅ ВЫПОЛНЕНО В СЕССИИ 3

### БЛОК 0 — CSS Foundation

- [x] `tokens.css` — добавлены `--hover: rgba(255,255,255,0.05)`, `--surface-hi: #131820`
- [x] `tokens.css` — `--muted: #5a6a82` (светлее, лучше читается)
- [x] `buttons.css` — добавлены `.btn-icon`, `.btn-icon-only` + все цвет-варианты (b/g/r/y/ghost)
- [x] `panel.css` — `.period-bar` `width: fit-content` → `width: 100%`
- [x] `dashboard.css` — `border-top: 3px` → `4px`, `.base-strip padding: 10px` → `13px`

### БЛОК 1.5 — Emoji → Lucide

- [x] `Imap.jsx` — `folderIcon()` emoji → `<FolderIcon>` компонент (Inbox/Send/Trash2/AlertOctagon/FileText/Folder)
- [x] `Imap.jsx` — tabs emoji → Lucide icons (Inbox/Settings/Send/Mail/Database)
- [x] `Imap.jsx` — заголовок `📬 Email / IMAP` → `Email / IMAP`
- [x] `Profiles.jsx` — `🎲 Auto` → `<Shuffle size={12} /> Auto`
- [x] `Dashboard.jsx` — `⚠` → `<AlertTriangle>` в base strip
- [x] `Dashboard.jsx` — `▶▼` chevrons → `<ChevronRight>` с CSS анимацией rotate 90deg

### БЛОК 2 — Settings fixes (частично)

- [x] `Settings.jsx` — `handleAutoLock` awaits перед setState
- [x] `Settings.jsx` — spinner `<RefreshCw>` на loading sync group

### БЛОК 2.5 — Dashboard redesign

- [x] Chart: `height={180}` → `260`, empty state `height: 160` → `240`
- [x] Heatmap: `minWidth: 48` → `72`, убраны `maxWidth` ограничения
- [x] Heatmap: opacity → `0.65/0.55/0.65`
- [x] Heatmap legend цвета обновлены
- [x] "View all" plain text → `className="btn btn-ghost btn-sm"`

### БЛОК 2.6 — IMAP bug fixes (частично)

- [x] BUG FIX: `onNavigate` prop добавлен в `Imap({ onNavigate })` — Email Pool таб не падает
- [x] BUG FIX: `selectFolder()` убран принудительный `setTab("inbox")`

### БЛОК 3 — Action Buttons редизайн

- [x] Создан `src/components/ActionsMenu.jsx` — dropdown с группами, danger, fixed позиция, click-outside
- [x] `Cards.jsx` — 8 кнопок → 2 иконки (Store/Clock) + ActionsMenu с группами
- [x] `Profiles.jsx` — 6 кнопок → Float button (всегда) + ActionsMenu

### Toast + layout

- [x] `useToast.jsx` (оба файла) — emoji → Lucide icons; исправлен баг warn toast (прозрачный текст)
- [x] `Cards.jsx` — `calc(100vh - 270px)` → `minHeight: 0`
- [x] `Emails.jsx` — `calc(100vh - 270px)` → `flex: 1, minHeight: 0`

### БЛОК 1A — calc() fix

- [x] `Cards.jsx` — `calc(100vh - 270px)` → `minHeight: 0`
- [x] `Emails.jsx` — то же
- [~] `Orders.jsx`, `Shops.jsx` — не содержат паттерн, не нужно

### БЛОК 1B — Settings responsive

- [x] `Settings.jsx` — autolock кнопки `flexWrap: "wrap"` добавлен

### БЛОК 1C — Inline hover handlers → CSS

- [x] `Emails.jsx` — убраны `onMouseEnter/Leave` на IMAP account dropdown кнопках
- [x] `Orders.jsx` — убраны все 9 onMouseEnter/Leave (StatusMenu, profile/shop search, template buttons)
- [~] `Shops.jsx` — не содержит inline hover handlers

### БЛОК 2.6 — IMAP

- [x] IC — Delete кнопка добавлена в MessageViewer (Trash2 + handleDeleteMessage, оптимистичное удаление)
- [x] IE — modal state разделён: showAddImap, editAccount, showAddSmtp, showCompose
- [~] IF — folder unread counts уже работают частично через stats[acc.id].folders

### БЛОК 2.7 — Модалки polish

- [x] MA — modal widths через токены: AccountModal/SmtpModal → `var(--modal-md)`, ComposeModal → `var(--modal-lg)`
- [x] MC — footer модалок стандартизирован (уже был правильный, подтверждено)
- [x] MD — loading states: AccountModal ✓, SmtpModal ✓ (добавлен spinner), ComposeModal ✓

### БЛОК 3C — Shops.jsx

- [x] Checkbox + bulk delete добавлен
- [ ] "New Order" кнопку сделать заметнее (minor, опционально)

---

### Emoji cleanup (батч 2)

- [x] `Emails.jsx` — `🚫` → `<ShieldOff>`, `🗑` → `<Trash2>` в bulk toolbar
- [x] `Cards.jsx` — `⚡ BIN Enrich` → `<Zap>`
- [x] `Imap.jsx` — `✉ New Message` → `<PenSquare>`, `↩ Reply` → `<CornerUpLeft>`
- [~] В работе: Orders `↻⬇`, Dashboard `↻⬇`, Profiles/Shops `⬇` (агент)

### БЛОК MA — Modal widths (остальные файлы)

- [x] `Orders.jsx` `width: 360` → `var(--modal-sm)`
- [x] `Dashboard.jsx` `↻` → `<RefreshCw>`, `⬇` → `<Download>`
- [x] `Profiles.jsx` `⬇ Export` → `<Download size={13} /> Export`
- [x] `Shops.jsx` `⬇ CSV` → `<Download size={13} /> CSV`

### CSS responsive (батч 2)

- [x] `content.css` — `.grid2` добавлен `minmax(0,1fr)` + `@media ≤600px → 1fr`
- [x] `content.css` — `.ph-actions` добавлен `flex-wrap: wrap`

---

## ✅ ПЛАН СЕССИИ 3 — ПОЛНОСТЬЮ ВЫПОЛНЕН

Все задачи из плана реализованы. Билд чистый: ✓ 0 ошибок.

## ✅ СЕССИЯ 4 — ФИНАЛЬНЫЙ POLISH

### Emoji cleanup (батч 3)

- [x] `ActivityLog.jsx` — `↻` → `<RefreshCw>`
- [x] `Updates.jsx` — `↻` → `<RefreshCw>` (5 мест)
- [x] `Cards.jsx` — `⚠` → `<AlertTriangle>` (x2), `🗂` → `<Archive>`, `⬆` → `<Upload>`
- [x] `Proxies.jsx` — `🌐` → `<Globe>`, `🛡️` → `<Shield>`
- [x] `Profiles.jsx` — `⚠️` → `<AlertTriangle>`, `👤` → `<User size={38} />`
- [x] `Shops.jsx` — `↗` → `<ExternalLink>` (x2), `🏪` → `<Store>` (x2), `🔍` убрано из placeholder
- [x] `Orders.jsx` — `📦` → `<Package>`, `🔍` убрано из placeholder
- [x] `Emails.jsx` — `📧` → `<Mail>`

### calc(100vh) fixes (батч 2)

- [x] `Proxies.jsx` — `max-h-[calc(100vh-270px)]` → `flex:1, minHeight:0`
- [x] `Profiles.jsx` — то же

### Modal widths (батч 2)

- [x] `Proxies.jsx` — `440` → `var(--modal-sm)`, `560` → `var(--modal-md)`
- [x] `Orders.jsx` — `720` → `var(--modal-lg)`
- [x] `Emails.jsx` — `400` → `var(--modal-sm)`

---

## ФАЙЛЫ ПРОЕКТА

Путь: `/Users/jellybeats/Documents/CC_Manager/manager-work`
