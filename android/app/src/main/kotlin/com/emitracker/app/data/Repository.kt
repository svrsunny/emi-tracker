package com.emitracker.app.data

import androidx.room.withTransaction
import com.emitracker.core.Adjustment
import com.emitracker.core.Bill
import com.emitracker.core.BillPayment
import com.emitracker.core.Debt
import com.emitracker.core.DebtRepayment
import com.emitracker.core.AuditEntry
import com.emitracker.core.Category
import com.emitracker.core.CustomReminder
import com.emitracker.core.Loan
import com.emitracker.core.NotificationRecord
import com.emitracker.core.Payment
import com.emitracker.core.Preferences
import com.emitracker.core.SnapshotCodec
import com.emitracker.core.SnapshotData
import com.emitracker.core.StampedPreferences
import com.emitracker.core.Tombstone
import com.emitracker.core.Validation
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import java.time.Instant
import java.util.UUID

class ValidationException(message: String, val fields: Map<String, String> = emptyMap()) : Exception(message)
class DuplicateException(message: String) : Exception(message)

/** Device-local settings: never synced; mirrors the desktop LocalSettings. */
@Serializable
data class LocalSettings(
    val deviceId: String = "",
    val deviceName: String = "",
    val backupTreeUri: String = "",
    val autoBackup: Boolean = false,
    val autoBackupHours: Int = 24,
    val backupKeep: Int = 30,
    val lastBackupAt: String? = null,
    val syncEnabled: Boolean = false,
    val syncTreeUri: String = "",
    val syncIntervalMinutes: Int = 60,
    val syncEncrypted: Boolean = false,
    val syncSecret: String = "", // Keystore-encrypted passphrase (base64), never plaintext
    val lastSyncAt: String? = null,
    val lastSyncResult: String = "",
    // Wi-Fi sync with a paired Windows PC
    val lanHost: String = "",
    val lanPcName: String = "",
    val lanPcId: String = "",
    val lanKey: String = "", // Keystore-encrypted pairing key (base64), never plaintext
    val lanAuto: Boolean = true,
    val lastLanSyncAt: String? = null,
    val lastLanSyncResult: String = "",
    // app lock (this phone only, never synced)
    val lockMethod: String = "none", // none | device | pin | password
    val lockHash: String = "", // salted PBKDF2 of the PIN / password
    val lockSalt: String = "",
    val lockBiometric: Boolean = false, // also unlock a PIN / password lock with fingerprint / face
    val lockAfterMinutes: Int = 1,
    val lockFailed: Int = 0,
    val lockoutUntil: Long = 0,
    val onboardingDone: Boolean = false,
    val notificationPrompted: Boolean = false,
)

/** Everything the UI renders; replaced atomically after each committed write. */
data class AppData(
    val loans: List<Loan> = emptyList(),
    val adjustments: List<Adjustment> = emptyList(),
    val payments: List<Payment> = emptyList(),
    val customReminders: List<CustomReminder> = emptyList(),
    val notifications: List<NotificationRecord> = emptyList(),
    val categories: List<Category> = emptyList(),
    val bills: List<Bill> = emptyList(),
    val billPayments: List<BillPayment> = emptyList(),
    val debts: List<Debt> = emptyList(),
    val debtRepayments: List<DebtRepayment> = emptyList(),
    val preferences: Preferences = Preferences(),
    val local: LocalSettings = LocalSettings(),
    val loaded: Boolean = false,
)

class Repository(val db: AppDatabase) {
    private val dao = db.dao()
    private val json = SnapshotCodec.json
    private val _state = MutableStateFlow(AppData())
    val state: StateFlow<AppData> = _state

    private fun now() = Instant.now().toString()
    private fun newId() = UUID.randomUUID().toString()

    // ------------------------------------------------------------------ reads
    suspend fun refresh() = withContext(Dispatchers.IO) {
        _state.value = AppData(loans(), adjustments(), payments(), reminders(), notifications(1000), categories(), bills(), billPayments(), debts(), debtRepayments(), preferences().value, local(), true)
    }

    fun loans(): List<Loan> = dao.loans().map { json.decodeFromString<Loan>(it) }
    fun adjustments(): List<Adjustment> = dao.adjustments().map { json.decodeFromString<Adjustment>(it) }
    fun payments(): List<Payment> = dao.payments().map { json.decodeFromString<Payment>(it) }
    fun reminders(): List<CustomReminder> = dao.reminders().map { json.decodeFromString<CustomReminder>(it) }
    fun notifications(limit: Int = 100_000): List<NotificationRecord> = dao.notifications(limit).map { json.decodeFromString<NotificationRecord>(it) }
    fun audit(limit: Int = 1_000_000): List<AuditEntry> = dao.audit(limit).map { json.decodeFromString<AuditEntry>(it) }
    fun categories(): List<Category> = dao.categories().map { json.decodeFromString<Category>(it) }
    fun bills(): List<Bill> = dao.bills().map { json.decodeFromString<Bill>(it) }
    fun billPayments(): List<BillPayment> = dao.billPayments().map { json.decodeFromString<BillPayment>(it) }
    fun debts(): List<Debt> = dao.debts().map { json.decodeFromString<Debt>(it) }
    fun debtRepayments(): List<DebtRepayment> = dao.debtRepayments().map { json.decodeFromString<DebtRepayment>(it) }
    fun tombstones(): List<Tombstone> = dao.tombstones().map { Tombstone(it.id, it.tbl, it.deletedAt) }
    fun notificationByKey(key: String): NotificationRecord? = dao.notificationByKey(key)?.let { json.decodeFromString<NotificationRecord>(it) }
    fun backupHistory(limit: Int = 200) = dao.backupHistory(limit)

    fun preferences(): StampedPreferences {
        val kv = dao.kv("preferences") ?: return StampedPreferences(Preferences(), "1970-01-01T00:00:00.000Z")
        return StampedPreferences(runCatching { json.decodeFromString<Preferences>(kv.value) }.getOrDefault(Preferences()), kv.updatedAt)
    }

    fun local(): LocalSettings = dao.kv("local")?.let { runCatching { json.decodeFromString<LocalSettings>(it.value) }.getOrNull() } ?: LocalSettings()

    fun snapshotData() = SnapshotData(loans = loans(), adjustments = adjustments(), payments = payments(), customReminders = reminders(), notifications = notifications(),
        audit = audit(), categories = categories(), bills = bills(), billPayments = billPayments(), debts = debts(), debtRepayments = debtRepayments(), tombstones = tombstones(), preferences = preferences())

    // ------------------------------------------------------------------ writes
    private suspend fun <T> tx(block: () -> T): T {
        val r = withContext(Dispatchers.IO) { db.withTransaction { block() } }
        refresh()
        return r
    }

    suspend fun setLocal(update: (LocalSettings) -> LocalSettings): LocalSettings = tx {
        val next = update(local())
        dao.putKv(KvEntity("local", json.encodeToString(next), now()))
        next
    }

    suspend fun setPreferences(p: Preferences): Preferences {
        Validation.preferences(p).entries.firstOrNull()?.let { throw ValidationException(it.value, mapOf(it.key to it.value)) }
        return tx {
            dao.putKv(KvEntity("preferences", json.encodeToString(p), now()))
            audit("settings", null, "update", "Updated preferences", null, null)
            p
        }
    }

    suspend fun saveLoan(input: Loan): Loan {
        val loan = input.copy(updatedAt = now())
        Validation.loan(loan).let { if (it.isNotEmpty()) throw ValidationException(it.values.first(), it) }
        return tx {
            val before = dao.loans().map { json.decodeFromString<Loan>(it) }.firstOrNull { it.id == loan.id }
            putLoan(loan)
            audit("loan", loan.id, if (before == null) "create" else "update",
                if (before == null) "Created loan “${loan.name}”" else "Updated loan “${loan.name}”${changed(before, loan)}",
                before?.let { json.encodeToString(it) }, json.encodeToString(loan))
            loan
        }
    }

    suspend fun setLoanStatus(id: String, status: String) {
        val l = loans().firstOrNull { it.id == id } ?: throw ValidationException("Loan not found")
        saveLoan(l.copy(status = status))
    }

    /** Permanent deletion (after a recovery backup by the caller); leaves tombstones for sync. */
    suspend fun deleteLoanPermanently(id: String, confirmName: String) {
        val loan = loans().firstOrNull { it.id == id } ?: throw ValidationException("Loan not found")
        if (confirmName.trim() != loan.name.trim()) throw ValidationException("Type the loan name exactly to confirm deletion")
        tx {
            val ts = now()
            val pays = dao.paymentIds(id)
            val adjs = dao.adjustmentIds(id)
            pays.forEach { dao.putTombstone(TombstoneEntity(it, "payments", ts)) }
            adjs.forEach { dao.putTombstone(TombstoneEntity(it, "adjustments", ts)) }
            dao.deletePaymentsOf(id); dao.deleteAdjustmentsOf(id); dao.deleteLoan(id)
            dao.putTombstone(TombstoneEntity(id, "loans", ts))
            audit("loan", id, "delete", "Permanently deleted loan “${loan.name}” with ${pays.size} payment(s) and ${adjs.size} adjustment(s)", json.encodeToString(loan), null)
        }
    }

    fun findDuplicates(p: Payment): List<Payment> = payments().filter { x ->
        x.id != p.id && x.status == "active" && x.loanId == p.loanId && x.type == p.type && x.amount == p.amount &&
            (x.txnDate == p.txnDate || (p.installmentNo != null && x.installmentNo == p.installmentNo && p.type in setOf("emi", "advance")))
    }

    suspend fun savePayment(input: Payment, allowDuplicate: Boolean = false): Payment {
        val p = input.copy(updatedAt = now())
        Validation.payment(p).let { if (it.isNotEmpty()) throw ValidationException(it.values.first(), it) }
        if (loans().none { it.id == p.loanId }) throw ValidationException("Loan not found")
        val before = payments().firstOrNull { it.id == p.id }
        if (before?.status == "reversed") throw ValidationException("A reversed payment cannot be edited; record a new payment instead")
        if (before == null && !allowDuplicate) findDuplicates(p).firstOrNull()?.let {
            throw DuplicateException("A ${p.type} payment of ${p.amount} on ${it.txnDate} already exists for this loan")
        }
        return tx {
            putPayment(p)
            audit("payment", p.id, if (before == null) "create" else "update",
                if (before == null) "Recorded ${p.type} payment ${p.amount} on ${p.txnDate}" else "Edited ${p.type} payment ${p.amount} (${p.txnDate})${changed(before, p)}",
                before?.let { json.encodeToString(it) }, json.encodeToString(p))
            p
        }
    }

    suspend fun reversePayment(id: String, reason: String): Payment {
        val p = payments().firstOrNull { it.id == id } ?: throw ValidationException("Payment not found")
        if (p.status == "reversed") throw ValidationException("Payment is already reversed")
        if (reason.isBlank()) throw ValidationException("Give a reason for the reversal")
        val next = p.copy(status = "reversed", reversalReason = reason.trim(), reversedAt = now(), updatedAt = now())
        return tx {
            putPayment(next)
            audit("payment", id, "reverse", "Reversed ${p.type} payment ${p.amount} (${p.txnDate}): ${reason.trim()}", json.encodeToString(p), json.encodeToString(next))
            next
        }
    }

    suspend fun saveAdjustment(input: Adjustment): Adjustment {
        val a = input.copy(updatedAt = now())
        Validation.adjustment(a).let { if (it.isNotEmpty()) throw ValidationException(it.values.first(), it) }
        if (loans().none { it.id == a.loanId }) throw ValidationException("Loan not found")
        return tx {
            val existed = dao.adjustmentIdList().contains(a.id)
            dao.upsertAdjustment(AdjustmentEntity(a.id, a.loanId, a.effectiveDate, a.updatedAt, json.encodeToString(a)))
            audit("adjustment", a.id, if (existed) "update" else "create", "${if (existed) "Updated" else "Added"} ${a.kind} change effective ${a.effectiveDate}", null, json.encodeToString(a))
            a
        }
    }

    suspend fun deleteAdjustment(id: String) = tx {
        dao.deleteAdjustment(id)
        dao.putTombstone(TombstoneEntity(id, "adjustments", now()))
        audit("adjustment", id, "delete", "Removed a rate / EMI change", null, null)
    }

    suspend fun saveReminder(input: CustomReminder): CustomReminder {
        val r = input.copy(updatedAt = now())
        Validation.reminder(r).let { if (it.isNotEmpty()) throw ValidationException(it.values.first(), it) }
        return tx {
            dao.upsertReminder(ReminderEntity(r.id, r.updatedAt, json.encodeToString(r)))
            audit("reminder", r.id, "save", "Saved reminder “${r.title}”", null, null)
            r
        }
    }

    suspend fun deleteReminder(id: String) = tx {
        dao.deleteReminder(id)
        dao.putTombstone(TombstoneEntity(id, "customReminders", now()))
        audit("reminder", id, "delete", "Deleted a custom reminder", null, null)
    }

    suspend fun saveBill(input: Bill): Bill {
        val b = input.copy(updatedAt = now())
        Validation.bill(b).let { if (it.isNotEmpty()) throw ValidationException(it.values.first(), it) }
        return tx {
            val before = dao.bill(b.id)
            dao.upsertBill(BillEntity(b.id, b.name, b.updatedAt, json.encodeToString(b)))
            // a one-time expense whose date is corrected keeps its payment: it moves to the new date
            val old = before?.let { json.decodeFromString<Bill>(it) }
            if (old != null && b.frequency == "once" && old.startDate != b.startDate) {
                dao.billPaymentIds(b.id).mapNotNull { pid -> dao.billPayment(pid)?.let { json.decodeFromString<BillPayment>(it) } }.forEach { p ->
                    val moved = p.copy(dueDate = b.startDate, updatedAt = b.updatedAt)
                    dao.upsertBillPayment(BillPaymentEntity(moved.id, moved.billId, moved.dueDate, moved.updatedAt, json.encodeToString(moved)))
                }
            }
            audit("bill", b.id, if (before == null) "create" else "update", if (before == null) "Added bill “${b.name}”" else "Updated bill “${b.name}”", null, null)
            b
        }
    }

    /** Deletes a bill and its payment records. */
    suspend fun deleteBill(id: String) = tx {
        val b = dao.bill(id)?.let { json.decodeFromString<Bill>(it) } ?: throw ValidationException("Bill not found")
        val ts = now()
        dao.billPaymentIds(id).forEach { pid -> dao.deleteBillPayment(pid); dao.putTombstone(TombstoneEntity(pid, "billPayments", ts)) }
        dao.deleteBill(id)
        dao.putTombstone(TombstoneEntity(id, "bills", ts))
        audit("bill", id, "delete", "Deleted bill “${b.name}”", null, null)
    }

    /** Records (or corrects) the payment of one bill due date; one payment per due date. */
    suspend fun saveBillPayment(input: BillPayment): BillPayment {
        val p = input.copy(updatedAt = now())
        Validation.billPayment(p).let { if (it.isNotEmpty()) throw ValidationException(it.values.first(), it) }
        return tx {
            val bill = dao.bill(p.billId)?.let { json.decodeFromString<Bill>(it) } ?: throw ValidationException("Bill not found")
            if (dao.billPaymentFor(p.billId, p.dueDate, p.id) != null) throw DuplicateException("${bill.name} is already marked paid for ${p.dueDate}")
            dao.upsertBillPayment(BillPaymentEntity(p.id, p.billId, p.dueDate, p.updatedAt, json.encodeToString(p)))
            audit("bill", p.billId, "pay", "Paid ${bill.name} (due ${p.dueDate}): ${p.amount}", null, null)
            p
        }
    }

    // ------------------------------------------------------------------ lending & borrowing
    private fun repaidCents(debtId: String, exceptId: String?): Long =
        dao.debtRepaymentsFor(debtId).map { json.decodeFromString<DebtRepayment>(it) }.filter { it.id != exceptId }.sumOf { cents(it.amount) }
    private fun cents(amount: String): Long = amount.toBigDecimal().movePointRight(2).setScale(0, java.math.RoundingMode.HALF_UP).toLong()
    private fun rupees(c: Long) = java.math.BigDecimal.valueOf(c, 2).toPlainString()

    suspend fun saveDebt(input: Debt): Debt {
        val d = input.copy(updatedAt = now(), person = input.person.trim())
        Validation.debt(d).let { if (it.isNotEmpty()) throw ValidationException(it.values.first(), it) }
        return tx {
            val repaid = repaidCents(d.id, null)
            if (cents(d.amount) < repaid) throw ValidationException("Amount cannot be less than what was already returned (${rupees(repaid)})")
            val before = dao.debt(d.id)
            val what = if (d.direction == "lent") "Lent to ${d.person}" else "Borrowed from ${d.person}"
            dao.upsertDebt(DebtEntity(d.id, d.person, d.updatedAt, json.encodeToString(d)))
            audit("debt", d.id, if (before == null) "create" else "update", if (before == null) "$what: ${d.amount}" else "Updated “$what”", null, null)
            d
        }
    }

    /** Deletes an entry and its repayments. */
    suspend fun deleteDebt(id: String) = tx {
        val d = dao.debt(id)?.let { json.decodeFromString<Debt>(it) } ?: throw ValidationException("Entry not found")
        val ts = now()
        dao.debtRepaymentsFor(id).map { json.decodeFromString<DebtRepayment>(it).id }.forEach { rid -> dao.deleteDebtRepayment(rid); dao.putTombstone(TombstoneEntity(rid, "debtRepayments", ts)) }
        dao.deleteDebt(id)
        dao.putTombstone(TombstoneEntity(id, "debts", ts))
        audit("debt", id, "delete", "Deleted “${if (d.direction == "lent") "Lent to" else "Borrowed from"} ${d.person}”", null, null)
    }

    /** Records (or corrects) a repayment; the total returned can never exceed the amount. */
    suspend fun saveDebtRepayment(input: DebtRepayment): DebtRepayment {
        val r = input.copy(updatedAt = now())
        Validation.debtRepayment(r).let { if (it.isNotEmpty()) throw ValidationException(it.values.first(), it) }
        return tx {
            val d = dao.debt(r.debtId)?.let { json.decodeFromString<Debt>(it) } ?: throw ValidationException("Entry not found")
            val pending = cents(d.amount) - repaidCents(d.id, r.id)
            if (cents(r.amount) > pending) throw ValidationException("Only ${rupees(pending)} is still pending")
            dao.upsertDebtRepayment(DebtRepaymentEntity(r.id, r.debtId, r.date, r.updatedAt, json.encodeToString(r)))
            audit("debt", d.id, "repay", "${if (d.direction == "lent") "Received from" else "Repaid to"} ${d.person}: ${r.amount}", null, null)
            r
        }
    }

    suspend fun deleteDebtRepayment(id: String) = tx {
        val r = dao.debtRepayment(id)?.let { json.decodeFromString<DebtRepayment>(it) } ?: throw ValidationException("Repayment not found")
        dao.deleteDebtRepayment(id)
        dao.putTombstone(TombstoneEntity(id, "debtRepayments", now()))
        audit("debt", r.debtId, "unrepay", "Removed a repayment of ${r.amount} (${r.date})", null, null)
    }

    suspend fun deleteBillPayment(id: String) = tx {
        val p = dao.billPayment(id)?.let { json.decodeFromString<BillPayment>(it) } ?: throw ValidationException("Payment not found")
        dao.deleteBillPayment(id)
        dao.putTombstone(TombstoneEntity(id, "billPayments", now()))
        audit("bill", p.billId, "unpay", "Marked unpaid (due ${p.dueDate})", null, null)
    }

    suspend fun saveCategory(c: Category) = tx { dao.upsertCategory(CategoryEntity(c.id, now(), json.encodeToString(c.copy(updatedAt = now())))) }
    suspend fun deleteCategory(id: String) = tx { dao.deleteCategory(id); dao.putTombstone(TombstoneEntity(id, "categories", now())) }

    suspend fun saveNotification(n: NotificationRecord): NotificationRecord = tx {
        val rec = n.copy(updatedAt = now())
        dao.upsertNotification(NotificationEntity(rec.id, rec.key, rec.updatedAt, json.encodeToString(rec)))
        rec
    }

    suspend fun addBackupHistory(e: BackupHistoryEntity) = tx { dao.insertBackupHistory(e) }

    suspend fun addAuditEntry(entity: String, entityId: String?, action: String, summary: String) = tx { audit(entity, entityId, action, summary, null, null) }

    /** Restore: replace all synced data in one transaction (device-local settings are kept). */
    suspend fun replaceAll(d: SnapshotData) = tx {
        dao.clearPayments(); dao.clearAdjustments(); dao.clearLoans(); dao.clearReminders(); dao.clearNotifications(); dao.clearAudit(); dao.clearCategories()
        dao.clearBillPayments(); dao.clearBills(); dao.clearDebtRepayments(); dao.clearDebts(); dao.clearTombstones()
        writeData(d)
    }

    /** Sync: upsert merged records and delete those removed by tombstones (children first). */
    suspend fun applyMerged(d: SnapshotData) = tx {
        val keepP = d.payments.map { it.id }.toSet(); dao.paymentIdList().filter { it !in keepP }.forEach(dao::deletePayment)
        val keepA = d.adjustments.map { it.id }.toSet(); dao.adjustmentIdList().filter { it !in keepA }.forEach(dao::deleteAdjustment)
        val keepR = d.customReminders.map { it.id }.toSet(); dao.reminderIdList().filter { it !in keepR }.forEach(dao::deleteReminder)
        val keepN = d.notifications.map { it.id }.toSet(); dao.notificationIdList().filter { it !in keepN }.forEach(dao::deleteNotification)
        val keepAu = d.audit.map { it.id }.toSet(); dao.auditIdList().filter { it !in keepAu }.forEach(dao::deleteAudit)
        val keepC = d.categories.map { it.id }.toSet(); dao.categoryIdList().filter { it !in keepC }.forEach(dao::deleteCategory)
        val keepBP = d.billPayments.map { it.id }.toSet(); dao.billPaymentIdList().filter { it !in keepBP }.forEach(dao::deleteBillPayment)
        val keepB = d.bills.map { it.id }.toSet(); dao.billIdList().filter { it !in keepB }.forEach(dao::deleteBill)
        val keepDR = d.debtRepayments.map { it.id }.toSet(); dao.debtRepaymentIdList().filter { it !in keepDR }.forEach(dao::deleteDebtRepayment)
        val keepD = d.debts.map { it.id }.toSet(); dao.debtIdList().filter { it !in keepD }.forEach(dao::deleteDebt)
        val keepL = d.loans.map { it.id }.toSet(); dao.loanIdList().filter { it !in keepL }.forEach(dao::deleteLoan)
        dao.clearTombstones()
        writeData(d)
    }

    private fun writeData(d: SnapshotData) {
        d.loans.forEach(::putLoan)
        d.adjustments.forEach { dao.upsertAdjustment(AdjustmentEntity(it.id, it.loanId, it.effectiveDate, it.updatedAt, json.encodeToString(it))) }
        d.payments.forEach(::putPayment)
        d.customReminders.forEach { dao.upsertReminder(ReminderEntity(it.id, it.updatedAt, json.encodeToString(it))) }
        d.notifications.forEach { dao.upsertNotification(NotificationEntity(it.id, it.key, it.updatedAt, json.encodeToString(it))) }
        d.audit.forEach { dao.insertAudit(AuditEntity(it.id, it.at, it.entity, it.entityId, json.encodeToString(it))) }
        d.bills.forEach { dao.upsertBill(BillEntity(it.id, it.name, it.updatedAt, json.encodeToString(it))) }
        d.billPayments.forEach { dao.upsertBillPayment(BillPaymentEntity(it.id, it.billId, it.dueDate, it.updatedAt, json.encodeToString(it))) }
        d.debts.forEach { dao.upsertDebt(DebtEntity(it.id, it.person, it.updatedAt, json.encodeToString(it))) }
        d.debtRepayments.forEach { dao.upsertDebtRepayment(DebtRepaymentEntity(it.id, it.debtId, it.date, it.updatedAt, json.encodeToString(it))) }
        d.categories.forEach { dao.upsertCategory(CategoryEntity(it.id, it.updatedAt, json.encodeToString(it))) }
        d.tombstones.forEach { dao.putTombstone(TombstoneEntity(it.id, it.table, it.deletedAt)) }
        dao.putKv(KvEntity("preferences", json.encodeToString(d.preferences.value), d.preferences.updatedAt))
    }

    private fun putLoan(l: Loan) = dao.upsertLoan(LoanEntity(l.id, l.name, l.status, l.updatedAt, json.encodeToString(l)))
    private fun putPayment(p: Payment) = dao.upsertPayment(PaymentEntity(p.id, p.loanId, p.txnDate, p.installmentNo, p.type, p.amount, p.status, p.updatedAt, json.encodeToString(p)))

    private fun audit(entity: String, entityId: String?, action: String, summary: String, before: String?, after: String?) {
        val ts = now()
        val a = AuditEntry(newId(), ts, ts, ts, entity, entityId, action, summary, before?.let { canonicalize(it) }, after?.let { canonicalize(it) }, local().deviceId)
        dao.insertAudit(AuditEntity(a.id, a.at, a.entity, a.entityId, json.encodeToString(a)))
    }

    private fun canonicalize(s: String) = SnapshotCodec.canonical(json.parseToJsonElement(s))

    /** Names of changed fields for audit summaries (values omitted on purpose). */
    private inline fun <reified T> changed(a: T, b: T): String {
        val ja = json.encodeToJsonElement(kotlinx.serialization.serializer<T>(), a) as kotlinx.serialization.json.JsonObject
        val jb = json.encodeToJsonElement(kotlinx.serialization.serializer<T>(), b) as kotlinx.serialization.json.JsonObject
        val keys = jb.keys.filter { it != "updatedAt" && ja[it] != jb[it] }
        return if (keys.isEmpty()) "" else " (${keys.take(8).joinToString(", ")}${if (keys.size > 8) "…" else ""})"
    }

    fun integrity(): Pair<Boolean, String> {
        val c = db.openHelper.readableDatabase
        val msg = c.query("PRAGMA integrity_check").use { if (it.moveToFirst()) it.getString(0) else "unknown" }
        val fk = c.query("PRAGMA foreign_key_check").use { it.count }
        return (msg == "ok" && fk == 0) to "$msg; foreign key violations: $fk"
    }
}
