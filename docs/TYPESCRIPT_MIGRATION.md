# TypeScript Migration Guide

**Status:** Ready for migration
**Created:** 2026-03-25

---

## Overview

This document provides a step-by-step guide for migrating CC Manager from JavaScript to TypeScript.

### Current State

- **JavaScript files:** ~50 files in `src/`
- **Largest files:** Imap.jsx (2063), Orders.jsx (1704), Profiles.jsx (1578)
- **Type coverage:** 0% (plain JS)

### Target State

- **TypeScript files:** Full migration
- **Strict mode:** Enabled
- **Type coverage:** 95%+ (excluding third-party libs)

---

## Prerequisites

```bash
# Install TypeScript and related packages
npm install -D typescript @types/react @types/react-dom @types/node

# Install Vite TypeScript support
# (already configured in vite.config.js)
```

---

## Migration Steps

### Step 1: Verify Configuration

Files already created:

- `tsconfig.json` — Main TypeScript configuration
- `tsconfig.node.json` — Node/Vite types
- `src/types/index.ts` — Base type definitions

### Step 2: Rename Utility Files (Easiest)

Start with utility files (no JSX):

```bash
# Rename and add types
mv src/utils/formatting.js src/utils/formatting.ts
mv src/utils/validation.js src/utils/validation.ts
mv src/utils/csv.js src/utils/csv.ts
mv src/utils/pagination.js src/utils/pagination.ts
mv src/utils/clipboard.js src/utils/clipboard.ts
mv src/utils/cardHealth.js src/utils/cardHealth.ts
mv src/utils/errorHandler.js src/utils/errorHandler.ts
mv src/utils/escape.js src/utils/escape.ts
mv src/utils/animations.js src/utils/animations.ts
```

Add type annotations:

```typescript
// src/utils/formatting.ts
export function formatDate(dateString: string | Date, locale?: string): string {
  const date = typeof dateString === 'string' ? new Date(dateString) : dateString
  return date.toLocaleDateString(locale || 'ru-RU')
}

export function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount)
}

export function formatCardNumber(number: string): string {
  const digits = number.replace(/\D/g, '')
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim()
}
```

### Step 3: Rename Constants Files

```bash
mv src/constants/cardTypes.js src/constants/cardTypes.ts
mv src/constants/status.js src/constants/status.ts
mv src/constants/colors.js src/constants/colors.ts
mv src/constants/emailProviders.js src/constants/emailProviders.ts
```

These files are mostly data, so minimal type changes needed:

```typescript
// src/constants/cardTypes.ts
export type CardType = 'Visa' | 'Mastercard' | 'American Express' | 'Discover' | 'JCB' | 'Mir'

export const CARD_PATTERNS: Record<CardType, RegExp> = {
  Visa: /^4[0-9]{12}(?:[0-9]{3})?$/,
  Mastercard: /^5[1-5][0-9]{14}$/,
  // ...
}
```

### Step 4: Migrate Hooks

```bash
mv src/hooks/useLang.jsx src/hooks/useLang.tsx
mv src/hooks/useToast.jsx src/hooks/useToast.tsx
mv src/hooks/useConfirm.jsx src/hooks/useConfirm.tsx
mv src/hooks/useDebounce.js src/hooks/useDebounce.ts
mv src/hooks/useFocusTrap.jsx src/hooks/useFocusTrap.tsx
mv src/hooks/useKeyboardShortcuts.js src/hooks/useKeyboardShortcuts.tsx
mv src/hooks/useTheme.jsx src/hooks/useTheme.tsx
```

Example with generics:

```typescript
// src/hooks/useDebounce.ts
import { useState, useEffect } from 'react'

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}
```

### Step 5: Migrate Store Files

```bash
mv src/store/cards.js src/store/cards.ts
mv src/store/orders.js src/store/orders.ts
mv src/store/profiles.js src/store/profiles.ts
mv src/store/settings.js src/store/settings.ts
```

Use the types from `src/types/index.ts`:

```typescript
// src/store/cards.ts
import { create } from 'zustand'
import { Card, CardsState, CardsFilters } from '../types'
import { invoke } from '@tauri-apps/api/core'

const DEFAULT_FILTERS: CardsFilters = {
  search: '',
  status: 'all',
  type: 'all',
  shop: 'all',
  tags: [],
  sortBy: 'created_at',
  sortOrder: 'desc',
}

export const useCardsStore = create<CardsState>((set, get) => ({
  cards: [],
  filters: DEFAULT_FILTERS,
  loading: false,
  error: null,
  lastFetch: null,

  setCards: cards => set({ cards }),

  addCard: card => set(state => ({ cards: [...state.cards, card] })),

  updateCard: (id, updates) =>
    set(state => ({
      cards: state.cards.map(c => (c.id === id ? { ...c, ...updates } : c)),
    })),

  deleteCard: id =>
    set(state => ({
      cards: state.cards.filter(c => c.id !== id),
    })),

  setFilters: newFilters =>
    set(state => ({
      filters: { ...state.filters, ...newFilters },
    })),

  fetchCards: async () => {
    set({ loading: true, error: null })
    try {
      const cards = await invoke('get_cards')
      set({ cards, loading: false, lastFetch: Date.now() })
    } catch (error) {
      set({ error: String(error), loading: false })
    }
  },

  clearError: () => set({ error: null }),
}))
```

### Step 6: Migrate Components (Smallest First)

Start with small components:

```bash
# ~50-100 lines
mv src/components/EmptyState.jsx src/components/EmptyState.tsx
mv src/components/SkeletonCard.jsx src/components/SkeletonCard.tsx
mv src/components/SkeletonRow.jsx src/components/SkeletonRow.tsx
mv src/components/LoadingSpinner.jsx src/components/LoadingSpinner.tsx
mv src/components/Modal.jsx src/components/Modal.tsx
mv src/components/ErrorBoundary.jsx src/components/ErrorBoundary.tsx

# ~100-200 lines
mv src/components/ActionsMenu.jsx src/components/ActionsMenu.tsx
mv src/components/AnimatedButton.jsx src/components/AnimatedButton.tsx
mv src/components/AnimatedIcon.jsx src/components/AnimatedIcon.tsx
mv src/components/ShortcutsHelp.jsx src/components/ShortcutsHelp.tsx
```

Example:

```typescript
// src/components/EmptyState.tsx
import React from 'react';
import { LucideIcon } from 'lucide-react';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  action,
}) => {
  return (
    <div className="empty-state">
      <Icon size={48} className="text-muted" />
      <h3 className="empty-state-title">{title}</h3>
      {description && <p className="text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
};
```

### Step 7: Migrate Pages (Largest Files)

Do these last as they have the most dependencies:

```bash
# Medium size (~500-1000 lines)
mv src/pages/Dashboard.jsx src/pages/Dashboard.tsx
mv src/pages/Settings.jsx src/pages/Settings.tsx
mv src/pages/Activate.jsx src/pages/Activate.tsx
mv src/pages/Login.jsx src/pages/Login.tsx
mv src/pages/Catalog.jsx src/pages/Catalog.tsx

# Large files (>1000 lines) - split first!
# See "Component Refactoring" below
```

### Step 8: Migrate App.jsx (Last)

```bash
mv src/App.jsx src/App.tsx
mv src/main.jsx src/main.tsx
```

---

## Component Refactoring (Before TS Migration)

Large files should be split before TypeScript migration:

### Imap.jsx (2063 lines) → Split into:

```
src/pages/Imap/
├── index.tsx         # Main component (~300 lines)
├── ImapSidebar.tsx   # Folder tree (~200 lines)
├── ImapList.tsx      # Email list virtualized (~400 lines)
├── ImapRow.tsx       # Single email row (~150 lines)
├── ImapView.tsx      # Email view panel (~300 lines)
├── AccountModal.tsx  # IMAP account modal (~250 lines)
├── SmtpModal.tsx     # SMTP config modal (~200 lines)
├── ComposeModal.tsx  # Compose email modal (~300 lines)
└── AccountsPanel.tsx # Manage accounts panel (~200 lines)
```

### Orders.jsx (1704 lines) → Split into:

```
src/pages/Orders/
├── index.tsx         # Main component (~300 lines)
├── OrderList.tsx     # Order list virtualized (~400 lines)
├── OrderRow.tsx      # Already extracted
├── OrderFilters.tsx  # Already extracted
├── OrderModal.tsx    # Order details/edit (~250 lines)
├── OrderImport.tsx   # Import modal (~200 lines)
└── BatchImportModal.tsx # Already extracted
```

### Profiles.jsx (1578 lines) → Split into:

```
src/pages/Profiles/
├── index.tsx         # Main component (~300 lines)
├── ProfileList.tsx   # Profile list virtualized (~400 lines)
├── ProfileRow.tsx    # Already extracted
├── ProfileFilters.tsx # Already extracted
├── ProfileModal.tsx  # Already extracted
├── ProfileMerge.tsx  # Merge duplicates (~200 lines)
└── ProfileImport.tsx # Import/export (~150 lines)
```

---

## Type Safety Levels

### Level 1: Basic (Week 1-2)

```typescript
// Basic type annotations
function formatDate(date: Date): string {
  return date.toLocaleDateString()
}
```

### Level 2: Strict (Week 3-4)

```typescript
// Strict null checks, no implicit any
function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) {
    throw new Error('Invalid date')
  }
  return d.toLocaleDateString()
}
```

### Level 3: Advanced (Week 5+)

```typescript
// Generics, utility types, discriminated unions
type Result<T, E = Error> = { success: true; data: T } | { success: false; error: E }

function parseCardNumber(input: string): Result<{ formatted: string; type: CardType }> {
  // Implementation
}
```

---

## Common Patterns

### Event Handlers

```typescript
// Instead of:
const handleClick = (e) => { ... }

// Use:
const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => { ... }
```

### State

```typescript
// Instead of:
const [cards, setCards] = useState([])

// Use:
const [cards, setCards] = useState<Card[]>([])
```

### Props

```typescript
// Instead of:
function CardRow({ card, onEdit, onDelete }) { ... }

// Use:
interface CardRowProps {
  card: Card;
  onEdit: (card: Card) => void;
  onDelete: (id: number) => void;
}

function CardRow({ card, onEdit, onDelete }: CardRowProps) { ... }
```

### API Calls

```typescript
// Instead of:
async function fetchCards() {
  const response = await fetch('/api/cards')
  return response.json()
}

// Use:
async function fetchCards(): Promise<Card[]> {
  const response = await fetch('/api/cards')
  const data = await response.json()
  return data.items as Card[]
}
```

---

## Migration Checklist

### Phase 1: Foundation (Days 1-3)

- [ ] Install TypeScript and types
- [ ] Verify tsconfig.json
- [ ] Create src/types/index.ts
- [ ] Migrate utils/_.js → utils/_.ts
- [ ] Migrate constants/_.js → constants/_.ts

### Phase 2: Hooks & Store (Days 4-7)

- [ ] Migrate hooks/_.js(x) → hooks/_.tsx
- [ ] Migrate store/_.js → store/_.ts
- [ ] Add generic types to Zustand stores

### Phase 3: Small Components (Days 8-14)

- [ ] Migrate components/EmptyState
- [ ] Migrate components/Skeleton\*
- [ ] Migrate components/Modal
- [ ] Migrate components/ErrorBoundary
- [ ] Migrate components/ActionsMenu

### Phase 4: Pages - Small (Days 15-21)

- [ ] Migrate pages/Dashboard
- [ ] Migrate pages/Settings
- [ ] Migrate pages/Activate
- [ ] Migrate pages/Login
- [ ] Migrate pages/Catalog

### Phase 5: Component Refactoring (Days 22-28)

- [ ] Split Imap.jsx into subcomponents
- [ ] Split Orders.jsx into subcomponents
- [ ] Split Profiles.jsx into subcomponents

### Phase 6: Pages - Large (Days 29-35)

- [ ] Migrate refactored Imap components
- [ ] Migrate refactored Orders components
- [ ] Migrate refactored Profiles components
- [ ] Migrate pages/Cards

### Phase 7: Final (Days 36-42)

- [ ] Migrate App.jsx
- [ ] Migrate main.jsx
- [ ] Remove @ts-check comments
- [ ] Enable strict mode fully
- [ ] Add ESLint TypeScript rules

---

## Post-Migration

### ESLint Configuration

Add to `.eslintrc.js` or `eslint.config.js`:

```javascript
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'

export default [
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs['recommended'].rules,
      ...tsPlugin.configs['strict'].rules,
    },
  },
]
```

### Install Additional Packages

```bash
npm install -D @typescript-eslint/parser @typescript-eslint/eslint-plugin
npm install -D @types/react @types/react-dom
npm install -D @types/node
```

---

## Benefits

After migration:

- ✅ Type safety for all functions
- ✅ IntelliSense in IDE
- ✅ Catch errors at compile time
- ✅ Better refactoring support
- ✅ Self-documenting code
- ✅ Easier onboarding for new developers

---

## Timeline

| Phase            | Duration    | Files  | Lines       |
| ---------------- | ----------- | ------ | ----------- |
| Foundation       | 3 days      | 15     | ~500        |
| Hooks & Store    | 4 days      | 10     | ~800        |
| Small Components | 7 days      | 15     | ~1500       |
| Pages - Small    | 7 days      | 5      | ~2000       |
| Refactoring      | 7 days      | 20     | ~3000       |
| Pages - Large    | 7 days      | 10     | ~4000       |
| Final            | 7 days      | 5      | ~1000       |
| **Total**        | **42 days** | **80** | **~12,800** |

---

## Contact

For TypeScript questions: dev@ccmanager.local
