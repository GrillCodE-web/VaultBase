# Component Refactoring Guide

**Goal:** Split large components (>1000 lines) into manageable, testable units

---

## Current State

| Component    | Lines | Status            |
| ------------ | ----- | ----------------- |
| Imap.jsx     | 2063  | Needs refactoring |
| Orders.jsx   | 1704  | Needs refactoring |
| Profiles.jsx | 1578  | Needs refactoring |
| Cards.jsx    | 962   | Acceptable        |

---

## Refactoring Principles

### 1. Single Responsibility

Each component should do ONE thing well.

### 2. Composition Over Inheritance

Build complex UIs from simple, reusable pieces.

### 3. Props Down, Events Up

Data flows down, events flow up.

### 4. Extract, Don't Delete

Move code to new files, don't remove functionality.

---

## Imap.jsx Refactoring (2063 → ~300 lines each)

### Current Structure (simplified)

```
Imap.jsx (2063 lines)
├── FolderIcon
├── ActionBadge
├── AccountModal
├── SmtpModal
├── ComposeModal
├── FolderTree
├── EmailList
├── EmailRow
├── EmailView
├── AccountsPanel
└── Main Imap component
```

### Target Structure

```
src/pages/Imap/
├── index.tsx           # Main component (250 lines)
├── ImapSidebar.tsx     # Folder tree + accounts (350 lines)
├── ImapEmailList.tsx   # Virtualized email list (300 lines)
├── ImapEmailRow.tsx    # Single email row (150 lines)
├── ImapEmailView.tsx   # Email reading panel (400 lines)
├── ImapAccountModal.tsx # Add/edit IMAP account (300 lines)
├── ImapSmtpModal.tsx   # SMTP configuration (200 lines)
├── ImapComposeModal.tsx # Compose email (350 lines)
├── ImapAccountsPanel.tsx # Manage accounts (250 lines)
└── types.ts            # Imap-specific types (100 lines)
```

### Extraction Steps

#### Step 1: Create ImapEmailRow.tsx

```typescript
// src/pages/Imap/ImapEmailRow.tsx
import React from 'react';
import { Mail, Paperclip, Star } from 'lucide-react';
import { Email } from '../../types';

export interface ImapEmailRowProps {
  email: Email;
  isSelected: boolean;
  onSelect: (id: number) => void;
  onStar: (id: number) => void;
}

export const ImapEmailRow: React.FC<ImapEmailRowProps> = ({
  email,
  isSelected,
  onSelect,
  onStar,
}) => {
  return (
    <div
      className={`email-row ${isSelected ? 'selected' : ''}`}
      onClick={() => onSelect(email.id)}
    >
      <button
        className="star-button"
        onClick={(e) => {
          e.stopPropagation();
          onStar(email.id);
        }}
      >
        <Star size={14} className={email.folder === 'starred' ? 'filled' : ''} />
      </button>

      <div className="email-sender">{email.from}</div>
      <div className="email-subject">{email.subject}</div>
      <div className="email-date">{new Date(email.date).toLocaleDateString()}</div>

      {email.body_text?.includes('tracking') && (
        <span className="badge">Has Tracking</span>
      )}
    </div>
  );
};
```

#### Step 2: Create ImapEmailList.tsx

```typescript
// src/pages/Imap/ImapEmailList.tsx
import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ImapEmailRow } from './ImapEmailRow';
import { Email } from '../../types';

export interface ImapEmailListProps {
  emails: Email[];
  selectedId?: number;
  onSelect: (id: number) => void;
  onStar: (id: number) => void;
}

export const ImapEmailList: React.FC<ImapEmailListProps> = ({
  emails,
  selectedId,
  onSelect,
  onStar,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: emails.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 50,
    overscan: 5,
  });

  return (
    <div ref={parentRef} className="email-list">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={emails[virtualRow.index].id}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <ImapEmailRow
              email={emails[virtualRow.index]}
              isSelected={emails[virtualRow.index].id === selectedId}
              onSelect={onSelect}
              onStar={onStar}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
```

#### Step 3: Create ImapSidebar.tsx

```typescript
// src/pages/Imap/ImapSidebar.tsx
import React from 'react';
import { Inbox, Sent, Trash, Spam, Drafts, Archive, Folder } from 'lucide-react';

const FOLDER_ICONS: Record<string, React.ElementType> = {
  'inbox': Inbox,
  'sent': Sent,
  'trash': Trash,
  'spam': Spam,
  'drafts': Drafts,
  'archive': Archive,
};

export interface ImapFolder {
  name: string;
  count: number;
  selected: boolean;
}

export interface ImapSidebarProps {
  folders: ImapFolder[];
  onSelectFolder: (name: string) => void;
}

export const ImapSidebar: React.FC<ImapSidebarProps> = ({
  folders,
  onSelectFolder,
}) => {
  return (
    <div className="imap-sidebar">
      {folders.map((folder) => {
        const Icon = FOLDER_ICONS[folder.name.toLowerCase()] || Folder;
        return (
          <button
            key={folder.name}
            className={`folder-item ${folder.selected ? 'selected' : ''}`}
            onClick={() => onSelectFolder(folder.name)}
          >
            <Icon size={16} />
            <span>{folder.name}</span>
            {folder.count > 0 && (
              <span className="folder-count">{folder.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
};
```

#### Step 4: Update Main Imap Component

```typescript
// src/pages/Imap/index.tsx
import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ImapSidebar } from './ImapSidebar';
import { ImapEmailList } from './ImapEmailList';
import { ImapEmailView } from './ImapEmailView';
import { ImapAccountModal } from './ImapAccountModal';
import { ImapAccountsPanel } from './ImapAccountsPanel';
import { Email } from '../../types';

export const Imap: React.FC = () => {
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedFolder, setSelectedFolder] = useState('inbox');
  const [selectedEmailId, setSelectedEmailId] = useState<number>();
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showAccountsPanel, setShowAccountsPanel] = useState(false);

  const loadEmails = async () => {
    const result = await invoke('get_emails', { folder: selectedFolder });
    setEmails(result as Email[]);
  };

  useEffect(() => {
    loadEmails();
  }, [selectedFolder]);

  return (
    <div className="imap-page">
      <div className="imap-layout">
        <ImapSidebar
          folders={[
            { name: 'inbox', count: 10, selected: selectedFolder === 'inbox' },
            { name: 'sent', count: 5, selected: selectedFolder === 'sent' },
            // ...
          ]}
          onSelectFolder={setSelectedFolder}
        />

        <div className="email-list-container">
          <ImapEmailList
            emails={emails}
            selectedId={selectedEmailId}
            onSelect={setSelectedEmailId}
            onStar={async (id) => {
              await invoke('toggle_email_star', { id });
              loadEmails();
            }}
          />
        </div>

        {selectedEmailId && (
          <ImapEmailView
            emailId={selectedEmailId}
            onClose={() => setSelectedEmailId(undefined)}
            onReply={() => {/* ... */}}
            onForward={() => {/* ... */}}
          />
        )}
      </div>

      {showAccountModal && (
        <ImapAccountModal
          onClose={() => setShowAccountModal(false)}
          onSave={loadEmails}
        />
      )}

      {showAccountsPanel && (
        <ImapAccountsPanel
          onClose={() => setShowAccountsPanel(false)}
          onAddAccount={() => setShowAccountModal(true)}
        />
      )}
    </div>
  );
};
```

---

## Orders.jsx Refactoring (1704 → ~300 lines each)

### Target Structure

```
src/pages/Orders/
├── index.tsx              # Main component (250 lines)
├── OrderList.tsx          # Virtualized list (300 lines)
├── OrderFilters.tsx       # Already extracted
├── OrderRow.tsx           # Already extracted
├── OrderModal.tsx         # View/edit order (350 lines)
├── OrderImport.tsx        # Single import (200 lines)
├── BatchImportModal.tsx   # Already extracted
├── OrderStats.tsx         # Statistics panel (150 lines)
└── types.ts               # Order-specific types
```

### Key Extractions

#### OrderStats.tsx (NEW)

```typescript
// src/pages/Orders/OrderStats.tsx
import React from 'react';
import { Package, Truck, CheckCircle, XCircle } from 'lucide-react';

export interface OrderStatsProps {
  total: number;
  pending: number;
  processing: number;
  shipped: number;
  delivered: number;
  cancelled: number;
}

export const OrderStats: React.FC<OrderStatsProps> = ({
  total,
  pending,
  processing,
  shipped,
  delivered,
  cancelled,
}) => {
  return (
    <div className="order-stats">
      <StatCard
        icon={Package}
        label="Total"
        value={total}
        color="var(--blue)"
      />
      <StatCard
        icon={Package}
        label="Pending"
        value={pending}
        color="var(--yellow)"
      />
      <StatCard
        icon={Truck}
        label="Shipped"
        value={shipped}
        color="var(--blue)"
      />
      <StatCard
        icon={CheckCircle}
        label="Delivered"
        value={delivered}
        color="var(--green)"
      />
      <StatCard
        icon={XCircle}
        label="Cancelled"
        value={cancelled}
        color="var(--red)"
      />
    </div>
  );
};

const StatCard = ({ icon: Icon, label, value, color }) => (
  <div className="stat-card">
    <Icon size={20} style={{ color }} />
    <span className="stat-label">{label}</span>
    <span className="stat-value">{value}</span>
  </div>
);
```

---

## Profiles.jsx Refactoring (1578 → ~300 lines each)

### Target Structure

```
src/pages/Profiles/
├── index.tsx              # Main component (250 lines)
├── ProfileList.tsx        # Virtualized list (300 lines)
├── ProfileFilters.tsx     # Already extracted
├── ProfileRow.tsx         # Already extracted
├── ProfileModal.tsx       # Already extracted
├── ProfileMerge.tsx       # Merge duplicates (250 lines)
├── ProfileImport.tsx      # Import/export (200 lines)
├── ProfileStats.tsx       # Statistics (150 lines)
└── types.ts               # Profile-specific types
```

### Key Extractions

#### ProfileMerge.tsx (NEW)

```typescript
// src/pages/Profiles/ProfileMerge.tsx
import React, { useState } from 'react';
import { Profile } from '../../types';
import { Merge, User } from 'lucide-react';

export interface ProfileMergeProps {
  duplicates: Profile[];
  onMerge: (keepId: number, mergeIds: number[]) => Promise<void>;
  onClose: () => void;
}

export const ProfileMerge: React.FC<ProfileMergeProps> = ({
  duplicates,
  onMerge,
  onClose,
}) => {
  const [selectedKeepId, setSelectedKeepId] = useState<number>(duplicates[0]?.id);

  const handleMerge = async () => {
    const mergeIds = duplicates
      .filter((p) => p.id !== selectedKeepId)
      .map((p) => p.id);
    await onMerge(selectedKeepId, mergeIds);
    onClose();
  };

  return (
    <div className="profile-merge-modal">
      <div className="modal-header">
        <Merge size={20} />
        <h2>Merge Duplicate Profiles</h2>
      </div>

      <div className="modal-body">
        <p className="text-muted">
          Select the profile to keep. All data from other profiles will be merged.
        </p>

        <div className="profile-list">
          {duplicates.map((profile) => (
            <label
              key={profile.id}
              className={`profile-option ${profile.id === selectedKeepId ? 'selected' : ''}`}
            >
              <input
                type="radio"
                name="keep-profile"
                value={profile.id}
                checked={profile.id === selectedKeepId}
                onChange={() => setSelectedKeepId(profile.id)}
              />
              <User size={16} />
              <span>{profile.label}</span>
              <span className="text-muted">{profile.email}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="modal-footer">
        <button onClick={onClose} className="btn btn-ghost">
          Cancel
        </button>
        <button onClick={handleMerge} className="btn btn-primary">
          Merge Profiles
        </button>
      </div>
    </div>
  );
};
```

---

## Testing After Refactoring

### Unit Tests

```typescript
// src/pages/Imap/__tests__/ImapEmailRow.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ImapEmailRow } from '../ImapEmailRow';

describe('ImapEmailRow', () => {
  const mockEmail = {
    id: 1,
    from: 'test@example.com',
    subject: 'Test Subject',
    date: '2026-03-25',
  };

  it('renders email details', () => {
    render(
      <ImapEmailRow
        email={mockEmail}
        isSelected={false}
        onSelect={() => {}}
        onStar={() => {}}
      />
    );

    expect(screen.getByText('test@example.com')).toBeInTheDocument();
    expect(screen.getByText('Test Subject')).toBeInTheDocument();
  });

  it('calls onSelect when clicked', () => {
    const onSelect = jest.fn();
    render(
      <ImapEmailRow
        email={mockEmail}
        isSelected={false}
        onSelect={onSelect}
        onStar={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('row'));
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});
```

---

## Checklist

### Before Refactoring

- [ ] Write tests for current behavior
- [ ] Document current props/behavior
- [ ] Create new directory structure
- [ ] Set up barrel exports (index.ts)

### During Refactoring

- [ ] Extract one component at a time
- [ ] Keep git commits small
- [ ] Update imports incrementally
- [ ] Run tests after each extraction

### After Refactoring

- [ ] All tests pass
- [ ] No console errors
- [ ] Performance is same or better
- [ ] Code is more readable
- [ ] Components are reusable

---

## Benefits

After refactoring:

- ✅ Each file < 400 lines
- ✅ Components are testable in isolation
- ✅ Easier to find and fix bugs
- ✅ Better code reuse
- ✅ Clearer component boundaries
- ✅ Easier TypeScript migration

---

## Timeline

| Component    | Current        | Target       | Effort       |
| ------------ | -------------- | ------------ | ------------ |
| Imap.jsx     | 2063 lines     | 9 files      | 2-3 days     |
| Orders.jsx   | 1704 lines     | 8 files      | 2 days       |
| Profiles.jsx | 1578 lines     | 8 files      | 2 days       |
| **Total**    | **5345 lines** | **25 files** | **6-7 days** |

---

## Contact

For refactoring questions: dev@ccmanager.local
