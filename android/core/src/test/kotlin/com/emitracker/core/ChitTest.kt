package com.emitracker.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Chit funds: same expectations as desktop tests/unit/chit.test.ts. */
class ChitTest {
    private val chit = loan(principal = "100000.00", annualRate = "0", emiAmount = "5000.00", totalInstallments = 20, interestMethod = "flat",
        startDate = "2024-02-01", firstEmiDate = "2024-02-01", trackingStartDate = "2024-02-01", name = "Ramesh chit").copy(loanType = "chit_fund", category = "Chit fund")

    @Test fun validType() = assertEquals(emptyMap<String, String>(), Validation.loan(chit))

    @Test fun fullInstallmentNoInterest() {
        val c = Engine.compute(chit, emptyList(), emptyList(), "2024-01-15")
        assertEquals(20, c.rows.count { it.kind == "emi" })
        assertTrue(c.rows.all { it.scheduledAmount == "5000.00" && it.interest == "0.00" })
        assertEquals("100000.00", c.summary.remainingCashOutflow)
        assertFalse(c.summary.warnings.any { it.contains("Flat-rate") })
        assertFalse(c.summary.isEstimate)
    }

    @Test fun dividends() {
        val pays = listOf(pay(installmentNo = 1, txnDate = "2024-02-01", amount = "5000.00"), pay(installmentNo = 2, txnDate = "2024-03-01", amount = "4600.00"),
            pay(installmentNo = 3, txnDate = "2024-04-02", amount = "4250.00"))
        val c = Engine.compute(chit, emptyList(), pays, "2024-04-10")
        assertEquals(listOf(RowStatus.paid, RowStatus.paid, RowStatus.paid), c.rows.take(3).map { it.status })
        assertEquals(listOf("0.00", "400.00", "750.00"), c.rows.take(3).map { it.dividend })
        assertEquals("0.00", c.rows[1].shortfall)
        assertEquals(RowStatus.upcoming, c.rows[3].status)
        assertEquals("5000.00", c.rows[3].scheduledAmount)
        val s = c.summary
        assertEquals("1150.00", s.dividends)
        assertEquals("13850.00", s.totalPaid)
        assertEquals(3, s.installmentsPaid)
        assertEquals(17, s.installmentsRemaining)
        assertEquals("85000.00", s.outstandingPrincipal)
        assertEquals(0, s.overdueCount)
        assertEquals("85000.00", s.remainingCashOutflow)
        assertEquals(20, c.rows.count { it.kind == "emi" && it.status != RowStatus.cancelled })
    }

    @Test fun unpaidMonthStillOverdue() {
        val c = Engine.compute(chit, emptyList(), listOf(pay(installmentNo = 1, txnDate = "2024-02-01", amount = "4800.00")), "2024-03-20")
        assertEquals(RowStatus.overdue, c.rows[1].status)
        assertEquals("5000.00", c.summary.overdueAmount)
    }

    @Test fun otherLoansKeepPartialPayments() {
        val c = Engine.compute(chit.copy(loanType = "personal"), emptyList(), listOf(pay(installmentNo = 1, txnDate = "2024-02-01", amount = "4600.00")), "2024-02-10")
        assertEquals(RowStatus.partially_paid, c.rows[0].status)
        assertEquals("0.00", c.rows[0].dividend)
        assertEquals("0.00", c.summary.dividends)
    }
}
