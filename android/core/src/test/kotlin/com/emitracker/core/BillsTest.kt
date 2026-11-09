package com.emitracker.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Bills: same expectations as desktop tests/unit/bills.test.ts. */
class BillsTest {
    private val ts = "2026-01-01T00:00:00.000Z"
    private fun bill(id: String = "B1", name: String = "Rent", amount: String = "15000.00", frequency: String = "monthly", dueDay: Int = 31, startDate: String = "2026-01-31",
                     endDate: String? = null, variable: Boolean = false, reminder: Boolean = true) =
        Bill(id, ts, ts, name, "rent", "", amount, variable, frequency, dueDay, startDate, endDate, true, reminder, null, "")
    private fun bp(id: String = "BP1", billId: String = "B1", dueDate: String = "2026-01-31", amount: String = "15000.00") = BillPayment(id, ts, ts, billId, dueDate, "2026-01-30", amount, "")

    @Test fun validates() {
        assertEquals(emptyMap<String, String>(), Validation.bill(bill()))
        assertTrue("amount" in Validation.bill(bill(amount = "0.00")))
        assertTrue("endDate" in Validation.bill(bill(endDate = "2025-01-01")))
    }

    @Test fun dueDates() {
        assertEquals(listOf("2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"), Bills.dueDates(bill(), "2026-01-01", "2026-04-30"))
        assertEquals(listOf("2026-01-31", "2026-04-30", "2026-07-31", "2026-10-31"), Bills.dueDates(bill(frequency = "quarterly"), "2026-01-01", "2026-12-31"))
        assertEquals(listOf("2026-01-31", "2026-02-28"), Bills.dueDates(bill(endDate = "2026-03-15"), "2026-01-01", "2026-12-31"))
        assertEquals(listOf("2024-02-29", "2025-02-28", "2026-02-28"), Bills.dueDates(bill(frequency = "yearly", startDate = "2024-02-29", dueDay = 29), "2024-01-01", "2026-12-31"))
    }

    @Test fun nextDue() {
        assertEquals("2026-01-31" to true, Bills.nextDue(bill(), emptyList(), "2026-03-10"))
        assertEquals("2026-03-31" to false, Bills.nextDue(bill(), listOf(bp(), bp("BP2", dueDate = "2026-02-28")), "2026-03-10"))
    }

    @Test fun monthlyExpenses() {
        val home = loan(id = "H", name = "Home", principal = "120000.00", annualRate = "0", interestMethod = "flat", emiAmount = "10000.00", totalInstallments = 12,
            firstEmiDate = "2026-02-05", emiDueDay = 5, startDate = "2026-01-05", trackingStartDate = "2026-01-05")
        val chit = loan(id = "K", name = "Chit", principal = "100000.00", annualRate = "0", interestMethod = "flat", emiAmount = "5000.00", totalInstallments = 20,
            firstEmiDate = "2026-02-10", emiDueDay = 10, startDate = "2026-02-10", trackingStartDate = "2026-02-10").copy(loanType = "chit_fund")
        val pays = listOf(pay(loanId = "K", installmentNo = 1, txnDate = "2026-02-10", amount = "4600.00"))
        val comps = mapOf(home.id to Engine.compute(home, emptyList(), emptyList(), "2026-02-20"), chit.id to Engine.compute(chit, emptyList(), pays, "2026-02-20"))
        val electricity = bill(id = "B2", name = "Electricity", amount = "1800.00", variable = true, dueDay = 15, startDate = "2026-01-15")
        val m = Bills.monthlyExpenses(listOf(home, chit), comps, listOf(bill(), electricity), listOf(bp(billId = "B2", dueDate = "2026-02-15", amount = "2140.00")), "2026-02", "2026-02-20")
        assertEquals(listOf(
            listOf("loan", "Home", "2026-02-05", "10000.00", "0.00", "10000.00", "overdue"),
            listOf("chit", "Chit", "2026-02-10", "5000.00", "4600.00", "0.00", "paid"),
            listOf("bill", "Electricity", "2026-02-15", "2140.00", "2140.00", "0.00", "paid"),
            listOf("bill", "Rent", "2026-02-28", "15000.00", "0.00", "15000.00", "upcoming"),
        ), m.items.map { listOf(it.kind, it.name, it.dueDate, it.expected, it.paid, it.remaining, it.status) })
        assertEquals(ExpenseTotals("32140.00", "6740.00", "25000.00", 4), m.totals["all"])
        assertEquals("4600.00", m.totals["chit"]!!.paid)
        assertEquals("17140.00", m.totals["bill"]!!.expected)
        val march = Bills.monthlyExpenses(listOf(home, chit), comps, emptyList(), emptyList(), "2026-03", "2026-02-20")
        assertEquals(listOf(listOf("Home", "upcoming", "10000.00"), listOf("Chit", "upcoming", "5000.00")), march.items.map { listOf(it.name, it.status, it.remaining) })
    }

    @Test fun reminders() {
        val b = bill(dueDay = 28, startDate = "2026-02-28")
        fun keys(now: String, payments: List<BillPayment> = emptyList(), bills: List<Bill> = listOf(b)) =
            Reminders.due(PlannerInput(now, ReminderSettings(quietEnabled = false, offsets = listOf(3)), emptyList(), emptyMap(), emptyList(), emptyList(), emptyList(), "2026-02-01",
                { "₹$it" }, { it }, bills, payments)).map { it.key }
        assertTrue("bill:B1:2026-02-28:3" in keys("2026-02-25T09:00"))
        assertTrue("bill_due:B1:2026-02-28" in keys("2026-02-28T09:00"))
        assertTrue("bill_overdue:B1:2026-02-28" in keys("2026-03-01T09:00"))
        assertEquals(emptyList<String>(), keys("2026-03-01T09:00", listOf(bp(dueDate = "2026-02-28"))).filter { it.startsWith("bill") })
        assertEquals(emptyList<String>(), keys("2026-02-28T09:00", bills = listOf(b.copy(reminderEnabled = false))).filter { it.startsWith("bill") })
    }

    @Test fun merge() {
        val prefs = StampedPreferences(Preferences(), ts)
        val phone = SnapshotData(bills = listOf(bill().copy(updatedAt = "2026-02-02T00:00:00.000Z", amount = "16000.00")), billPayments = listOf(bp()), preferences = prefs)
        val pc = SnapshotData(bills = listOf(bill()), preferences = prefs)
        val (data, _) = SnapshotCodec.merge(pc, phone)
        assertEquals("16000.00", data.bills.single().amount)
        assertEquals(1, data.billPayments.size)
        val (deleted, _) = SnapshotCodec.merge(data, SnapshotData(tombstones = listOf(Tombstone("B1", "bills", "2026-03-01T00:00:00.000Z")), preferences = prefs))
        assertEquals(emptyList<Bill>(), deleted.bills)
        assertEquals(emptyList<BillPayment>(), deleted.billPayments)
    }
}
