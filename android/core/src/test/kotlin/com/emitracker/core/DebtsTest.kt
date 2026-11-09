package com.emitracker.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** One-time expenses and lending & borrowing: same expectations as desktop tests/unit/debts.test.ts. */
class DebtsTest {
    private val ts = "2026-01-01T00:00:00.000Z"
    private fun once(startDate: String = "2026-02-10") = Bill("O1", ts, ts, "Car service", "other", "", "4500.00", false, "once", 10, startDate, null, true, true, null, "")
    private fun debt(id: String = "D1", direction: String = "lent", person: String = "Ravi", amount: String = "10000.00", dueDate: String? = "2026-03-01", reminder: Boolean = true, updatedAt: String = ts) =
        Debt(id, ts, updatedAt, direction, person, amount, "2026-01-05", dueDate, reminder, "")
    private fun rp(id: String = "R1", debtId: String = "D1", amount: String = "4000.00") = DebtRepayment(id, ts, ts, debtId, "2026-02-01", amount, "")

    @Test fun oneTimeExpense() {
        assertEquals(emptyMap<String, String>(), Validation.bill(once()))
        assertEquals(listOf("2026-02-10"), Bills.dueDates(once(), "2026-01-01", "2026-12-31"))
        assertEquals(emptyList<String>(), Bills.dueDates(once(), "2026-03-01", "2026-12-31"))
        val feb = Bills.monthlyExpenses(emptyList(), emptyMap(), listOf(once()), emptyList(), "2026-02", "2026-02-05")
        assertEquals(listOf(listOf("Car service", "4500.00", "upcoming", "one-time")), feb.items.map { listOf(it.name, it.expected, it.status, it.detail) })
        assertEquals(0, Bills.monthlyExpenses(emptyList(), emptyMap(), listOf(once()), emptyList(), "2026-03", "2026-02-05").items.size)
        assertNull(Bills.nextDue(once(), listOf(BillPayment("P1", ts, ts, "O1", "2026-02-10", "2026-02-10", "4300.00", "")), "2026-02-12"))
        assertEquals("0.00", Money.money(Bills.monthlyAverage(listOf(once()))))
    }

    @Test fun validates() {
        assertEquals(emptyMap<String, String>(), Validation.debt(debt()))
        assertTrue("amount" in Validation.debt(debt(amount = "0.00")))
        assertTrue("person" in Validation.debt(debt(person = " ")))
        assertTrue("dueDate" in Validation.debt(debt(dueDate = "2025-12-31")))
    }

    @Test fun summaryAndTotals() {
        Debts.summary(debt(), listOf(rp()), "2026-02-10").let { assertEquals(listOf("4000.00", "6000.00", "pending"), listOf(it.repaid, it.pending, it.status)) }
        assertEquals("due", Debts.summary(debt(), listOf(rp()), "2026-03-01").status)
        assertEquals("overdue", Debts.summary(debt(), listOf(rp()), "2026-03-02").status)
        assertEquals("settled", Debts.summary(debt(), listOf(rp(), rp("R2", amount = "6000.00")), "2026-04-01").status)
        assertEquals("pending", Debts.summary(debt(dueDate = null), emptyList(), "2030-01-01").status)
        val all = listOf(debt(), debt("D2", direction = "borrowed", person = "Uncle", amount = "25000.00"), debt("D3", amount = "500.00"))
        val rows = all.map { it to Debts.summary(it, listOf(rp(), rp("R3", debtId = "D3", amount = "500.00")), "2026-02-10") }
        // the totals follow what is listed: open entries, settled ones, or everything
        val open = Debts.stats(rows.filter { it.second.status != "settled" })
        assertEquals(DebtSideStats("10000.00", "4000.00", "6000.00", 1), open["lent"])
        assertEquals(DebtSideStats("25000.00", "0.00", "25000.00", 1), open["borrowed"])
        assertEquals(DebtSideStats("500.00", "500.00", "0.00", 1), Debts.stats(rows.filter { it.second.status == "settled" })["lent"])
        assertEquals(DebtSideStats("10500.00", "4500.00", "6000.00", 2), Debts.stats(rows)["lent"])
    }

    @Test fun spendingByDay() {
        val home = loan(id = "H", name = "Home")
        val chit = loan(id = "K", name = "Chit").copy(loanType = "chit_fund")
        val pays = listOf(pay(id = "p1", loanId = "H", txnDate = "2026-02-05", amount = "10000.00"), pay(id = "p2", loanId = "K", txnDate = "2026-02-05", amount = "4600.00"),
            pay(id = "p3", loanId = "H", txnDate = "2026-02-06", amount = "500.00").copy(status = "reversed"))
        val rent = Bill("B1", ts, ts, "Rent", "rent", "", "15000.00", false, "monthly", 5, "2026-01-05", null, true, true, null, "")
        val bps = listOf(BillPayment("BP1", ts, ts, "B1", "2026-02-05", "2026-02-05", "15000.00", ""), BillPayment("OP1", ts, ts, "O1", "2026-02-10", "2026-02-07", "4300.00", ""))
        val days = Spending.byDay(listOf(home, chit), pays, listOf(rent, once()), bps, "2026-02-01", "2026-02-28")
        assertEquals(listOf("loan" to "10000.00", "chit" to "4600.00", "bill" to "15000.00"), days["2026-02-05"]!!.map { it.kind to it.amount })
        assertEquals(null, days["2026-02-06"]) // reversed payments are not spending
        assertEquals("one_time", days["2026-02-07"]!!.single().kind) // by the day it was paid, not its due date
        assertEquals("29600.00", Spending.totals(days["2026-02-05"]!!)["all"])
        // one loan selected: only that loan, no bills
        assertEquals(listOf("H"), Spending.byDay(listOf(home, chit), pays, listOf(rent), bps, "2026-02-01", "2026-02-28", listOf("H")).values.flatten().map { it.refId })
    }

    @Test fun reminders() {
        fun at(now: String, repayments: List<DebtRepayment> = emptyList(), d: Debt = debt()) =
            Reminders.due(PlannerInput(now, ReminderSettings(quietEnabled = false), emptyList(), emptyMap(), emptyList(), emptyList(), emptyList(), "2026-02-28",
                { "₹$it" }, { it }, debts = listOf(d), debtRepayments = repayments)).filter { it.category == "debt" }
        assertEquals(listOf("debt:D1:2026-03-01:1" to "Collect ₹10000.00 from Ravi tomorrow"), at("2026-02-28T09:00").map { it.key to it.title })
        assertTrue("Collect ₹6000.00 from Ravi today" in at("2026-03-01T09:00", listOf(rp())).map { it.title })
        assertTrue("debt_overdue:D1:2026-03-01" in at("2026-03-02T09:00", d = debt(direction = "borrowed")).map { it.key })
        assertEquals(0, at("2026-03-01T09:00", listOf(rp(amount = "10000.00"))).size)
        assertEquals(0, at("2026-03-01T09:00", d = debt(reminder = false)).size)
    }

    @Test fun mergeAndOldSnapshots() {
        val phone = SnapshotData(debts = listOf(debt(amount = "12000.00", updatedAt = "2026-02-02T00:00:00.000Z")), debtRepayments = listOf(rp()))
        val (data, _) = SnapshotCodec.merge(SnapshotData(debts = listOf(debt())), phone)
        assertEquals("12000.00", data.debts[0].amount)
        assertEquals(1, data.debtRepayments.size)
        val (gone, _) = SnapshotCodec.merge(data, SnapshotData(tombstones = listOf(Tombstone("D1", "debts", "2026-03-01T00:00:00.000Z"))))
        assertEquals(0, gone.debts.size)
        assertEquals(0, gone.debtRepayments.size)
        // a snapshot written before lending existed has no such keys and still parses
        val old = SnapshotCodec.json.decodeFromString(SnapshotData.serializer(), """{"loans":[],"tombstones":[]}""")
        assertEquals(0, old.debts.size)
    }
}
