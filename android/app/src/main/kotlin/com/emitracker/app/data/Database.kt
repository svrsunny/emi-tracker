package com.emitracker.app.data

import android.content.Context
import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Upsert
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/*
 * Room database (SQLite, app-private storage). Like the desktop app, each record keeps a few
 * indexed columns plus its complete JSON document, so the schema stays stable while the record
 * shape follows the shared snapshot format. Foreign keys guarantee payments and adjustments
 * always reference an existing loan.
 */

@Entity(tableName = "loans")
data class LoanEntity(@androidx.room.PrimaryKey val id: String, val name: String, val status: String, @ColumnInfo(name = "updated_at") val updatedAt: String, val data: String)

@Entity(
    tableName = "adjustments",
    foreignKeys = [ForeignKey(entity = LoanEntity::class, parentColumns = ["id"], childColumns = ["loan_id"], onDelete = ForeignKey.RESTRICT)],
    indices = [Index("loan_id")],
)
data class AdjustmentEntity(@androidx.room.PrimaryKey val id: String, @ColumnInfo(name = "loan_id") val loanId: String, @ColumnInfo(name = "effective_date") val effectiveDate: String, @ColumnInfo(name = "updated_at") val updatedAt: String, val data: String)

@Entity(
    tableName = "payments",
    foreignKeys = [ForeignKey(entity = LoanEntity::class, parentColumns = ["id"], childColumns = ["loan_id"], onDelete = ForeignKey.RESTRICT)],
    indices = [Index(value = ["loan_id", "txn_date"])],
)
data class PaymentEntity(
    @androidx.room.PrimaryKey val id: String, @ColumnInfo(name = "loan_id") val loanId: String, @ColumnInfo(name = "txn_date") val txnDate: String,
    @ColumnInfo(name = "installment_no") val installmentNo: Int?, val type: String, val amount: String, val status: String,
    @ColumnInfo(name = "updated_at") val updatedAt: String, val data: String,
)

@Entity(tableName = "custom_reminders")
data class ReminderEntity(@androidx.room.PrimaryKey val id: String, @ColumnInfo(name = "updated_at") val updatedAt: String, val data: String)

@Entity(tableName = "notifications", indices = [Index("key")])
data class NotificationEntity(@androidx.room.PrimaryKey val id: String, val key: String, @ColumnInfo(name = "updated_at") val updatedAt: String, val data: String)

@Entity(tableName = "audit", indices = [Index("at")])
data class AuditEntity(@androidx.room.PrimaryKey val id: String, val at: String, val entity: String, @ColumnInfo(name = "entity_id") val entityId: String?, val data: String)

@Entity(tableName = "categories")
data class CategoryEntity(@androidx.room.PrimaryKey val id: String, @ColumnInfo(name = "updated_at") val updatedAt: String, val data: String)

@Entity(tableName = "kv")
data class KvEntity(@androidx.room.PrimaryKey val key: String, val value: String, @ColumnInfo(name = "updated_at") val updatedAt: String)

/** Added in schema v3: recurring bills and their payments. */
@Entity(tableName = "bills")
data class BillEntity(@androidx.room.PrimaryKey val id: String, val name: String, @ColumnInfo(name = "updated_at") val updatedAt: String, val data: String)

@Entity(
    tableName = "bill_payments",
    foreignKeys = [ForeignKey(entity = BillEntity::class, parentColumns = ["id"], childColumns = ["bill_id"], onDelete = ForeignKey.RESTRICT)],
    indices = [Index(value = ["bill_id", "due_date"])],
)
data class BillPaymentEntity(
    @androidx.room.PrimaryKey val id: String, @ColumnInfo(name = "bill_id") val billId: String, @ColumnInfo(name = "due_date") val dueDate: String,
    @ColumnInfo(name = "updated_at") val updatedAt: String, val data: String,
)

/** Added in schema v4: money lent / borrowed and what was returned. */
@Entity(tableName = "debts")
data class DebtEntity(@androidx.room.PrimaryKey val id: String, val person: String, @ColumnInfo(name = "updated_at") val updatedAt: String, val data: String)

@Entity(
    tableName = "debt_repayments",
    foreignKeys = [ForeignKey(entity = DebtEntity::class, parentColumns = ["id"], childColumns = ["debt_id"], onDelete = ForeignKey.RESTRICT)],
    indices = [Index(value = ["debt_id", "date"])],
)
data class DebtRepaymentEntity(
    @androidx.room.PrimaryKey val id: String, @ColumnInfo(name = "debt_id") val debtId: String, val date: String,
    @ColumnInfo(name = "updated_at") val updatedAt: String, val data: String,
)

/** Added in schema v2 (sync support). */
@Entity(tableName = "tombstones", primaryKeys = ["tbl", "id"])
data class TombstoneEntity(val id: String, val tbl: String, @ColumnInfo(name = "deleted_at") val deletedAt: String)

/** Added in schema v2. */
@Entity(tableName = "backup_history")
data class BackupHistoryEntity(
    @androidx.room.PrimaryKey val id: String, @ColumnInfo(name = "created_at") val createdAt: String, val kind: String, val path: String,
    val size: Long, val encrypted: Boolean, val checksum: String, val counts: String, val ok: Boolean, val message: String,
)

@Dao
interface EmiDao {
    @Query("SELECT data FROM loans ORDER BY name") fun loans(): List<String>
    @Query("SELECT data FROM adjustments ORDER BY effective_date") fun adjustments(): List<String>
    @Query("SELECT data FROM payments ORDER BY txn_date, id") fun payments(): List<String>
    @Query("SELECT data FROM custom_reminders") fun reminders(): List<String>
    @Query("SELECT data FROM notifications ORDER BY updated_at DESC LIMIT :limit") fun notifications(limit: Int): List<String>
    @Query("SELECT data FROM notifications WHERE `key` = :key ORDER BY updated_at DESC LIMIT 1") fun notificationByKey(key: String): String?
    @Query("SELECT data FROM audit ORDER BY at DESC LIMIT :limit") fun audit(limit: Int): List<String>
    @Query("SELECT data FROM categories") fun categories(): List<String>
    @Query("SELECT * FROM tombstones") fun tombstones(): List<TombstoneEntity>
    @Query("SELECT * FROM kv WHERE `key` = :key") fun kv(key: String): KvEntity?
    @Query("SELECT * FROM backup_history ORDER BY created_at DESC LIMIT :limit") fun backupHistory(limit: Int): List<BackupHistoryEntity>
    @Query("SELECT id FROM payments WHERE loan_id = :loanId") fun paymentIds(loanId: String): List<String>
    @Query("SELECT id FROM adjustments WHERE loan_id = :loanId") fun adjustmentIds(loanId: String): List<String>
    @Query("SELECT data FROM bills ORDER BY name") fun bills(): List<String>
    @Query("SELECT data FROM bill_payments ORDER BY due_date, id") fun billPayments(): List<String>
    @Query("SELECT data FROM bills WHERE id = :id") fun bill(id: String): String?
    @Query("SELECT data FROM bill_payments WHERE id = :id") fun billPayment(id: String): String?
    @Query("SELECT id FROM bill_payments WHERE bill_id = :billId AND due_date = :dueDate AND id <> :exceptId") fun billPaymentFor(billId: String, dueDate: String, exceptId: String): String?
    @Query("SELECT id FROM bill_payments WHERE bill_id = :billId") fun billPaymentIds(billId: String): List<String>
    @Upsert fun upsertBill(e: BillEntity)
    @Upsert fun upsertBillPayment(e: BillPaymentEntity)
    @Query("DELETE FROM bills WHERE id = :id") fun deleteBill(id: String)
    @Query("DELETE FROM bill_payments WHERE id = :id") fun deleteBillPayment(id: String)
    @Query("DELETE FROM bills") fun clearBills()
    @Query("DELETE FROM bill_payments") fun clearBillPayments()
    @Query("SELECT id FROM bills") fun billIdList(): List<String>
    @Query("SELECT id FROM bill_payments") fun billPaymentIdList(): List<String>

    @Query("SELECT data FROM debts ORDER BY person, id") fun debts(): List<String>
    @Query("SELECT data FROM debt_repayments ORDER BY date, id") fun debtRepayments(): List<String>
    @Query("SELECT data FROM debts WHERE id = :id") fun debt(id: String): String?
    @Query("SELECT data FROM debt_repayments WHERE id = :id") fun debtRepayment(id: String): String?
    @Query("SELECT data FROM debt_repayments WHERE debt_id = :debtId") fun debtRepaymentsFor(debtId: String): List<String>
    @Upsert fun upsertDebt(e: DebtEntity)
    @Upsert fun upsertDebtRepayment(e: DebtRepaymentEntity)
    @Query("DELETE FROM debts WHERE id = :id") fun deleteDebt(id: String)
    @Query("DELETE FROM debt_repayments WHERE id = :id") fun deleteDebtRepayment(id: String)
    @Query("DELETE FROM debts") fun clearDebts()
    @Query("DELETE FROM debt_repayments") fun clearDebtRepayments()
    @Query("SELECT id FROM debts") fun debtIdList(): List<String>
    @Query("SELECT id FROM debt_repayments") fun debtRepaymentIdList(): List<String>

    // @Upsert updates in place; REPLACE would delete the row first and violate ON DELETE RESTRICT
    @Upsert fun upsertLoan(e: LoanEntity)
    @Upsert fun upsertAdjustment(e: AdjustmentEntity)
    @Upsert fun upsertPayment(e: PaymentEntity)
    @Upsert fun upsertReminder(e: ReminderEntity)
    @Upsert fun upsertNotification(e: NotificationEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun insertAudit(e: AuditEntity)
    @Upsert fun upsertCategory(e: CategoryEntity)
    @Upsert fun putKv(e: KvEntity)
    @Upsert fun putTombstone(e: TombstoneEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) fun insertBackupHistory(e: BackupHistoryEntity)

    @Query("DELETE FROM payments WHERE loan_id = :loanId") fun deletePaymentsOf(loanId: String)
    @Query("DELETE FROM adjustments WHERE loan_id = :loanId") fun deleteAdjustmentsOf(loanId: String)
    @Query("DELETE FROM loans WHERE id = :id") fun deleteLoan(id: String)
    @Query("DELETE FROM adjustments WHERE id = :id") fun deleteAdjustment(id: String)
    @Query("DELETE FROM payments WHERE id = :id") fun deletePayment(id: String)
    @Query("DELETE FROM custom_reminders WHERE id = :id") fun deleteReminder(id: String)
    @Query("DELETE FROM notifications WHERE id = :id") fun deleteNotification(id: String)
    @Query("DELETE FROM audit WHERE id = :id") fun deleteAudit(id: String)
    @Query("DELETE FROM categories WHERE id = :id") fun deleteCategory(id: String)
    @Query("DELETE FROM payments") fun clearPayments()
    @Query("DELETE FROM adjustments") fun clearAdjustments()
    @Query("DELETE FROM loans") fun clearLoans()
    @Query("DELETE FROM custom_reminders") fun clearReminders()
    @Query("DELETE FROM notifications") fun clearNotifications()
    @Query("DELETE FROM audit") fun clearAudit()
    @Query("DELETE FROM categories") fun clearCategories()
    @Query("DELETE FROM tombstones") fun clearTombstones()
    @Query("SELECT id FROM loans") fun loanIdList(): List<String>
    @Query("SELECT id FROM payments") fun paymentIdList(): List<String>
    @Query("SELECT id FROM adjustments") fun adjustmentIdList(): List<String>
    @Query("SELECT id FROM custom_reminders") fun reminderIdList(): List<String>
    @Query("SELECT id FROM notifications") fun notificationIdList(): List<String>
    @Query("SELECT id FROM audit") fun auditIdList(): List<String>
    @Query("SELECT id FROM categories") fun categoryIdList(): List<String>
}

@Database(
    entities = [LoanEntity::class, AdjustmentEntity::class, PaymentEntity::class, ReminderEntity::class, NotificationEntity::class, AuditEntity::class,
        CategoryEntity::class, KvEntity::class, TombstoneEntity::class, BackupHistoryEntity::class, BillEntity::class, BillPaymentEntity::class,
        DebtEntity::class, DebtRepaymentEntity::class],
    version = 4,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun dao(): EmiDao

    companion object {
        const val NAME = "emi-tracker.db"

        /** v1 -> v2: sync tombstones and backup history (same change as the desktop schema). */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS `tombstones` (`id` TEXT NOT NULL, `tbl` TEXT NOT NULL, `deleted_at` TEXT NOT NULL, PRIMARY KEY(`tbl`, `id`))")
                db.execSQL("CREATE TABLE IF NOT EXISTS `backup_history` (`id` TEXT NOT NULL, `created_at` TEXT NOT NULL, `kind` TEXT NOT NULL, `path` TEXT NOT NULL, `size` INTEGER NOT NULL, `encrypted` INTEGER NOT NULL, `checksum` TEXT NOT NULL, `counts` TEXT NOT NULL, `ok` INTEGER NOT NULL, `message` TEXT NOT NULL, PRIMARY KEY(`id`))")
            }
        }

        /** v2 -> v3: recurring bills (same change as the desktop schema v3). */
        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS `bills` (`id` TEXT NOT NULL, `name` TEXT NOT NULL, `updated_at` TEXT NOT NULL, `data` TEXT NOT NULL, PRIMARY KEY(`id`))")
                db.execSQL("CREATE TABLE IF NOT EXISTS `bill_payments` (`id` TEXT NOT NULL, `bill_id` TEXT NOT NULL, `due_date` TEXT NOT NULL, `updated_at` TEXT NOT NULL, `data` TEXT NOT NULL, PRIMARY KEY(`id`), FOREIGN KEY(`bill_id`) REFERENCES `bills`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT )")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_bill_payments_bill_id_due_date` ON `bill_payments` (`bill_id`, `due_date`)")
            }
        }

        /** v3 -> v4: lending & borrowing (same change as the desktop schema v4). */
        val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS `debts` (`id` TEXT NOT NULL, `person` TEXT NOT NULL, `updated_at` TEXT NOT NULL, `data` TEXT NOT NULL, PRIMARY KEY(`id`))")
                db.execSQL("CREATE TABLE IF NOT EXISTS `debt_repayments` (`id` TEXT NOT NULL, `debt_id` TEXT NOT NULL, `date` TEXT NOT NULL, `updated_at` TEXT NOT NULL, `data` TEXT NOT NULL, PRIMARY KEY(`id`), FOREIGN KEY(`debt_id`) REFERENCES `debts`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT )")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_debt_repayments_debt_id_date` ON `debt_repayments` (`debt_id`, `date`)")
            }
        }

        fun build(context: Context, inMemory: Boolean = false, name: String = NAME, allowMainThread: Boolean = false): AppDatabase {
            val b = if (inMemory) Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java) else Room.databaseBuilder(context, AppDatabase::class.java, name)
            if (allowMainThread) b.allowMainThreadQueries() // tests only
            return b.addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4)
                .setJournalMode(JournalMode.TRUNCATE) // single-file database: simple to copy for recovery
                .build()
        }
    }
}
