import type {
  Adjustment, AuditEntry, Bill, BillPayment, Category, Debt, DebtRepayment, CustomReminder, Loan, NotificationRecord, Payment, Preferences,
} from '../../shared/types';

export interface LocalSettings {
  deviceId: string; deviceName: string; backupDir: string; autoBackup: boolean; autoBackupHours: number; backupKeep: number;
  lastBackupAt: string | null; minimizeToTray: boolean; launchAtStartup: boolean; startHidden: boolean; syncEnabled: boolean;
  syncFolder: string; syncIntervalMinutes: number; syncEncrypted: boolean; lastSyncAt: string | null; lastSyncResult: string;
  lanEnabled: boolean; lanPort: number; onboardingDone: boolean;
}

export interface BackupHistoryItem {
  id: string; createdAt: string; kind: string; path: string; size: number; encrypted: boolean; checksum: string;
  counts: Record<string, number>; ok: boolean; message: string;
}

export interface LoadedData {
  loans: Loan[]; adjustments: Adjustment[]; payments: Payment[]; customReminders: CustomReminder[]; notifications: NotificationRecord[];
  categories: Category[]; bills: Bill[]; billPayments: BillPayment[]; debts: Debt[]; debtRepayments: DebtRepayment[]; preferences: Preferences; local: LocalSettings; syncPassphraseSaved: boolean; backupHistory: BackupHistoryItem[];
  app: { name: string; version: string; platform: string }; paths: { data: string; db: string };
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string; code?: string };

declare global {
  interface Window {
    emi: {
      invoke: (channel: string, payload?: unknown) => Promise<Result<unknown>>;
      on: (event: 'notification' | 'data:changed' | 'navigate' | 'lock:changed', cb: (payload: unknown) => void) => () => void;
    };
  }
}

export class ApiError extends Error {
  constructor(message: string, public readonly code?: string) { super(message); }
}

export async function call<T = unknown>(channel: string, payload?: unknown): Promise<T> {
  const r = (await window.emi.invoke(channel, payload)) as Result<T>;
  if (!r.ok) throw new ApiError(r.error, r.code);
  return r.value;
}

export type { AuditEntry };
