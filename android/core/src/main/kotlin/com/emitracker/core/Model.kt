package com.emitracker.core

import kotlinx.serialization.Serializable

/*
 * Domain model — field for field identical to the desktop app (src/shared/types.ts), because
 * these records are also the portable snapshot format used for backups, sync and export.
 * Enumerations are kept as strings with the same values. Money is a 2-decimal string,
 * dates are ISO civil dates, timestamps ISO-8601 UTC.
 */

val FREQUENCY_PERIODS = mapOf("monthly" to 12, "quarterly" to 4, "half_yearly" to 2, "yearly" to 1, "fortnightly" to 26, "weekly" to 52)
val PERIOD_MONTHS = mapOf("monthly" to 1, "quarterly" to 3, "half_yearly" to 6, "yearly" to 12)
val INSTALLMENT_PAYMENT_TYPES = setOf("emi", "partial", "advance")
val MARKER_TYPES = setOf("missed", "waiver")
val LOAN_TYPES = listOf("home", "personal", "vehicle", "education", "gold", "business", "consumer_durable", "credit_card", "loan_against_property", "chit_fund", "other")
val PAYMENT_TYPES = listOf("emi", "partial", "advance", "prepayment", "foreclosure", "fee", "penalty", "missed", "waiver")

@Serializable
data class Loan(
    val id: String,
    val createdAt: String,
    val updatedAt: String,
    val name: String,
    val category: String,
    val lender: String,
    val accountRef: String,
    val maskAccountRef: Boolean,
    val loanType: String,
    val status: String,
    val sanctionDate: String?,
    val startDate: String,
    val firstEmiDate: String,
    val emiDueDay: Int,
    val sanctionedAmount: String,
    val disbursedAmount: String,
    val principal: String,
    val annualRate: String,
    val rateType: String,
    val interestMethod: String,
    val frequency: String,
    val emiAmount: String?,
    val emiRounding: String,
    val totalInstallments: Int,
    val moratoriumPeriods: Int,
    val moratoriumTreatment: String,
    val preEmiInterest: String,
    val processingFee: String,
    val otherCharges: String,
    val lateFee: String,
    val penalRate: String,
    val gracePeriodDays: Int,
    val advanceEmiBalance: String,
    val prepaymentEffect: String,
    val allocationOrder: String,
    val installmentsPaidBeforeTracking: Int,
    val openingOutstanding: String?,
    val trackingStartDate: String,
    val lenderOutstanding: String?,
    val lenderOutstandingDate: String?,
    val reminderEnabled: Boolean,
    val reminderOffsets: List<Int>?,
    val notes: String,
    val color: String,
)

@Serializable
data class Adjustment(
    val id: String,
    val createdAt: String,
    val updatedAt: String,
    val loanId: String,
    val effectiveDate: String,
    val kind: String, // rate | emi | restructure
    val annualRate: String?,
    val emiAmount: String?,
    val remainingInstallments: Int?,
    val recalc: String, // keep_emi | recompute_emi
    val note: String,
)

@Serializable
data class Payment(
    val id: String,
    val createdAt: String,
    val updatedAt: String,
    val loanId: String,
    val txnDate: String,
    val installmentNo: Int?,
    val type: String,
    val amount: String,
    val manualAllocation: Boolean,
    val allocPrincipal: String,
    val allocInterest: String,
    val allocFees: String,
    val allocPenalty: String,
    val reference: String,
    val notes: String,
    val attachmentPath: String,
    val reconciled: Boolean,
    val status: String, // active | reversed
    val reversalReason: String,
    val reversedAt: String?,
)

@Serializable
data class CustomReminder(
    val id: String,
    val createdAt: String,
    val updatedAt: String,
    val title: String,
    val description: String,
    val date: String,
    val time: String,
    val repeat: String, // none | daily | weekly | monthly | yearly
    val loanId: String?,
    val enabled: Boolean,
)

@Serializable
data class NotificationRecord(
    val id: String,
    val createdAt: String,
    val updatedAt: String,
    val key: String,
    val category: String,
    val title: String,
    val body: String,
    val loanId: String?,
    val scheduledFor: String,
    val deliveredAt: String,
    val state: String, // sent | dismissed | snoozed | acted
    val snoozedUntil: String?,
    val channel: String, // native | in_app
    val late: Boolean,
    val deviceId: String,
)

@Serializable
data class AuditEntry(
    val id: String,
    val createdAt: String,
    val updatedAt: String,
    val at: String,
    val entity: String,
    val entityId: String?,
    val action: String,
    val summary: String,
    val before: String?,
    val after: String?,
    val deviceId: String,
)

@Serializable
data class Category(val id: String, val createdAt: String, val updatedAt: String, val name: String, val color: String)

@Serializable
data class Tombstone(val id: String, val table: String, val deletedAt: String)

@Serializable
data class ReminderCategories(
    val emi_upcoming: Boolean = true,
    val emi_due: Boolean = true,
    val emi_overdue: Boolean = true,
    val emi_missed: Boolean = true,
    val loan_closure: Boolean = true,
    val summary_monthly: Boolean = true,
    val summary_weekly: Boolean = false,
    val backup: Boolean = true,
    val custom: Boolean = true,
    val rate_change: Boolean = true,
    val bill: Boolean = true,
    val debt: Boolean = true,
) {
    fun enabled(category: String): Boolean = when (category) {
        "emi_upcoming" -> emi_upcoming; "emi_due" -> emi_due; "emi_overdue" -> emi_overdue; "emi_missed" -> emi_missed
        "loan_closure" -> loan_closure; "summary_monthly" -> summary_monthly; "summary_weekly" -> summary_weekly
        "backup" -> backup; "custom" -> custom; "rate_change" -> rate_change; "bill" -> bill; "debt" -> debt; else -> true
    }
}

@Serializable
data class Channels(val native: Boolean = true, val inApp: Boolean = true)

@Serializable
data class ReminderSettings(
    val enabled: Boolean = true,
    val categories: ReminderCategories = ReminderCategories(),
    val offsets: List<Int> = listOf(7, 3, 1),
    val time: String = "09:00",
    val overdueRepeatDays: Int = 2,
    val maxRepeats: Int = 5,
    val quietStart: String = "22:00",
    val quietEnd: String = "08:00",
    val quietEnabled: Boolean = true,
    val weekdays: List<Boolean> = List(7) { true },
    val sound: Boolean = true,
    val vibrate: Boolean = true,
    val snoozeMinutes: Int = 60,
    val priority: String = "high",
    val channels: Channels = Channels(),
    val closureLeadDays: Int = 30,
    val backupIntervalDays: Int = 7,
    val weeklySummaryDay: Int = 1,
    val catchUpDays: Int = 3,
)

@Serializable
data class WidgetPref(val id: String, val visible: Boolean)

val DASHBOARD_WIDGETS = listOf(
    "summary" to "Financial summary", "due" to "Due & overdue", "breakdown" to "Principal vs interest", "paidRemaining" to "Paid vs remaining",
    "progress" to "Loan-wise progress", "monthly" to "Monthly payment history", "actualVsScheduled" to "Actual vs scheduled",
    "interestTrend" to "Interest paid over time", "timeline" to "Loan closure timeline", "calendar" to "Upcoming payment calendar",
    "distribution" to "Payment distribution by year", "heatmap" to "Repayment heatmap",
)

@Serializable
data class Preferences(
    val currency: String = "INR",
    val locale: String = "en-IN",
    val decimals: Int = 2,
    val dateFormat: String = "DD MMM YYYY",
    val weekStart: Int = 1,
    val timeZone: String = "",
    val theme: String = "dark",
    val accent: String = "#4f8cff",
    val heatmapPalette: String = "emerald",
    val heatmapThresholds: List<Long> = listOf(0, 5000, 25000, 75000),
    val dashboardWidgets: List<WidgetPref> = DASHBOARD_WIDGETS.map { WidgetPref(it.first, true) },
    val dashboardRange: String = "12m",
    val loanSort: String = "next_due",
    val loanFilter: String = "active",
    val reminders: ReminderSettings = ReminderSettings(),
)

@Serializable
data class StampedPreferences(val value: Preferences, val updatedAt: String)

@Serializable
data class SnapshotData(
    val loans: List<Loan> = emptyList(),
    val adjustments: List<Adjustment> = emptyList(),
    val payments: List<Payment> = emptyList(),
    val customReminders: List<CustomReminder> = emptyList(),
    val notifications: List<NotificationRecord> = emptyList(),
    val audit: List<AuditEntry> = emptyList(),
    val categories: List<Category> = emptyList(),
    val bills: List<Bill> = emptyList(),
    val billPayments: List<BillPayment> = emptyList(),
    val debts: List<Debt> = emptyList(),
    val debtRepayments: List<DebtRepayment> = emptyList(),
    val tombstones: List<Tombstone> = emptyList(),
    val preferences: StampedPreferences = StampedPreferences(Preferences(), "1970-01-01T00:00:00.000Z"),
)

@Serializable
data class AppInfo(val name: String, val version: String, val platform: String)

@Serializable
data class Snapshot(
    val format: String,
    val formatVersion: Int,
    val schemaVersion: Int,
    val kind: String,
    val createdAt: String,
    val app: AppInfo,
    val deviceId: String,
    val deviceName: String,
    val counts: Map<String, Int>,
    val checksum: String,
    val data: SnapshotData,
)

@Serializable
data class EncryptedEnvelope(
    val format: String,
    val formatVersion: Int,
    val kdf: String,
    val iterations: Int,
    val salt: String,
    val iv: String,
    val cipher: String,
    val ciphertext: String,
    val createdAt: String,
    val kind: String,
)

const val SNAPSHOT_FORMAT = "emi-tracker-snapshot"
const val ENCRYPTED_FORMAT = "emi-tracker-encrypted"
const val SNAPSHOT_FORMAT_VERSION = 1
/** Must equal the desktop SCHEMA_VERSION so either app accepts the other's files. */
const val SCHEMA_VERSION = 4
