package com.emitracker.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

class SnapshotTest {
    private val app = AppInfo("EMI Tracker", "test", "android")
    private fun data(): SnapshotData {
        val l = loan()
        return SnapshotData(
            loans = listOf(l, loan(id = "L2", name = "Second", principal = "50000.00")),
            payments = listOf(pay(id = "p1", installmentNo = 1, amount = "8884.88"), pay(id = "p2", installmentNo = 2, txnDate = "2024-03-01", amount = "8884.88")),
            customReminders = listOf(CustomReminder("r1", TS, TS, "Check \"statement\"\n", "line\tbreak", "2024-04-01", "09:00", "monthly", "L1", true)),
            preferences = StampedPreferences(Preferences(accent = "#34c38f"), TS),
        )
    }
    private fun expectCode(code: String, block: () -> Unit) {
        try { block(); fail("expected $code") } catch (e: BackupException) { assertEquals(code, e.code) }
    }

    @Test fun roundTripPlainAndEncrypted() {
        val d = data()
        val snap = SnapshotCodec.build(d, "backup", app, "dev", "Phone")
        val back = SnapshotCodec.parse(SnapshotCodec.serialize(snap))
        assertEquals(snap.checksum, back.checksum)
        assertEquals(d.payments.sortedBy { it.id }, back.data.payments)
        val enc = SnapshotCodec.serialize(snap, "correct horse battery")
        assertFalse(enc.contains("Second"))
        expectCode("needs_passphrase") { SnapshotCodec.parse(enc) }
        expectCode("bad_passphrase") { SnapshotCodec.parse(enc, "wrong passphrase") }
        assertEquals(2, SnapshotCodec.parse(enc, "correct horse battery").data.loans.size)
    }

    @Test fun rejectsCorruptTamperedForeignFuture() {
        val text = SnapshotCodec.serialize(SnapshotCodec.build(data(), "backup", app, "dev", "Phone"))
        expectCode("corrupt") { SnapshotCodec.parse(text.substring(0, text.length / 2)) }
        expectCode("checksum_mismatch") { SnapshotCodec.parse(text.replace("8884.88", "9999.99")) }
        expectCode("not_a_backup") { SnapshotCodec.parse("{\"hello\":1}") }
        expectCode("unsupported_version") { SnapshotCodec.parse(text.replace("\"formatVersion\": 1", "\"formatVersion\": 99")) }
    }

    @Test fun mergeIsCommutativeIdempotentAndHonoursTombstones() {
        val a = data()
        val b = a.copy(loans = a.loans.map { if (it.id == "L2") it.copy(name = "Renamed", updatedAt = "2024-06-01T00:00:00.000Z") else it })
        val (ab, stats) = SnapshotCodec.merge(a, b)
        val (ba, _) = SnapshotCodec.merge(b, a)
        assertEquals(1, stats.updated)
        assertEquals(ab.loans, ba.loans)
        assertEquals("Renamed", ab.loans.first { it.id == "L2" }.name)
        assertEquals(ab.loans, SnapshotCodec.merge(ab, b).first.loans)
        val deleted = a.copy(customReminders = emptyList(), tombstones = listOf(Tombstone("r1", "customReminders", "2024-06-01T00:00:00.000Z")))
        assertTrue(SnapshotCodec.merge(a, deleted).first.customReminders.isEmpty())
    }

    @Test fun canonicalJsonMatchesJavaScript() {
        // expected strings produced by JSON.stringify in Node for the same values
        val el = SnapshotCodec.json.parseToJsonElement("{\"b\":1,\"a\":[true,null,\"x\\\"y\\n\\u0001\"],\"c\":{\"z\":\"₹\",\"y\":-5}}")
        assertEquals("{\"a\":[true,null,\"x\\\"y\\n\\u0001\"],\"b\":1,\"c\":{\"y\":-5,\"z\":\"₹\"}}", SnapshotCodec.canonical(el))
    }

    @Test fun validationRules() {
        assertTrue(Validation.loan(loan()).isEmpty())
        assertTrue(Validation.loan(loan(principal = "-5")).containsKey("principal"))
        assertTrue(Validation.loan(loan(firstEmiDate = "2023-12-01")).containsKey("firstEmiDate"))
        assertTrue(Validation.loan(loan(annualRate = "abc")).containsKey("annualRate"))
        assertTrue(Validation.loan(loan(startDate = "2024-02-30")).containsKey("startDate"))
        assertTrue(Validation.payment(pay(type = "emi", installmentNo = null, amount = "100.00")).containsKey("installmentNo"))
        assertTrue(Validation.payment(pay(installmentNo = 1, amount = "100.00", manual = true, allocPrincipal = "90.00", allocInterest = "20.00")).containsKey("allocPrincipal"))
        assertTrue(Validation.payment(pay(type = "missed", installmentNo = 1, amount = "5.00")).containsKey("amount"))
    }

    @Test fun csvRoundTripAndInjectionGuard() {
        val text = Csv.write(listOf(listOf("name", "note"), listOf("A, B", "=SUM(A1)"), listOf("q\"uote", "-12.5")))
        val rows = Csv.parse(text)
        assertEquals(listOf("A, B", "'=SUM(A1)"), rows[1])
        assertEquals(listOf("q\"uote", "-12.5"), rows[2])
    }

    /** Reads a backup written by the desktop app (see desktop tests/unit/crossplatform.test.ts). */
    @Test fun readsDesktopBackups() {
        val dir = fixturesDir() ?: return
        val plain = File(dir, "desktop-backup.json")
        val encrypted = File(dir, "desktop-backup-encrypted.emibackup")
        val expected = File(dir, "desktop-expected.json")
        if (!plain.exists()) return
        val snap = SnapshotCodec.parse(plain.readText())
        val enc = SnapshotCodec.parse(encrypted.readText(), "fixture-passphrase")
        assertEquals(snap.checksum, enc.checksum)
        // model parity: re-encoding through the Kotlin model loses no field
        assertEquals(snap.checksum, SnapshotCodec.checksumOf(snap.data))
        // one-time expenses and lending & borrowing written by the desktop app pass the Android checks
        assertEquals(null, Validation.snapshot(snap.data))
        assertEquals("once", snap.data.bills.first { it.id == "O1" }.frequency)
        assertEquals(listOf("DB1" to "borrowed", "DL1" to "lent"), snap.data.debts.map { it.id to it.direction })
        assertEquals(listOf("4000.00"), snap.data.debtRepayments.map { it.amount })
        assertEquals(true, snap.data.tombstones.any { it.table == "debts" && it.id == "DX1" })
        assertEquals(true, snap.data.notifications.any { it.category == "debt" })
        val exp = SnapshotCodec.json.parseToJsonElement(expected.readText()) as kotlinx.serialization.json.JsonObject
        val asOf = (exp["asOf"] as kotlinx.serialization.json.JsonPrimitive).content
        val loans = exp["loans"] as kotlinx.serialization.json.JsonObject
        for ((id, v) in loans) {
            val l = snap.data.loans.first { it.id == id }
            val s = Engine.compute(l, snap.data.adjustments, snap.data.payments, asOf).summary
            val e = v as kotlinx.serialization.json.JsonObject
            fun f(k: String) = (e[k] as kotlinx.serialization.json.JsonPrimitive).content
            assertEquals("$id outstanding", f("outstandingPrincipal"), s.outstandingPrincipal)
            assertEquals("$id totalPaid", f("totalPaid"), s.totalPaid)
            assertEquals("$id interestPaid", f("interestPaid"), s.interestPaid)
            assertEquals("$id remainingInterest", f("remainingInterest"), s.remainingInterest)
            assertEquals("$id closure", f("closureDate"), s.closureDate ?: "")
            assertEquals("$id installmentsPaid", f("installmentsPaid"), s.installmentsPaid.toString())
            assertEquals("$id dividends", f("dividends"), s.dividends)
        }
    }

    /** Writes a snapshot for the desktop app to verify (read by crossplatform.test.ts). */
    @Test fun writesAndroidSnapshotForDesktop() {
        val dir = fixturesDir() ?: return
        val d = data().copy(adjustments = listOf(Adjustment("A1", TS, TS, "L1", "2024-06-01", "rate", "11.5", null, null, "keep_emi", "android fixture")),
            // a one-time expense, lending & borrowing with a part repayment, a deleted entry and a sent lending reminder
            bills = listOf(Bill("AO1", TS, TS, "Phone repair", "other", "", "1200.00", false, "once", 20, "2024-07-20", null, true, true, null, "")),
            billPayments = listOf(BillPayment("AOP1", TS, TS, "AO1", "2024-07-20", "2024-07-20", "1200.00", "")),
            debts = listOf(Debt("AL1", TS, TS, "lent", "Phone friend", "5000.00", "2024-06-01", "2024-09-01", true, ""), Debt("AB1", TS, TS, "borrowed", "Phone uncle", "8000.00", "2024-05-01", null, false, "")),
            debtRepayments = listOf(DebtRepayment("ADR1", TS, TS, "AL1", "2024-07-01", "2500.00", "")),
            tombstones = listOf(Tombstone("AX1", "debts", TS)),
            notifications = listOf(NotificationRecord("AN1", TS, TS, "debt_due:AL1:2024-09-01", "debt", "Collect", "b", null, "2024-09-01T09:00", TS, "sent", null, "in_app", false, "android-fixture")))
        val snap = SnapshotCodec.build(d, "sync", app, "android-fixture", "Fixture phone")
        File(dir, "android-snapshot.json").writeText(SnapshotCodec.serialize(snap))
        File(dir, "android-snapshot-encrypted.emisync").writeText(SnapshotCodec.serialize(snap, "fixture-passphrase"))
        val s = Engine.compute(d.loans[0], d.adjustments, d.payments, "2024-08-15").summary
        File(dir, "android-expected.json").writeText("{\"asOf\":\"2024-08-15\",\"loanId\":\"L1\",\"outstandingPrincipal\":\"${s.outstandingPrincipal}\",\"remainingInterest\":\"${s.remainingInterest}\",\"closureDate\":\"${s.closureDate}\",\"checksum\":\"${snap.checksum}\"}")
        assertNotNull(SnapshotCodec.parse(File(dir, "android-snapshot.json").readText()))
    }

    private fun fixturesDir(): File? {
        var f: File? = File("").absoluteFile
        while (f != null) {
            val d = File(f, "fixtures")
            if (d.isDirectory && File(f, "desktop").isDirectory) return d
            f = f.parentFile
        }
        return null
    }
}
