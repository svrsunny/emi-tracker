package com.emitracker.app

import android.Manifest
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.emitracker.app.data.AppDatabase
import com.emitracker.app.data.Defaults
import com.emitracker.app.data.DuplicateException
import com.emitracker.app.data.Repository
import com.emitracker.app.data.ValidationException
import com.emitracker.app.io.BackupService
import com.emitracker.app.io.FileFolder
import com.emitracker.app.work.Background
import com.emitracker.core.BackupException
import com.emitracker.core.Engine
import com.emitracker.core.Loan
import com.emitracker.core.SnapshotCodec
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import java.io.File
import java.nio.file.Files

@RunWith(AndroidJUnit4::class)
class DataLayerTest {
    private val ctx = ApplicationProvider.getApplicationContext<android.app.Application>()
    private fun repo(deviceId: String = "dev-a") = Repository(AppDatabase.build(ctx, inMemory = true, allowMainThread = true)).also { r ->
        runBlocking { r.setLocal { it.copy(deviceId = deviceId, deviceName = deviceId) } }
    }

    private fun loan(id: String = "L1", name: String = "Test loan") = Defaults.loan("2024-01-01").copy(
        id = id, name = name, principal = "100000.00", sanctionedAmount = "100000.00", disbursedAmount = "100000.00", annualRate = "12", totalInstallments = 12,
        startDate = "2024-01-01", firstEmiDate = "2024-02-01", emiDueDay = 1, emiRounding = "paisa", trackingStartDate = "2024-01-01")

    private fun pay(loanId: String = "L1", inst: Int? = 1, date: String = "2024-02-01", amount: String = "8884.88", type: String = "emi") =
        Defaults.payment(loanId, date).copy(installmentNo = inst, amount = amount, type = type)

    private suspend fun seeded(r: Repository): Loan {
        val l = r.saveLoan(loan())
        r.saveLoan(loan("L2", "Second").copy(principal = "50000.00", sanctionedAmount = "50000.00", disbursedAmount = "50000.00"))
        r.savePayment(pay())
        r.savePayment(pay(inst = 2, date = "2024-03-01"))
        r.savePayment(pay(inst = null, date = "2024-03-05", amount = "10000.00", type = "prepayment"))
        r.saveReminder(Defaults.reminder("2024-04-01").copy(title = "Check statement\n", repeat = "monthly", loanId = "L1"))
        r.setPreferences(r.preferences().value.copy(accent = "#34c38f", heatmapPalette = "violet"))
        return l
    }

    @Test fun validationDuplicatesAndAudit() = runBlocking {
        val r = repo()
        seeded(r)
        try { r.saveLoan(loan("bad").copy(principal = "-5")); fail() } catch (_: ValidationException) {}
        try { r.saveLoan(loan("bad").copy(firstEmiDate = "2023-12-01")); fail() } catch (e: ValidationException) { assertTrue(e.message!!.contains("First EMI")) }
        try { r.savePayment(pay()); fail("duplicate") } catch (_: DuplicateException) {}
        assertNotNull(r.savePayment(pay(), allowDuplicate = true))
        try { r.savePayment(pay(loanId = "missing")); fail() } catch (_: ValidationException) {}
        val p = r.payments().first()
        r.reversePayment(p.id, "Entered twice")
        assertEquals("reversed", r.payments().first { it.id == p.id }.status)
        assertTrue(r.audit().any { it.entityId == p.id && it.action == "reverse" })
        try { r.savePayment(r.payments().first { it.id == p.id }.copy(amount = "1.00")); fail() } catch (_: ValidationException) {}
    }

    @Test fun permanentDeleteLeavesTombstones() = runBlocking {
        val r = repo()
        seeded(r)
        try { r.deleteLoanPermanently("L1", "wrong"); fail() } catch (_: ValidationException) {}
        r.deleteLoanPermanently("L1", "Test loan")
        assertNull(r.loans().firstOrNull { it.id == "L1" })
        assertEquals(3, r.tombstones().count { it.table == "payments" })
        assertTrue(r.integrity().first)
    }

    @Test fun backupRestoreRoundTripIntoCleanDatabase() = runBlocking {
        val a = repo()
        seeded(a)
        val dir = Files.createTempDirectory("emi-backup").toFile()
        val name = BackupService(ctx, a).backupToFolder(FileFolder(dir))
        assertNotNull(a.local().lastBackupAt)
        val b = repo("dev-b")
        val report = BackupService(ctx, b).restore(File(dir, name).readText(), null)
        assertTrue(report.checksumVerified)
        assertEquals(3, report.restored["payments"])
        assertEquals("violet", b.preferences().value.heatmapPalette)
        assertEquals("Check statement\n", b.reminders().first().title)
        val sa = Engine.compute(a.loans().first { it.id == "L1" }, a.adjustments(), a.payments(), "2024-03-10").summary
        val sb = Engine.compute(b.loans().first { it.id == "L1" }, b.adjustments(), b.payments(), "2024-03-10").summary
        assertEquals(sa, sb)
    }

    @Test fun encryptedBackupsAndRejection() = runBlocking {
        val r = repo()
        seeded(r)
        val dir = Files.createTempDirectory("emi-enc").toFile()
        val name = BackupService(ctx, r).backupToFolder(FileFolder(dir), passphrase = "correct horse battery")
        val text = File(dir, name).readText()
        assertFalse(text.contains("Second"))
        val svc = BackupService(ctx, repo("x"))
        try { svc.restore(text, null); fail() } catch (e: BackupException) { assertEquals("needs_passphrase", e.code) }
        try { svc.restore(text, "wrong passphrase"); fail() } catch (e: BackupException) { assertEquals("bad_passphrase", e.code) }
        assertEquals(2, svc.restore(text, "correct horse battery").restored["loans"])
        try { svc.restore("{\"format\":\"emi-tracker-snapshot\",\"formatVersion\":1}", null); fail() } catch (e: BackupException) { assertEquals("invalid", e.code) }
    }

    @Test fun failedRestoreLeavesDataUntouched() = runBlocking {
        val r = repo()
        seeded(r)
        val before = SnapshotCodec.normalizeData(r.snapshotData()).payments
        val good = SnapshotCodec.serialize(SnapshotCodec.build(r.snapshotData(), "backup", BackupService(ctx, r).app, "dev-a", "a"))
        try { BackupService(ctx, r).restore(good.replace("8884.88", "9999.99"), null); fail() } catch (e: BackupException) { assertEquals("checksum_mismatch", e.code) }
        assertEquals(before, SnapshotCodec.normalizeData(r.snapshotData()).payments)
    }

    @Test fun restoresDesktopBackup() = runBlocking {
        val file = generateSequence(File("").absoluteFile) { it.parentFile }.map { File(it, "fixtures/desktop-backup.json") }.firstOrNull { it.exists() } ?: return@runBlocking
        val r = repo("phone")
        val report = BackupService(ctx, r).restore(file.readText(), null)
        assertTrue(report.checksumVerified)
        assertEquals(3, report.restored["loans"]) // home, car and a chit fund
        val exp = SnapshotCodec.json.parseToJsonElement(File(file.parentFile, "desktop-expected.json").readText()) as kotlinx.serialization.json.JsonObject
        val h = (exp["loans"] as kotlinx.serialization.json.JsonObject)["H1"] as kotlinx.serialization.json.JsonObject
        val s = Engine.compute(r.loans().first { it.id == "H1" }, r.adjustments(), r.payments(), "2024-08-15").summary
        assertEquals((h["outstandingPrincipal"] as kotlinx.serialization.json.JsonPrimitive).content, s.outstandingPrincipal)
    }

    @Test fun syncBetweenTwoDevices() = runBlocking {
        val a = repo("dev-a"); seeded(a)
        val b = repo("dev-b")
        val folder = FileFolder(Files.createTempDirectory("emi-sync").toFile())
        val sa = BackupService(ctx, a); val sb = BackupService(ctx, b)
        sa.syncNow(folder, null)
        assertTrue(sb.syncNow(folder, null).totals.added > 0)
        assertEquals(2, b.loans().size)
        a.savePayment(pay(inst = 3, date = "2024-04-01"))
        Thread.sleep(5)
        b.saveLoan(b.loans().first { it.id == "L2" }.copy(name = "Renamed on phone"))
        b.deleteReminder(b.reminders().first().id)
        sa.syncNow(folder, null); sb.syncNow(folder, null); sa.syncNow(folder, null)
        for (r in listOf(a, b)) {
            assertEquals("Renamed on phone", r.loans().first { it.id == "L2" }.name)
            assertEquals(4, r.payments().size)
            assertTrue(r.reminders().isEmpty())
        }
        // encrypted sync files
        sa.syncNow(folder, "sync passphrase 1")
        assertTrue(folder.list().any { it.endsWith(".emisync") })
        assertTrue(sb.syncNow(folder, "sync passphrase 1").peers.any { it.ok })
    }

    @Test fun billsPaymentsSyncAndDelete() = runBlocking {
        val r = repo()
        val b = r.saveBill(Defaults.bill("2026-01-31").copy(id = "B1", name = "Rent", category = "rent", amount = "15000.00"))
        r.saveBillPayment(Defaults.billPayment(b.id, "2026-01-31", "2026-01-30", "15000.00").copy(id = "BP1"))
        // the same due date cannot be paid twice
        assertTrue(runCatching { r.saveBillPayment(Defaults.billPayment(b.id, "2026-01-31", "2026-01-30", "15000.00")) }.isFailure)
        // a sync merge re-writes an existing bill that has payments (must update in place)
        r.applyMerged(r.snapshotData())
        assertEquals(1, r.billPayments().size)
        // a second device receives the bill through a sync merge
        val other = repo("dev-b")
        val (merged, _) = SnapshotCodec.merge(other.snapshotData(), r.snapshotData())
        other.applyMerged(merged)
        assertEquals(listOf("Rent"), other.bills().map { it.name })
        assertEquals(1, other.billPayments().size)
        r.deleteBill(b.id)
        assertTrue(r.bills().isEmpty() && r.billPayments().isEmpty())
        assertEquals(setOf("bills", "billPayments"), r.tombstones().map { it.table }.toSet())
    }

    @Test fun oneTimeExpenseKeepsPaymentWhenDateChanges() = runBlocking {
        val r = repo()
        val b = r.saveBill(Defaults.bill("2026-02-10").copy(id = "O1", name = "Car service", amount = "4500.00", frequency = "once"))
        r.saveBillPayment(Defaults.billPayment(b.id, "2026-02-10", "2026-02-10", "4300.00"))
        r.saveBill(b.copy(startDate = "2026-02-12", dueDay = 12))
        assertEquals(listOf("2026-02-12"), r.billPayments().map { it.dueDate })
    }

    @Test fun debtsRepaymentsSyncAndDelete() = runBlocking {
        val r = repo()
        val d = r.saveDebt(Defaults.debt("2026-01-05").copy(id = "D1", person = "Ravi", amount = "10000.00", dueDate = "2026-03-01"))
        r.saveDebtRepayment(Defaults.debtRepayment(d.id, "2026-02-01", "4000.00").copy(id = "R1"))
        // never more than what is pending; a correction counts everything except itself
        assertTrue(runCatching { r.saveDebtRepayment(Defaults.debtRepayment(d.id, "2026-02-02", "6000.01")) }.isFailure)
        r.saveDebtRepayment(Defaults.debtRepayment(d.id, "2026-02-03", "6000.00").copy(id = "R2"))
        r.saveDebtRepayment(Defaults.debtRepayment(d.id, "2026-02-01", "3000.00").copy(id = "R1"))
        assertTrue(runCatching { r.saveDebt(d.copy(amount = "8000.00")) }.isFailure)
        // a sync merge re-writes an entry that has repayments (must update in place)
        r.applyMerged(r.snapshotData())
        assertEquals(2, r.debtRepayments().size)
        val other = repo("dev-b")
        val (merged, _) = SnapshotCodec.merge(other.snapshotData(), r.snapshotData())
        other.applyMerged(merged)
        assertEquals(listOf("Ravi"), other.debts().map { it.person })
        assertEquals(2, other.debtRepayments().size)
        r.deleteDebt(d.id)
        assertTrue(r.debts().isEmpty() && r.debtRepayments().isEmpty())
        assertEquals(setOf("debts", "debtRepayments"), r.tombstones().map { it.table }.toSet())
    }

    @Test fun appLockPinChecksAndLockout() = runBlocking {
        val r = repo()
        val salt = com.emitracker.app.security.AppLock.newSalt()
        r.setLocal { it.copy(lockMethod = "pin", lockSalt = salt, lockHash = com.emitracker.app.security.AppLock.hash("4826", salt)) }
        com.emitracker.app.security.AppLock.lockNow(r.local())
        assertTrue(com.emitracker.app.security.AppLock.locked.value)
        assertEquals("Wrong PIN", com.emitracker.app.security.AppLock.tryUnlock(r, "1111"))
        assertTrue(com.emitracker.app.security.AppLock.locked.value)
        repeat(3) { com.emitracker.app.security.AppLock.tryUnlock(r, "0000") }
        // the fifth mistake makes you wait, even for the right PIN
        assertTrue(com.emitracker.app.security.AppLock.tryUnlock(r, "0000")!!.contains("Try again in"))
        assertTrue(com.emitracker.app.security.AppLock.tryUnlock(r, "4826")!!.startsWith("Too many attempts"))
        r.setLocal { it.copy(lockoutUntil = 0) }
        assertEquals(null, com.emitracker.app.security.AppLock.tryUnlock(r, "4826"))
        assertTrue(!com.emitracker.app.security.AppLock.locked.value)
        assertEquals(0, r.local().lockFailed)
    }

    @Test fun migrationFromVersion1KeepsData() {
        val name = "migrate-test.db"
        ctx.deleteDatabase(name)
        val v1 = FrameworkSQLiteOpenHelperFactory().create(SupportSQLiteOpenHelper.Configuration.builder(ctx).name(name).callback(object : SupportSQLiteOpenHelper.Callback(1) {
            override fun onCreate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                // the v1 schema exactly as Room created it before tombstones/backup_history existed
                V1_SCHEMA.forEach { db.execSQL(it) }
            }
            override fun onUpgrade(db: androidx.sqlite.db.SupportSQLiteDatabase, oldVersion: Int, newVersion: Int) {}
        }).build())
        val l = loan("OLD", "Old loan")
        v1.writableDatabase.execSQL("INSERT INTO loans (id, name, status, updated_at, data) VALUES (?, ?, ?, ?, ?)", arrayOf(l.id, l.name, l.status, l.updatedAt, SnapshotCodec.json.encodeToString(Loan.serializer(), l)))
        v1.close()
        val db = AppDatabase.build(ctx, name = name, allowMainThread = true)
        val r = Repository(db)
        assertEquals("OLD", r.loans().single().id)
        assertTrue(r.tombstones().isEmpty())
        assertTrue(r.bills().isEmpty()) // v1 -> v2 -> v3: the bill tables exist after migrating
        assertTrue(r.debts().isEmpty() && r.debtRepayments().isEmpty()) // v3 -> v4: lending & borrowing
        assertTrue(r.integrity().first)
        db.close()
    }

    @Test fun workerDeliversRemindersOnceAndRespectsPermission() = runBlocking {
        val app = ctx as EmiApp
        val r = repo("worker")
        val svc = BackupService(ctx, r)
        val today = java.time.LocalDate.now().toString()
        val tomorrow = Dates0.plusDays(today, 1)
        val l = loan("R1", "Reminder loan").copy(startDate = Dates0.minusMonths(today, 1), firstEmiDate = tomorrow, emiDueDay = tomorrow.substring(8).toInt(), trackingStartDate = today)
        r.saveLoan(l)
        r.setPreferences(r.preferences().value.let { it.copy(reminders = it.reminders.copy(quietEnabled = false, time = "00:00", offsets = listOf(1))) })
        // without the POST_NOTIFICATIONS permission the reminder is kept in the in-app inbox
        assertTrue(Background.tick(ctx, r, svc) >= 1)
        val rec = r.notifications().first { it.key.startsWith("emi_upcoming:R1:") }
        assertEquals("in_app", rec.channel)
        // never delivered twice
        Background.tick(ctx, r, svc)
        assertEquals(1, r.notifications().count { it.key == rec.key })
        // with permission granted, delivery uses an Android notification
        shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        r.saveLoan(loan("R2", "Second reminder loan").copy(startDate = l.startDate, firstEmiDate = l.firstEmiDate, emiDueDay = l.emiDueDay, trackingStartDate = today))
        Background.tick(ctx, r, svc)
        assertEquals("native", r.notifications().first { it.key.startsWith("emi_upcoming:R2:") }.channel)
        // editing a loan that has payments works (regression: REPLACE vs foreign keys)
        val amount = Engine.compute(r.loans().first { it.id == "R2" }, emptyList(), emptyList(), today).rows[0].scheduledAmount
        r.savePayment(pay(loanId = "R2", inst = 1, date = today, amount = amount, type = "advance"))
        r.saveLoan(r.loans().first { it.id == "R2" }.copy(notes = "edited after payment"))
        val c = Engine.compute(r.loans().first { it.id == "R2" }, r.adjustments(), r.payments(), today)
        assertEquals(com.emitracker.core.RowStatus.prepaid, c.rows[0].status)
        // the paid installment no longer produces reminders
        assertTrue(Background.tick(ctx, r, svc) == 0 || r.notifications().none { it.key.startsWith("emi_due:R2:1:") })
    }
}

private object Dates0 {
    fun plusDays(d: String, n: Long) = java.time.LocalDate.parse(d).plusDays(n).toString()
    fun minusMonths(d: String, n: Long) = java.time.LocalDate.parse(d).minusMonths(n).toString()
}

/** Room's v1 DDL (identical to v2 minus the two tables added by MIGRATION_1_2). */
val V1_SCHEMA = listOf(
    "CREATE TABLE IF NOT EXISTS `loans` (`id` TEXT NOT NULL, `name` TEXT NOT NULL, `status` TEXT NOT NULL, `updated_at` TEXT NOT NULL, `data` TEXT NOT NULL, PRIMARY KEY(`id`))",
    "CREATE TABLE IF NOT EXISTS `adjustments` (`id` TEXT NOT NULL, `loan_id` TEXT NOT NULL, `effective_date` TEXT NOT NULL, `updated_at` TEXT NOT NULL, `data` TEXT NOT NULL, PRIMARY KEY(`id`), FOREIGN KEY(`loan_id`) REFERENCES `loans`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT )",
    "CREATE INDEX IF NOT EXISTS `index_adjustments_loan_id` ON `adjustments` (`loan_id`)",
    "CREATE TABLE IF NOT EXISTS `payments` (`id` TEXT NOT NULL, `loan_id` TEXT NOT NULL, `txn_date` TEXT NOT NULL, `installment_no` INTEGER, `type` TEXT NOT NULL, `amount` TEXT NOT NULL, `status` TEXT NOT NULL, `updated_at` TEXT NOT NULL, `data` TEXT NOT NULL, PRIMARY KEY(`id`), FOREIGN KEY(`loan_id`) REFERENCES `loans`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT )",
    "CREATE INDEX IF NOT EXISTS `index_payments_loan_id_txn_date` ON `payments` (`loan_id`, `txn_date`)",
    "CREATE TABLE IF NOT EXISTS `custom_reminders` (`id` TEXT NOT NULL, `updated_at` TEXT NOT NULL, `data` TEXT NOT NULL, PRIMARY KEY(`id`))",
    "CREATE TABLE IF NOT EXISTS `notifications` (`id` TEXT NOT NULL, `key` TEXT NOT NULL, `updated_at` TEXT NOT NULL, `data` TEXT NOT NULL, PRIMARY KEY(`id`))",
    "CREATE INDEX IF NOT EXISTS `index_notifications_key` ON `notifications` (`key`)",
    "CREATE TABLE IF NOT EXISTS `audit` (`id` TEXT NOT NULL, `at` TEXT NOT NULL, `entity` TEXT NOT NULL, `entity_id` TEXT, `data` TEXT NOT NULL, PRIMARY KEY(`id`))",
    "CREATE INDEX IF NOT EXISTS `index_audit_at` ON `audit` (`at`)",
    "CREATE TABLE IF NOT EXISTS `categories` (`id` TEXT NOT NULL, `updated_at` TEXT NOT NULL, `data` TEXT NOT NULL, PRIMARY KEY(`id`))",
    "CREATE TABLE IF NOT EXISTS `kv` (`key` TEXT NOT NULL, `value` TEXT NOT NULL, `updated_at` TEXT NOT NULL, PRIMARY KEY(`key`))",
)
