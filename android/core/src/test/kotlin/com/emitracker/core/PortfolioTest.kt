package com.emitracker.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Dashboard + heatmap aggregation, forecasts and reminder planning. */
class PortfolioTest {
    private fun portfolio(asOf: String): Portfolio {
        val a = loan(id = "A", name = "A")
        val b = loan(id = "B", name = "B", principal = "50000.00", firstEmiDate = "2024-02-10", emiDueDay = 10, totalInstallments = 6).copy(sanctionedAmount = "60000.00")
        val ca = Engine.compute(a, emptyList(), emptyList(), "2023-12-31")
        val cb = Engine.compute(b, emptyList(), emptyList(), "2023-12-31")
        val pays = payAllUntil(ca.rows, "2024-04-01", "A") + payAllUntil(cb.rows, "2024-03-10", "B") + pay(loanId = "B", type = "prepayment", txnDate = "2024-03-10", amount = "1000.00")
        val loans = listOf(a, b)
        return Portfolio(loans, loans.associate { it.id to Engine.compute(it, emptyList(), pays, asOf) }, pays)
    }

    @Test fun dashboardReconciles() {
        val p = portfolio("2024-04-05")
        val t = Aggregate.dashboard(p, "2024-04-05")
        assertEquals(Money.money(sum(p.comps.values.map { it.summary.totalPaid })), t.totalPaid)
        assertEquals(Money.money(sum(p.payments.map { it.amount })), t.totalPaid)
        assertEquals(t.originalPrincipal, Money.money(t.principalRepaid.toBigDecimal() + t.outstandingPrincipal.toBigDecimal()))
        assertEquals("160000.00", t.sanctioned)
        assertEquals(Money.money(t.remainingOutflow.toBigDecimal() - t.outstandingPrincipal.toBigDecimal()), Money.money(t.remainingInterest.toBigDecimal() + t.remainingFees.toBigDecimal()))
        assertEquals("B", t.nextEmi?.loanName)
        assertEquals("2024-04-10", t.nextEmi?.date)
        assertEquals("2025-01-01", t.allClosedBy)
        assertEquals("50000.00", Aggregate.dashboard(p, "2024-04-05", Filters(loanIds = listOf("B"))).originalPrincipal)
    }

    @Test fun heatmapsReconcileAndDistinguishNoData() {
        val p = portfolio("2024-04-05")
        val days = Aggregate.dailyCells(p, "2024-01-01", "2024-04-30", "2024-04-05")
        assertEquals(Money.money(sum(p.payments.map { it.amount })), Money.money(days.values.fold(Money.ZERO) { s, c -> s + c.amount }))
        val mar10 = days.getValue("2024-03-10")
        assertEquals(2, mar10.count)
        assertEquals(CalendarState.extra, mar10.state)
        val early = Aggregate.dailyCells(p, "2023-12-01", "2024-01-31", "2024-04-05")
        assertFalse(early.getValue("2023-12-15").hasData)
        assertEquals(CalendarState.no_data, early.getValue("2023-12-15").state)
        assertTrue(early.getValue("2024-01-15").hasData)
        val months = Aggregate.monthlyCells(p, "2024-01", "2024-06", "2024-04-05")
        assertEquals(2, months.getValue("2024-02").installmentsPaid)
        assertEquals(100, months.getValue("2024-02").completionPct)
        assertNull(months.getValue("2024-06").completionPct)
        assertEquals(2, Aggregate.monthlyCells(portfolio("2024-05-20"), "2024-05", "2024-05", "2024-05-20").getValue("2024-05").missedOrOverdue)
        assertEquals(listOf("FY 2023-24", "FY 2024-25"), Aggregate.financialYears(p).map { it.fy })
        assertEquals(0, Aggregate.intensity(0.0, listOf(0.0, 100.0, 200.0, 300.0)))
        assertEquals(2, Aggregate.intensity(150.0, listOf(0.0, 100.0, 200.0, 300.0)))
        assertEquals(4, Aggregate.intensity(1000.0, listOf(0.0, 100.0, 200.0, 300.0)))
    }

    @Test fun scenarios() {
        val l = loan(principal = "1000000.00", annualRate = "10", totalInstallments = 120)
        val contract = Engine.compute(l, emptyList(), emptyList(), "2023-12-31")
        val pays = payAllUntil(contract.rows, "2024-12-01")
        val asOf = "2024-12-05"
        assertEquals(0, Forecast.run(l, emptyList(), pays, asOf, Scenario()).monthsSaved)
        val emi = Forecast.run(l, emptyList(), pays, asOf, Scenario(emiIncrease = "2000"))
        assertTrue(emi.monthsSaved > 10)
        assertEquals("2000.00", emi.extraMonthlyCash)
        assertTrue(Forecast.run(l, emptyList(), pays, asOf, Scenario(extraMonthly = "2000")).monthsSaved > 10)
        val one = Forecast.run(l, emptyList(), pays, asOf, Scenario(oneTimeAmount = "100000", oneTimeDate = "2025-01-15"))
        val annual = Forecast.run(l, emptyList(), pays, asOf, Scenario(annualAmount = "50000", annualMonth = 4))
        assertTrue(annual.monthsSaved > one.monthsSaved)
        val rate = Forecast.run(l, emptyList(), pays, asOf, Scenario(newRate = "12"))
        assertTrue(rate.interestSaved.toBigDecimal().signum() < 0)
        val both = Forecast.run(l, emptyList(), pays, asOf, Scenario(emiIncrease = "2000", extraMonthly = "2000"))
        assertTrue(both.interestSaved.toBigDecimal() > emi.interestSaved.toBigDecimal())
    }

    private val rl = loan()
    private fun input(now: String, settings: ReminderSettings = ReminderSettings(quietEnabled = false), history: List<HistoryItem> = emptyList(),
                      comps: Map<String, LoanComputation>? = null, loans: List<Loan> = listOf(rl), lastBackup: String? = now.substring(0, 10), custom: List<CustomReminder> = emptyList()) =
        PlannerInput(now, settings, loans, comps ?: mapOf(rl.id to Engine.compute(rl, emptyList(), emptyList(), now.substring(0, 10))), emptyList(), custom, history, lastBackup, { "₹$it" }, { it })

    @Test fun reminderPlanning() {
        assertTrue(Reminders.due(input("2024-01-25T08:59")).none { it.category == "emi_upcoming" })
        val at9 = Reminders.due(input("2024-01-25T09:00"))
        assertTrue(at9.any { it.key == "emi_upcoming:L1:1:2024-02-01:7" })
        // dedupe
        assertTrue(Reminders.due(input("2024-01-25T09:30", history = at9.map { HistoryItem(it.key, "sent", null) })).isEmpty())
        // snooze
        val key = "emi_upcoming:L1:1:2024-02-01:7"
        val snoozed = listOf(HistoryItem(key, "snoozed", "2024-01-25T10:00"))
        assertFalse(Reminders.due(input("2024-01-25T09:30", history = snoozed)).any { it.key == key })
        assertTrue(Reminders.due(input("2024-01-25T10:01", history = snoozed)).any { it.key == key })
        // overdue repeats
        val keys = Reminders.due(input("2024-02-20T10:00", settings = ReminderSettings(quietEnabled = false, overdueRepeatDays = 2, maxRepeats = 2, catchUpDays = 30)))
            .filter { it.category == "emi_overdue" && it.key.contains(":1:") }.map { it.key }
        assertEquals(listOf("emi_overdue:L1:1:2024-02-01:0", "emi_overdue:L1:1:2024-02-01:1"), keys)
        // paid installment -> no reminder
        val paid = Engine.compute(rl, emptyList(), listOf(pay(installmentNo = 1, txnDate = "2024-01-20", amount = "8884.88", type = "advance")), "2024-01-25")
        assertFalse(Reminders.due(input("2024-01-25T09:00", comps = mapOf(rl.id to paid))).any { it.key.startsWith("emi_upcoming:L1:1:") })
        // catch-up + late flag
        assertTrue(Reminders.due(input("2024-01-27T12:00")).first { it.key == key }.late)
        assertFalse(Reminders.due(input("2024-01-31T12:00", settings = ReminderSettings(quietEnabled = false, catchUpDays = 2))).any { it.key == key })
        // per-loan opt-out
        assertFalse(Reminders.due(input("2024-01-25T09:00", loans = listOf(rl.copy(reminderEnabled = false)))).any { it.loanId == "L1" })
        // backup reminder
        assertTrue(Reminders.due(input("2024-01-25T09:00", lastBackup = "2024-01-10")).any { it.category == "backup" })
    }

    @Test fun quietHoursWeekdaysAndCustomRepeats() {
        val s = ReminderSettings(quietEnabled = true, quietStart = "22:00", quietEnd = "08:00")
        assertEquals("2024-01-26T08:00", Reminders.adjustTime("2024-01-25T23:00", s))
        assertEquals("2024-01-25T08:00", Reminders.adjustTime("2024-01-25T06:00", s))
        val wk = s.copy(quietEnabled = false, weekdays = listOf(false, true, true, true, true, true, false))
        assertEquals("2024-01-29T09:00", Reminders.adjustTime("2024-01-27T09:00", wk))
        val r = CustomReminder("c1", TS, TS, "Insurance", "", "2024-01-31", "10:00", "monthly", null, true)
        assertEquals(listOf("2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30"), Reminders.customOccurrences(r, "2024-01-01", "2024-04-30"))
    }
}
