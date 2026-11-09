/**
 * Input validation (zod). Used at the IPC trust boundary in the main process, by the
 * renderer forms, and to validate backup / sync snapshots before they are applied.
 */
import { z } from 'zod';
import { isValidISODate } from './dates';
import { isMoneyString } from './money';
import { BILL_FREQUENCIES, REMINDER_CATEGORIES, SNAPSHOT_FORMAT } from './types';

const id = z.string().min(1).max(100);
const ts = z.string().min(10).max(40);
const isoDate = z.string().refine(isValidISODate, 'Enter a valid date');
// validators never transform values: restored and synced records must round-trip byte-for-byte
const money = (label = 'Amount') => z.string().refine(isMoneyString, `${label} must be a number with up to 2 decimals`);
const nonNegMoney = (label = 'Amount') => money(label).refine((s) => +s >= 0, `${label} cannot be negative`);
const rate = z.string().refine((s) => /^\d{1,3}(\.\d{1,4})?$/.test(s) && +s <= 100, 'Rate must be between 0 and 100 with up to 4 decimals');
const text = (max: number) => z.string().max(max);
const required = (max: number, message: string) => z.string().max(max).refine((v) => v.trim().length > 0, message);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

const meta = { id, createdAt: ts, updatedAt: ts };

export const loanSchema = z.object({
  ...meta,
  name: required(80, 'Loan name is required'),
  category: text(60),
  lender: text(80),
  accountRef: text(60),
  maskAccountRef: z.boolean(),
  loanType: z.enum(['home', 'personal', 'vehicle', 'education', 'gold', 'business', 'consumer_durable', 'credit_card', 'loan_against_property', 'chit_fund', 'other']),
  status: z.enum(['active', 'closed', 'foreclosed', 'archived']),
  sanctionDate: isoDate.nullable(),
  startDate: isoDate,
  firstEmiDate: isoDate,
  emiDueDay: z.number().int().min(1).max(31),
  sanctionedAmount: nonNegMoney('Sanctioned amount'),
  disbursedAmount: nonNegMoney('Disbursed amount'),
  principal: money('Principal').refine((s) => +s > 0, 'Principal must be greater than zero'),
  annualRate: rate,
  rateType: z.enum(['fixed', 'floating']),
  interestMethod: z.enum(['reducing_monthly', 'reducing_daily', 'flat']),
  frequency: z.enum(['monthly', 'quarterly', 'half_yearly', 'yearly', 'fortnightly', 'weekly']),
  emiAmount: nonNegMoney('EMI').nullable(),
  emiRounding: z.enum(['paisa', 'rupee_nearest', 'rupee_up']),
  totalInstallments: z.number().int().min(1, 'At least one installment').max(1200),
  moratoriumPeriods: z.number().int().min(0).max(120),
  moratoriumTreatment: z.enum(['capitalize', 'interest_only']),
  preEmiInterest: nonNegMoney('Pre-EMI interest'),
  processingFee: nonNegMoney('Processing fee'),
  otherCharges: nonNegMoney('Other charges'),
  lateFee: nonNegMoney('Late fee'),
  penalRate: rate,
  gracePeriodDays: z.number().int().min(0).max(90),
  advanceEmiBalance: nonNegMoney('Advance EMI balance'),
  prepaymentEffect: z.enum(['reduce_tenure', 'reduce_emi']),
  allocationOrder: z.enum(['interest_principal_fees', 'fees_interest_principal']),
  installmentsPaidBeforeTracking: z.number().int().min(0).max(1200),
  openingOutstanding: nonNegMoney('Opening outstanding').nullable(),
  trackingStartDate: isoDate,
  lenderOutstanding: nonNegMoney('Lender outstanding').nullable(),
  lenderOutstandingDate: isoDate.nullable(),
  reminderEnabled: z.boolean(),
  reminderOffsets: z.array(z.number().int().min(0).max(60)).max(10).nullable(),
  notes: text(4000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
}).superRefine((l, ctx) => {
  // a chit's first installment is due the day it starts; a loan's first EMI comes after disbursement
  if (l.loanType === 'chit_fund' ? l.firstEmiDate < l.startDate : l.firstEmiDate <= l.startDate) ctx.addIssue({ code: 'custom', path: ['firstEmiDate'], message: 'First EMI date must be after the loan start date' });
  if (l.sanctionDate && l.sanctionDate > l.startDate) ctx.addIssue({ code: 'custom', path: ['sanctionDate'], message: 'Sanction date cannot be after the start date' });
  if (+l.disbursedAmount > 0 && +l.sanctionedAmount > 0 && +l.disbursedAmount > +l.sanctionedAmount) ctx.addIssue({ code: 'custom', path: ['disbursedAmount'], message: 'Disbursed amount exceeds the sanctioned amount' });
  if (l.installmentsPaidBeforeTracking > l.totalInstallments) ctx.addIssue({ code: 'custom', path: ['installmentsPaidBeforeTracking'], message: 'Cannot exceed total installments' });
  if ((l.lenderOutstanding === null) !== (l.lenderOutstandingDate === null)) ctx.addIssue({ code: 'custom', path: ['lenderOutstandingDate'], message: 'Lender balance needs both an amount and a date' });
});

export const adjustmentSchema = z.object({
  ...meta,
  loanId: id,
  effectiveDate: isoDate,
  kind: z.enum(['rate', 'emi', 'restructure']),
  annualRate: rate.nullable(),
  emiAmount: nonNegMoney('EMI').nullable(),
  remainingInstallments: z.number().int().min(1).max(1200).nullable(),
  recalc: z.enum(['keep_emi', 'recompute_emi']),
  note: text(1000),
}).superRefine((a, ctx) => {
  if (a.kind === 'rate' && !a.annualRate) ctx.addIssue({ code: 'custom', path: ['annualRate'], message: 'Enter the new rate' });
  if (a.kind === 'emi' && !(a.emiAmount && +a.emiAmount > 0)) ctx.addIssue({ code: 'custom', path: ['emiAmount'], message: 'Enter the new EMI' });
  if (a.kind === 'restructure' && !a.annualRate && !a.remainingInstallments && !a.emiAmount) ctx.addIssue({ code: 'custom', path: ['kind'], message: 'Restructure needs a new rate, EMI or tenure' });
});

export const paymentSchema = z.object({
  ...meta,
  loanId: id,
  txnDate: isoDate,
  installmentNo: z.number().int().min(1).max(5000).nullable(),
  type: z.enum(['emi', 'partial', 'advance', 'prepayment', 'foreclosure', 'fee', 'penalty', 'missed', 'waiver']),
  amount: nonNegMoney(),
  manualAllocation: z.boolean(),
  allocPrincipal: nonNegMoney('Principal'),
  allocInterest: nonNegMoney('Interest'),
  allocFees: nonNegMoney('Fees'),
  allocPenalty: nonNegMoney('Penalty'),
  reference: text(120),
  notes: text(2000),
  attachmentPath: text(1000),
  reconciled: z.boolean(),
  status: z.enum(['active', 'reversed']),
  reversalReason: text(500),
  reversedAt: ts.nullable(),
}).superRefine((p, ctx) => {
  const needsInst = ['emi', 'partial', 'advance', 'missed', 'waiver'].includes(p.type);
  if (needsInst && p.installmentNo == null) ctx.addIssue({ code: 'custom', path: ['installmentNo'], message: 'Choose the installment' });
  const marker = p.type === 'missed' || p.type === 'waiver';
  if (!marker && +p.amount <= 0) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Amount must be greater than zero' });
  if (marker && +p.amount !== 0) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Markers carry no amount' });
  if (p.manualAllocation) {
    const total = +p.allocPrincipal + +p.allocInterest + +p.allocFees + +p.allocPenalty;
    if (total - +p.amount > 0.004) ctx.addIssue({ code: 'custom', path: ['allocPrincipal'], message: 'Allocation exceeds the payment amount' });
  }
});

export const customReminderSchema = z.object({
  ...meta,
  title: required(120, 'Title is required'),
  description: text(1000),
  date: isoDate,
  time,
  repeat: z.enum(['none', 'daily', 'weekly', 'monthly', 'yearly']),
  loanId: id.nullable(),
  enabled: z.boolean(),
});

export const billSchema = z.object({
  ...meta,
  name: required(120, 'Bill name is required'),
  category: z.enum(['rent', 'electricity', 'water', 'gas', 'mobile', 'internet', 'tv', 'insurance', 'subscription', 'education', 'maintenance', 'credit_card', 'other']),
  payee: text(120),
  amount: money('Amount').refine((s) => +s > 0, 'Amount must be more than 0'),
  variable: z.boolean(),
  frequency: z.enum(BILL_FREQUENCIES),
  dueDay: z.number().int().min(1).max(31),
  startDate: isoDate,
  endDate: isoDate.nullable(),
  active: z.boolean(),
  reminderEnabled: z.boolean(),
  reminderOffsets: z.array(z.number().int().min(0).max(60)).max(10).nullable(),
  notes: text(2000),
}).superRefine((b, ctx) => {
  if (b.endDate && b.endDate < b.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Last due date must be after the first' });
});

export const billPaymentSchema = z.object({
  ...meta,
  billId: id,
  dueDate: isoDate,
  paidDate: isoDate,
  amount: money('Amount').refine((s) => +s >= 0, 'Amount cannot be negative'),
  notes: text(1000),
});

export const categorySchema = z.object({ ...meta, name: required(60, 'Name is required'), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) });

const reminderCategories = z.object({
  emi_upcoming: z.boolean(), emi_due: z.boolean(), emi_overdue: z.boolean(), emi_missed: z.boolean(), loan_closure: z.boolean(),
  summary_monthly: z.boolean(), summary_weekly: z.boolean(), backup: z.boolean(), custom: z.boolean(), rate_change: z.boolean(),
  bill: z.boolean().default(true),
  debt: z.boolean().default(true),
});

export const reminderSettingsSchema = z.object({
  enabled: z.boolean(),
  categories: reminderCategories,
  offsets: z.array(z.number().int().min(0).max(60)).max(10),
  time,
  overdueRepeatDays: z.number().int().min(1).max(30),
  maxRepeats: z.number().int().min(1).max(30),
  quietStart: time,
  quietEnd: time,
  quietEnabled: z.boolean(),
  weekdays: z.array(z.boolean()).length(7),
  sound: z.boolean(),
  vibrate: z.boolean(),
  snoozeMinutes: z.number().int().min(5).max(10080),
  priority: z.enum(['low', 'normal', 'high']),
  channels: z.object({ native: z.boolean(), inApp: z.boolean() }),
  closureLeadDays: z.number().int().min(1).max(365),
  backupIntervalDays: z.number().int().min(1).max(365),
  weeklySummaryDay: z.number().int().min(0).max(6),
  catchUpDays: z.number().int().min(0).max(30),
});

export const preferencesSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  locale: z.string().min(2).max(20),
  decimals: z.number().int().min(0).max(2),
  dateFormat: z.enum(['DD MMM YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']),
  weekStart: z.union([z.literal(0), z.literal(1)]),
  timeZone: z.string().max(60),
  theme: z.enum(['system', 'dark', 'light']),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  heatmapPalette: z.enum(['emerald', 'blue', 'violet', 'amber', 'rose']),
  heatmapThresholds: z.array(z.number().int().min(0)).length(4), // integers: identical JSON on desktop and Android
  dashboardWidgets: z.array(z.object({ id: z.string().max(40), visible: z.boolean() })).max(40),
  dashboardRange: z.enum(['3m', '6m', '12m', 'ytd', 'all']),
  loanSort: z.enum(['name', 'outstanding', 'closure', 'rate', 'next_due']),
  loanFilter: z.enum(['all', 'active', 'closed', 'archived']),
  reminders: reminderSettingsSchema,
});

export const notificationSchema = z.object({
  ...meta,
  key: z.string().max(300),
  category: z.enum(REMINDER_CATEGORIES),
  title: text(300),
  body: text(2000),
  loanId: id.nullable(),
  scheduledFor: z.string().max(40),
  deliveredAt: z.string().max(40),
  state: z.enum(['sent', 'dismissed', 'snoozed', 'acted']),
  snoozedUntil: z.string().max(40).nullable(),
  channel: z.enum(['native', 'in_app']),
  late: z.boolean(),
  deviceId: z.string().max(100),
});

export const auditSchema = z.object({
  ...meta,
  at: ts,
  entity: z.enum(['loan', 'payment', 'adjustment', 'settings', 'reminder', 'bill', 'debt', 'backup', 'sync', 'system']),
  entityId: z.string().max(100).nullable(),
  action: z.string().max(60),
  summary: text(1000),
  before: z.string().max(200000).nullable(),
  after: z.string().max(200000).nullable(),
  deviceId: z.string().max(100),
});

export const debtSchema = z.object({
  ...meta,
  direction: z.enum(['lent', 'borrowed']),
  person: required(120, 'Enter who it is'),
  amount: money('Amount').refine((s) => +s > 0, 'Amount must be more than 0'),
  date: isoDate,
  dueDate: isoDate.nullable(),
  reminderEnabled: z.boolean(),
  notes: text(2000),
}).superRefine((d, ctx) => {
  if (d.dueDate && d.dueDate < d.date) ctx.addIssue({ code: 'custom', path: ['dueDate'], message: 'Return date must be on or after the date given' });
});

export const debtRepaymentSchema = z.object({
  ...meta,
  debtId: id,
  date: isoDate,
  amount: money('Amount').refine((s) => +s > 0, 'Amount must be more than 0'),
  notes: text(500),
});

export const tombstoneSchema = z.object({
  id,
  table: z.enum(['loans', 'adjustments', 'payments', 'customReminders', 'notifications', 'audit', 'categories', 'bills', 'billPayments', 'debts', 'debtRepayments']),
  deletedAt: ts,
});

export const snapshotDataSchema = z.object({
  loans: z.array(loanSchema),
  adjustments: z.array(adjustmentSchema),
  payments: z.array(paymentSchema),
  customReminders: z.array(customReminderSchema),
  notifications: z.array(notificationSchema),
  audit: z.array(auditSchema),
  categories: z.array(categorySchema),
  bills: z.array(billSchema).default([]), // absent in backups made before bills existed
  billPayments: z.array(billPaymentSchema).default([]),
  debts: z.array(debtSchema).default([]), // absent in backups made before lending / borrowing existed
  debtRepayments: z.array(debtRepaymentSchema).default([]),
  tombstones: z.array(tombstoneSchema),
  preferences: z.object({ value: preferencesSchema, updatedAt: ts }),
});

export const snapshotSchema = z.object({
  format: z.literal(SNAPSHOT_FORMAT),
  formatVersion: z.number().int().min(1),
  schemaVersion: z.number().int().min(1),
  kind: z.enum(['backup', 'sync', 'export', 'recovery']),
  createdAt: ts,
  app: z.object({ name: z.string(), version: z.string(), platform: z.enum(['desktop', 'android']) }),
  deviceId: z.string().max(100),
  deviceName: z.string().max(200),
  counts: z.record(z.string(), z.number()),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
  data: snapshotDataSchema,
});

export function firstError(err: z.ZodError): string {
  const i = err.issues[0];
  return i ? `${i.path.join('.') || 'value'}: ${i.message}` : 'Invalid input';
}

export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = i.path.join('.');
    if (!out[k]) out[k] = i.message;
  }
  return out;
}
