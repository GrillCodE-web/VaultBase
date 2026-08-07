// VaultBase — TypeScript Type Definitions
// Version: 2.2.0

// ============================================================================
// Core Entities
// ============================================================================

export interface Card {
  id: number;
  number_encrypted: string;
  cvv_encrypted?: string;
  expiry_month: number;
  expiry_year: number;
  holder_name?: string;
  status: CardStatus;
  bin?: string;
  bank_name?: string;
  card_type?: CardType;
  card_level?: string;
  country?: string;
  country_code?: string;
  shop_id?: number;
  shop_name?: string;
  note?: string;
  tags?: string[];
  created_at: string;
  updated_at: string;
  health_score?: number;
  health_status?: 'good' | 'warning' | 'critical';
}

export type CardStatus =
  | 'active'
  | 'blocked'
  | 'expired'
  | 'declined'
  | 'pending'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'dead'
  | 'free';

export type CardType = 'Visa' | 'Mastercard' | 'American Express' | 'Discover' | 'JCB' | 'Mir';

// ============================================================================
// Orders
// ============================================================================

export interface Order {
  id: number;
  shop_id: number;
  shop_name?: string;
  profile_id?: number;
  card_id?: number;
  amount: number;
  currency: string;
  status: OrderStatus;
  tracking_number?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export type OrderStatus =
  | 'pending'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'declined';

// ============================================================================
// Profiles
// ============================================================================

export interface Profile {
  id: number;
  label: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  birthday?: string;
  gender?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Shops
// ============================================================================

export interface Shop {
  id: number;
  name: string;
  domain: string;
  url?: string;
  category?: string;
  country?: string;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Email
// ============================================================================

export interface EmailAccount {
  id: number;
  label: string;
  host: string;
  port: number;
  login: string;
  password_encrypted: string;
  enabled: boolean;
  poll_interval: number;
  last_checked?: string;
  created_at: string;
  updated_at: string;
}

export interface SmtpAccount {
  id: number;
  label: string;
  host: string;
  port: number;
  login: string;
  password_encrypted: string;
  use_tls: boolean;
  use_starttls: boolean;
  created_at: string;
}

export interface Email {
  id: number;
  account_id: number;
  uid: number;
  folder: string;
  subject?: string;
  from?: string;
  to?: string;
  date: string;
  body_text?: string;
  body_html?: string;
  parsed_card_id?: number;
  parsed_order_id?: number;
  created_at: string;
}

// ============================================================================
// API Responses
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

// ============================================================================
// Store Types (Zustand)
// ============================================================================

export interface CardsState {
  cards: Card[];
  filters: CardsFilters;
  loading: boolean;
  error: string | null;
  lastFetch: number | null;
  setCards: (cards: Card[]) => void;
  addCard: (card: Card) => void;
  updateCard: (id: number, updates: Partial<Card>) => void;
  deleteCard: (id: number) => void;
  setFilters: (filters: Partial<CardsFilters>) => void;
  fetchCards: () => Promise<void>;
  clearError: () => void;
}

export interface CardsFilters {
  search: string;
  status: CardStatus | 'all';
  type: CardType | 'all';
  shop: number | 'all';
  tags: string[];
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

// ============================================================================
// Component Props
// ============================================================================

export interface CardRowProps {
  card: Card;
  onEdit: (card: Card) => void;
  onDelete: (id: number) => void;
  onCopy: (text: string, field: string) => void;
  onReveal: (id: number) => Promise<void>;
}

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  children: React.ReactNode;
}

// ============================================================================
// Utility Types
// ============================================================================

export type Nullable<T> = T | null;

export type Optional<T> = T | undefined;

export type AsyncFunction<T = void> = () => Promise<T>;

export type EventHandler<T = unknown> = (data: T) => void | Promise<void>;

// ============================================================================
// Tauri Types
// ============================================================================

export interface TauriEvent<T> {
  payload: T;
}

export interface InvokeOptions {
  cmd: string;
  [key: string]: unknown;
}

// ============================================================================
// Settings
// ============================================================================

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  language: 'en' | 'ru';
  autolock_timeout: number;
  notifications_enabled: boolean;
  sync_enabled: boolean;
  sync_url?: string;
}

// ============================================================================
// License
// ============================================================================

export interface LicenseInfo {
  id: number;
  installation_id: string;
  token: string; // Masked in responses
  label: string;
  is_active: boolean;
  created_at: string;
  last_seen?: string;
  auto_rotate_enabled: boolean;
  next_rotation?: string;
}

// ============================================================================
// Audit Log
// ============================================================================

export interface AuditLogEntry {
  id: number;
  action: string;
  entity_type?: string;
  entity_id?: number;
  user?: string;
  ip_address?: string;
  details?: Record<string, unknown>;
  created_at: string;
}
