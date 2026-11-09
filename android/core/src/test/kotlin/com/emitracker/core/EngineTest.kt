package com.emitracker.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EngineTest {
    private fun c(l: Loan, a: List<Adjustment> = emptyList(), p: List<Payment> = emptyList(), asOf: String) = Engine.compute(l, a, p, asOf)

    // ---------------------------------------------------------------- known EMI examples
    @Test fun emi_100k_12pct_12m() = assertEquals("8884.88", Engine.calculateEmi("100000", "12", 12, "monthly", "reducing_monthly", "paisa"))
    @Test fun emi_10L_10pct_120m() = assertEquals("13215.07", Engine.calculateEmi("1000000", "10", 120, "monthly", "reducing_monthly", "paisa"))
    @Test fun emi_50L_8_5pct_240m_rounding() {
        assertEquals("43391.16", Engine.calculateEmi("5000000", "8.5", 240, "monthly", "reducing_monthly", "paisa"))
        assertEquals("43391.00", Engine.calculateEmi("5000000", "8.5", 240, "monthly", "reducing_monthly", "rupee_nearest"))
        assertEquals("43392.00", Engine.calculateEmi("5000000", "8.5", 240, "monthly", "reducing_monthly", "rupee_up"))
    }
    @Test fun emi_zero_rate() = assertEquals("10000.00", Engine.calculateEmi("120000", "0", 12, "monthly", "reducing_monthly", "paisa"))
    @Test fun emi_flat() = assertEquals("5000.00", Engine.calculateEmi("100000", "10", 24, "monthly", "flat", "paisa"))

    // ---------------------------------------------------------------- contract schedule
    @Test fun contractScheduleAmortizes() {
        val r = c(loan(), asOf = "2023-12-31")
        assertEquals(12, r.rows.size)
        assertEquals("0.00", r.rows[11].closingPrincipal)
        assertEquals("100000.00", Money.money(sum(r.rows.map { it.principalDue })))
        assertEquals("1000.00", r.rows[0].interest)
        assertEquals("7884.88", r.rows[0].principalDue)
        assertEquals("92115.12", r.rows[0].closingPrincipal)
        for (row in r.rows) assertEquals(row.scheduledAmount, Money.money(row.interest.toBigDecimal() + row.principalDue.toBigDecimal()))
        assertTrue(Math.abs(sum(r.rows.map { it.interest }).toDouble() - 6618.55) < 0.1)
        assertEquals("2025-01-01", r.summary.closureDate)
        assertEquals((11 downTo 0).toList(), r.rows.map { it.remainingInstallments })
    }

    // ---------------------------------------------------------------- dates
    @Test fun monthEndAndLeapYear() {
        val l = loan(firstEmiDate = "2024-01-31", emiDueDay = 31)
        assertEquals(listOf("2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30"), (0..3).map { Engine.dueDateFor(l, it) })
        assertEquals("2023-02-28", Engine.dueDateFor(loan(firstEmiDate = "2023-01-30", emiDueDay = 30), 1))
        assertEquals("2024-07-15", Engine.dueDateFor(loan(frequency = "quarterly", firstEmiDate = "2024-01-15", emiDueDay = 15), 2))
        assertEquals("2024-03-04", Engine.dueDateFor(loan(frequency = "weekly", firstEmiDate = "2024-02-26"), 1))
    }
    @Test fun dailyInterestCountsLeapDay() {
        val r = c(loan(interestMethod = "reducing_daily", startDate = "2024-01-31", firstEmiDate = "2024-02-29", emiDueDay = 29, emiAmount = "9000.00"), asOf = "2024-01-01")
        assertEquals("953.42", r.rows[0].interest)
    }

    // ---------------------------------------------------------------- recorded payments
    private val base = loan()
    private val contract = Engine.compute(base, emptyList(), emptyList(), "2023-12-31")

    @Test fun onTimePaymentsReconcile() {
        val pays = payAllUntil(contract.rows, "2024-06-01")
        val r = c(base, p = pays, asOf = "2024-06-15")
        assertTrue(r.rows.take(5).all { it.status == RowStatus.paid })
        assertEquals(RowStatus.upcoming, r.rows[5].status)
        assertEquals(5, r.summary.installmentsPaid)
        assertEquals(7, r.summary.installmentsRemaining)
        val s = r.summary
        assertEquals(contract.rows[4].closingPrincipal, s.outstandingPrincipal)
        assertEquals(s.totalPaid, Money.money(s.principalRepaid.toBigDecimal() + s.interestPaid.toBigDecimal() + s.feesPaid.toBigDecimal() + s.penaltiesPaid.toBigDecimal() + s.unapplied.toBigDecimal()))
        assertEquals("100000.00", Money.money(s.principalRepaid.toBigDecimal() + s.outstandingPrincipal.toBigDecimal()))
        assertEquals(s.outstandingPrincipal, s.remainingPrincipal)
    }

    @Test fun pastDueIsNeverAssumedPaid() {
        val r = c(base, asOf = "2024-03-15")
        assertEquals(RowStatus.overdue, r.rows[0].status)
        assertEquals(2, r.summary.overdueCount)
        assertEquals("100000.00", r.summary.outstandingPrincipal)
    }

    @Test fun dueTodayAndGrace() {
        assertEquals(RowStatus.due, c(base, asOf = "2024-02-01").rows[0].status)
        val g = loan(gracePeriodDays = 5)
        assertEquals(RowStatus.due, c(g, asOf = "2024-02-04").rows[0].status)
        assertEquals(RowStatus.overdue, c(g, asOf = "2024-02-07").rows[0].status)
    }

    @Test fun partialPayment() {
        val r = c(base, p = listOf(pay(installmentNo = 1, amount = "5000.00", type = "partial")), asOf = "2024-02-10")
        assertEquals(RowStatus.partially_paid, r.rows[0].status)
        assertEquals("3884.88", r.rows[0].shortfall)
        assertEquals("96000.00", r.summary.outstandingPrincipal)
    }

    @Test fun missedThenLate() {
        val missed = pay(installmentNo = 1, type = "missed", txnDate = "2024-02-05")
        assertEquals(RowStatus.missed, c(base, p = listOf(missed), asOf = "2024-02-20").rows[0].status)
        val r = c(base, p = listOf(missed, pay(installmentNo = 1, txnDate = "2024-02-20", amount = "8884.88")), asOf = "2024-02-25")
        assertEquals(RowStatus.paid, r.rows[0].status)
        assertTrue(r.rows[0].late)
    }

    @Test fun lateFeesAndPenalInterest() {
        val l = loan(lateFee = "500.00", penalRate = "24")
        val r = c(l, p = listOf(pay(installmentNo = 1, txnDate = "2024-03-02", amount = "8884.88")), asOf = "2024-03-10")
        assertEquals("675.26", r.rows[0].feesCharged)
        assertEquals("1227.84", r.summary.chargesDue)
        assertTrue(r.summary.isEstimate)
    }

    @Test fun advancePaymentIsPrepaid() {
        val r = c(base, p = listOf(pay(installmentNo = 1, amount = "8884.88"), pay(installmentNo = 2, txnDate = "2024-02-10", amount = "8884.88", type = "advance")), asOf = "2024-02-15")
        assertEquals(RowStatus.prepaid, r.rows[1].status)
        assertEquals(2, r.summary.installmentsPaid)
        assertEquals("100000.00", Money.money(r.summary.principalRepaid.toBigDecimal() + r.summary.outstandingPrincipal.toBigDecimal()))
    }

    @Test fun excessIsExtraPrincipal() {
        val r = c(base, p = listOf(pay(installmentNo = 1, amount = "10884.88")), asOf = "2024-02-05")
        assertEquals("2000.00", r.rows[0].extraPrincipal)
        assertEquals("90115.12", r.summary.outstandingPrincipal)
    }

    @Test fun waiverAndReversal() {
        assertEquals(RowStatus.waived, c(base, p = listOf(pay(installmentNo = 1, type = "waiver")), asOf = "2024-02-10").rows[0].status)
        assertEquals(RowStatus.overdue, c(base, p = listOf(pay(installmentNo = 1, amount = "8884.88", status = "reversed")), asOf = "2024-02-10").rows[0].status)
    }

    @Test fun manualAllocation() {
        val p = pay(installmentNo = 1, amount = "8884.88", manual = true, allocPrincipal = "7900.00", allocInterest = "984.88")
        val r = c(base, p = listOf(p), asOf = "2024-02-10")
        assertEquals("92100.00", r.summary.outstandingPrincipal)
        assertEquals("7900.00", Money.money(r.allocations.getValue(p.id).principal))
    }

    // ---------------------------------------------------------------- prepayment, foreclosure
    private val big = loan(principal = "1000000.00", annualRate = "10", totalInstallments = 120)
    private val bigContract = Engine.compute(big, emptyList(), emptyList(), "2023-12-31")

    @Test fun prepaymentReducesTenure() {
        assertEquals("2034-01-01", bigContract.summary.closureDate)
        val pays = payAllUntil(bigContract.rows, "2025-01-01") + pay(type = "prepayment", txnDate = "2025-01-01", amount = "200000.00")
        val r = c(big, p = pays, asOf = "2025-01-15")
        assertTrue(r.summary.periodsSaved > 20)
        assertTrue(r.summary.interestSaved.toBigDecimal() > java.math.BigDecimal(100000))
        assertEquals("13215.07", r.summary.currentEmi)
    }

    @Test fun prepaymentReducesEmi() {
        val pays = payAllUntil(bigContract.rows, "2025-01-01") + pay(type = "prepayment", txnDate = "2025-01-01", amount = "200000.00")
        val r = c(big.copy(prepaymentEffect = "reduce_emi"), p = pays, asOf = "2025-01-15")
        assertTrue(r.summary.currentEmi.toBigDecimal() < java.math.BigDecimal("13215.07"))
        assertEquals("2034-01-01", r.summary.closureDate)
    }

    @Test fun foreclosureClosesLoan() {
        val paid = payAllUntil(bigContract.rows, "2024-06-01")
        val bal = bigContract.rows[4].closingPrincipal.toBigDecimal()
        val fc = pay(type = "foreclosure", txnDate = "2024-06-15", amount = Money.money(bal + java.math.BigDecimal(5000)))
        val r = c(big, p = paid + fc, asOf = "2024-06-20")
        assertEquals("2024-06-15", r.summary.closureDate)
        assertTrue(r.summary.computedClosed)
        assertEquals("0.00", r.summary.outstandingPrincipal)
        assertEquals(RowStatus.cancelled, r.rows.last().status)
        assertEquals(0, r.summary.installmentsRemaining)
    }

    @Test fun closureIsAmortizedNotDivided() {
        val r = c(big, p = payAllUntil(bigContract.rows, "2024-12-01"), asOf = "2024-12-15")
        val naive = Math.ceil(r.summary.outstandingPrincipal.toDouble() / 13215.07).toInt()
        assertTrue(r.summary.installmentsRemaining > naive)
    }

    @Test fun longArrearsStillConverge() {
        val l = big.copy(emiAmount = "13215.07")
        val r = c(l, p = listOf(pay(installmentNo = 1, amount = "13215.07")), asOf = "2026-10-28")
        assertFalse(r.summary.nonConverging)
        assertTrue(r.summary.overdueCount > 30)
        val s = r.summary
        assertEquals(Money.money(s.remainingCashOutflow), Money.money(s.outstandingPrincipal.toBigDecimal() + s.remainingInterest.toBigDecimal() + s.remainingFees.toBigDecimal()))
    }

    // ---------------------------------------------------------------- variable rates
    @Test fun rateRiseKeepEmiExtendsTenure() {
        val r = c(big, a = listOf(adj("2024-06-01", annualRate = "12")), asOf = "2023-12-31")
        assertTrue(r.rows.count { it.kind == "emi" } > 120)
        assertEquals("12.00", r.rows[6].rate)
        assertEquals("10.00", r.rows[4].rate)
    }
    @Test fun rateChangeRecomputeEmi() {
        val r = c(big, a = listOf(adj("2024-06-01", annualRate = "12", recalc = "recompute_emi")), asOf = "2023-12-31")
        assertEquals(120, r.rows.count { it.kind == "emi" })
        assertTrue(r.rows[6].emi.toBigDecimal() > r.rows[0].emi.toBigDecimal())
    }
    @Test fun midPeriodRateSplitsInterest() {
        val r = c(big, a = listOf(adj("2024-02-16", annualRate = "12")), asOf = "2023-12-31")
        val row = r.rows[1]
        val b = row.openingPrincipal.toBigDecimal()
        val exp = b.toDouble() * 0.10 / 12 * 15 / 29 + b.toDouble() * 0.12 / 12 * 14 / 29
        assertEquals(Money.money(java.math.BigDecimal(exp)), row.interest)
    }
    @Test fun emiChangeAndRestructure() {
        val r = c(big, a = listOf(adj("2024-03-15", kind = "emi", emiAmount = "20000.00")), asOf = "2023-12-31")
        assertEquals("20000.00", r.rows[2].emi)
        assertTrue(r.summary.closureDate!! < "2034-01-01")
        val rs = c(big, a = listOf(adj("2024-06-15", kind = "restructure", annualRate = "9", remaining = 60)), asOf = "2023-12-31")
        assertEquals(65, rs.rows.count { it.kind == "emi" })
    }

    // ---------------------------------------------------------------- moratorium / history
    @Test fun moratorium() {
        val cap = c(loan(moratoriumPeriods = 3), asOf = "2023-12-31")
        assertTrue(cap.rows.take(3).all { it.kind == "moratorium" && it.status == RowStatus.moratorium })
        assertTrue(cap.rows[3].openingPrincipal.toBigDecimal() > java.math.BigDecimal(100000))
        val io = c(loan(moratoriumPeriods = 2, moratoriumTreatment = "interest_only"), asOf = "2023-12-31")
        assertEquals("1000.00", io.rows[0].scheduledAmount)
        assertEquals("100000.00", io.rows[2].openingPrincipal)
    }
    @Test fun preTrackingAndOpeningOverride() {
        val r = c(loan(installmentsPaidBeforeTracking = 6, trackingStartDate = "2024-07-15"), asOf = "2024-07-20")
        assertTrue(r.rows.take(6).all { it.status == RowStatus.assumed_paid && it.isEstimated })
        assertEquals(r.summary.principalRepaid, r.summary.principalRepaidEstimated)
        val o = c(loan(installmentsPaidBeforeTracking = 6, openingOutstanding = "52000.00", trackingStartDate = "2024-07-15"), asOf = "2024-07-20")
        assertEquals("52000.00", o.summary.outstandingPrincipal)
    }
    @Test fun unrecordedHistoryIsFlagged() {
        val r = c(loan(trackingStartDate = "2024-05-01"), asOf = "2024-05-10")
        assertEquals(RowStatus.unrecorded, r.rows[0].status)
        assertEquals(RowStatus.overdue, r.rows[3].status)
        assertEquals(3, r.summary.unrecordedCount)
    }
    @Test fun lenderReconciliation() {
        val r = c(loan(lenderOutstanding = "93000.00", lenderOutstandingDate = "2024-02-10"), p = listOf(pay(installmentNo = 1, amount = "8884.88")), asOf = "2024-02-15")
        assertEquals("92115.12", r.summary.reconciliation?.calculated)
        assertEquals("884.88", r.summary.reconciliation?.difference)
    }
    @Test fun nonConverging() {
        val r = c(loan(emiAmount = "500.00"), asOf = "2023-12-31")
        assertTrue(r.summary.nonConverging)
        assertNull(r.summary.closureDate)
    }
}
