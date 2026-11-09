/**
 * Domain model. This is also the record shape of the portable snapshot format used for
 * backups, sync files and JSON export — identical on desktop and Android
 * (see docs/BACKUP_AND_RESTORE.md). Money is always a 2-decimal string; dates are ISO
 * civil dates; timestamps are ISO-8601 UTC instants.
 */
import type { ISODate } from './dates';
import type { EmiRounding } from './money';

export type Money = string;
export type Timestamp = string;

export type Frequency = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly' | 'fortnightly' | 'weekly';
export type InterestMethod = 'reducing_monthly' | 'reducing_daily' | 'flat';
export type MoratoriumTreatment = 'capitalize' | 'interest_only';
export type PrepaymentEffect = 'reduce_tenure' | 'reduce_emi';
export type AllocationOrder = 'interest_principal_fees' | 'fees_interest_principal';
export type LoanStatus = 'active' | 'closed' | 'foreclosed' | 'archived';
export type LoanType =
  | 'home' | 'personal' | 'vehicle' | 'education' | 'gold' | 'business'
  | 'consumer_durable' | 'credit_card' | 'loan_against_property' | 'chit_fund' | 'other';

export const FREQUENCY_PERIODS: Record<Frequency, number> = {
  monthly: 12, quarterly: 4, half_yearly: 2, yearly: 1, fortnightly: 26, weekly: 52,
};

/** Fields every synced record carries. */
export interface SyncMeta {
  id: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Loan extends SyncMeta {
  name: string;
  category: string;
  lender: string;
  accountRef: string;
  maskAccountRef: boolean;
  loanType: LoanType;
  status: LoanStatus;
  sanctionDate: ISODate | null;
  startDate: ISODate; // disbursement / interest start
  firstEmiDate: ISODate;
  emiDueDay: number; // 1..31, clamped to month length
  sanctionedAmount: Money;
  disbursedAmount: Money;
  principal: Money; // amount the amortization is based on
  annualRate: string; // percent per annum, e.g. "8.50"
  rateType: 'fixed' | 'floating';
  interestMethod: InterestMethod;
  frequency: Frequency;
  emiAmount: Money | null; // null => calculated
  emiRounding: EmiRounding;
  totalInstallments: number; // EMI installments, excluding moratorium periods
  moratoriumPeriods: number;
  moratoriumTreatment: MoratoriumTreatment;
  preEmiInterest: Money; // broken-period / pre-EMI interest already paid
  processingFee: Money;
  otherCharges: Money;
  lateFee: Money; // flat charge per late installment (estimate)
  penalRate: string; // % p.a. on overdue amount (estimate)
  gracePeriodDays: number;
  advanceEmiBalance: Money;
  prepaymentEffect: PrepaymentEffect;
  allocationOrder: AllocationOrder;
  installmentsPaidBeforeTracking: number;
  openingOutstanding: Money | null; // lender-stated principal after pre-tracking installments
  trackingStartDate: ISODate;
  lenderOutstanding: Money | null; // for reconciliation
  lenderOutstandingDate: ISODate | null;
  reminderEnabled: boolean;
  reminderOffsets: number[] | null; // null => global default
  notes: string;
  color: string;
}

export type AdjustmentKind = 'rate' | 'emi' | 'restructure';
export interface Adjustment extends SyncMeta {
  loanId: string;
  effectiveDate: ISODate;
  kind: AdjustmentKind;
  annualRate: string | null;
  emiAmount: Money | null;
  remainingInstallments: number | null;
  recalc: 'keep_emi' | 'recompute_emi';
  note: string;
}

export type PaymentType =
  | 'emi' | 'partial' | 'advance' // applied to a specific installment
  | 'prepayment' | 'foreclosure' | 'fee' | 'penalty' // applied on the transaction date
  | 'missed' | 'waiver'; // zero-amount markers for an installment

export const INSTALLMENT_PAYMENT_TYPES: PaymentType[] = ['emi', 'partial', 'advance'];
export const MARKER_TYPES: PaymentType[] = ['missed', 'waiver'];
export const EVENT_PAYMENT_TYPES: PaymentType[] = ['prepayment', 'foreclosure', 'fee', 'penalty'];

export interface Payment extends SyncMeta {
  loanId: string;
  txnDate: ISODate;
  installmentNo: number | null; // schedule row number (moratorium rows included)
  type: PaymentType;
  amount: Money;
  manualAllocation: boolean;
  allocPrincipal: Money;
  allocInterest: Money;
  allocFees: Money;
  allocPenalty: Money;
  reference: string;
  notes: string;
  attachmentPath: string;
  reconciled: boolean;
  status: 'active' | 'reversed';
  reversalReason: string;
  reversedAt: Timestamp | null;
}

/** 'once' is a one-time expense: a single due date (the start date), no repeats. */
export const BILL_FREQUENCIES = ['monthly', 'bimonthly', 'quarterly', 'half_yearly', 'yearly', 'once'] as const;
export type BillFrequency = (typeof BILL_FREQUENCIES)[number];
/** Months between due dates; 0 for a one-time expense. */
export const BILL_FREQUENCY_MONTHS: Record<BillFrequency, number> = { monthly: 1, bimonthly: 2, quarterly: 3, half_yearly: 6, yearly: 12, once: 0 };
export type BillCategory =
  | 'rent' | 'electricity' | 'water' | 'gas' | 'mobile' | 'internet' | 'tv' | 'insurance' | 'subscription'
  | 'education' | 'maintenance' | 'credit_card' | 'other';

/** A recurring bill (rent, electricity, phone…). Counts towards monthly expenses. */
export interface Bill extends SyncMeta {
  name: string;
  category: BillCategory;
  payee: string;
  amount: Money; // usual amount; for variable bills the expected amount
  variable: boolean; // amount changes every time (electricity, water)
  frequency: BillFrequency;
  dueDay: number; // 1..31, clamped to month length
  startDate: ISODate; // first due date
  endDate: ISODate | null; // last due date (optional)
  active: boolean;
  reminderEnabled: boolean;
  reminderOffsets: number[] | null; // null => global default
  notes: string;
}

/** One bill paid for one due date. */
export interface BillPayment extends SyncMeta {
  billId: string;
  dueDate: ISODate; // the occurrence this pays
  paidDate: ISODate;
  amount: Money;
  notes: string;
}

/** Money lent to someone or borrowed from someone. No interest; settled when repayments reach the amount. */
export interface Debt extends SyncMeta {
  direction: 'lent' | 'borrowed';
  person: string;
  amount: Money;
  date: ISODate; // when the money changed hands
  dueDate: ISODate | null; // when it should be returned (optional)
  reminderEnabled: boolean; // remind the day before, on and after the due date while money is pending
  notes: string;
}

/** Part or all of a debt returned (to you for money lent, by you for money borrowed). */
export interface DebtRepayment extends SyncMeta {
  debtId: string;
  date: ISODate;
  amount: Money;
  notes: string;
}

export type ReminderRepeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export interface CustomReminder extends SyncMeta {
  title: string;
  description: string;
  date: ISODate;
  time: string; // HH:MM
  repeat: ReminderRepeat;
  loanId: string | null;
  enabled: boolean;
}

export type NotificationState = 'sent' | 'dismissed' | 'snoozed' | 'acted';
export interface NotificationRecord extends SyncMeta {
  key: string; // dedupe key
  category: ReminderCategory;
  title: string;
  body: string;
  loanId: string | null;
  scheduledFor: Timestamp;
  deliveredAt: Timestamp;
  state: NotificationState;
  snoozedUntil: Timestamp | null;
  channel: 'native' | 'in_app';
  late: boolean; // delivered after its scheduled time (app was closed / device asleep)
  deviceId: string;
}

export interface AuditEntry extends SyncMeta {
  at: Timestamp;
  entity: 'loan' | 'payment' | 'adjustment' | 'settings' | 'reminder' | 'bill' | 'debt' | 'backup' | 'sync' | 'system';
  entityId: string | null;
  action: string;
  summary: string; // human readable, never contains secrets
  before: string | null; // JSON
  after: string | null; // JSON
  deviceId: string;
}

export interface Category extends SyncMeta {
  name: string;
  color: string;
}

export interface Tombstone {
  id: string;
  table: SyncTable;
  deletedAt: Timestamp;
}

export type SyncTable =
  | 'loans' | 'adjustments' | 'payments' | 'customReminders' | 'notifications' | 'audit' | 'categories' | 'bills' | 'billPayments' | 'debts' | 'debtRepayments';

/** Every notification category; backups and sync validate against this same list. */
export const REMINDER_CATEGORIES = [
  'emi_upcoming', 'emi_due', 'emi_overdue', 'emi_missed', 'loan_closure',
  'summary_monthly', 'summary_weekly', 'backup', 'custom', 'rate_change', 'bill', 'debt', 'test',
] as const;
export type ReminderCategory = (typeof REMINDER_CATEGORIES)[number];

export interface ReminderSettings {
  enabled: boolean;
  categories: Record<Exclude<ReminderCategory, 'test'>, boolean>;
  offsets: number[]; // days before due
  time: string; // HH:MM
  overdueRepeatDays: number;
  maxRepeats: number;
  quietStart: string; // HH:MM
  quietEnd: string; // HH:MM
  quietEnabled: boolean;
  weekdays: boolean[]; // index 0 = Sunday
  sound: boolean;
  vibrate: boolean;
  snoozeMinutes: number;
  priority: 'low' | 'normal' | 'high';
  channels: { native: boolean; inApp: boolean };
  closureLeadDays: number;
  backupIntervalDays: number;
  weeklySummaryDay: number; // 0..6
  catchUpDays: number; // deliver missed reminders up to N days late
}

export type Theme = 'system' | 'dark' | 'light';

/** Preferences shared across devices (synced). */
export interface Preferences {
  currency: string;
  locale: string; // en-IN => lakh/crore grouping
  decimals: number;
  dateFormat: 'DD MMM YYYY' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
  weekStart: 0 | 1;
  timeZone: string; // '' => system
  theme: Theme;
  accent: string;
  heatmapPalette: 'emerald' | 'blue' | 'violet' | 'amber' | 'rose';
  heatmapThresholds: number[]; // 4 ascending amounts
  dashboardWidgets: { id: string; visible: boolean }[];
  dashboardRange: '3m' | '6m' | '12m' | 'ytd' | 'all';
  loanSort: 'name' | 'outstanding' | 'closure' | 'rate' | 'next_due';
  loanFilter: 'all' | 'active' | 'closed' | 'archived';
  reminders: ReminderSettings;
}

export const SNAPSHOT_FORMAT = 'emi-tracker-snapshot';
export const ENCRYPTED_FORMAT = 'emi-tracker-encrypted';
export const SNAPSHOT_FORMAT_VERSION = 1;

export interface SnapshotData {
  loans: Loan[];
  adjustments: Adjustment[];
  payments: Payment[];
  customReminders: CustomReminder[];
  notifications: NotificationRecord[];
  audit: AuditEntry[];
  categories: Category[];
  bills: Bill[];
  billPayments: BillPayment[];
  debts: Debt[];
  debtRepayments: DebtRepayment[];
  tombstones: Tombstone[];
  preferences: { value: Preferences; updatedAt: Timestamp };
}

export interface Snapshot {
  format: typeof SNAPSHOT_FORMAT;
  formatVersion: number;
  schemaVersion: number;
  kind: 'backup' | 'sync' | 'export' | 'recovery';
  createdAt: Timestamp;
  app: { name: string; version: string; platform: 'desktop' | 'android' };
  deviceId: string;
  deviceName: string;
  counts: Record<string, number>;
  checksum: string; // sha256 hex of canonical JSON of `data`
  data: SnapshotData;
}

export interface EncryptedEnvelope {
  format: typeof ENCRYPTED_FORMAT;
  formatVersion: number;
  kdf: 'PBKDF2-HMAC-SHA256';
  iterations: number;
  salt: string; // base64
  iv: string; // base64, 12 bytes
  cipher: 'AES-256-GCM';
  ciphertext: string; // base64 (ciphertext || 16-byte tag)
  createdAt: Timestamp;
  kind: Snapshot['kind'];
}
