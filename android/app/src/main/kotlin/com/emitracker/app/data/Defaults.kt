package com.emitracker.app.data

import com.emitracker.core.Adjustment
import com.emitracker.core.CustomReminder
import com.emitracker.core.Dates
import com.emitracker.core.Engine
import com.emitracker.core.Loan
import com.emitracker.core.Payment
import java.time.Instant
import java.util.UUID

val LOAN_COLORS = listOf("#4f8cff", "#34c38f", "#f1b44c", "#a78bfa", "#f46a6a", "#50a5f1", "#f78fb3", "#7dd3c0")

object Defaults {
    fun id() = UUID.randomUUID().toString()
    fun ts() = Instant.now().toString()

    fun loan(today: String, index: Int = 0): Loan {
        val first = Dates.addMonths(today, 1)
        val ts = ts()
        return Loan(
            id(), ts, ts, "", "Home", "", "", true, "home", "active", null, today, first, first.substring(8).toInt(), "", "", "", "", "floating",
            "reducing_monthly", "monthly", null, "rupee_nearest", 240, 0, "capitalize", "0.00", "0.00", "0.00", "0.00", "0", 0, "0.00",
            "reduce_tenure", "interest_principal_fees", 0, null, today, null, null, true, null, "", LOAN_COLORS[index % LOAN_COLORS.size],
        )
    }

    fun payment(loanId: String, today: String): Payment {
        val ts = ts()
        return Payment(id(), ts, ts, loanId, today, null, "emi", "", false, "0.00", "0.00", "0.00", "0.00", "", "", "", false, "active", "", null)
    }

    fun adjustment(loanId: String, today: String): Adjustment {
        val ts = ts()
        return Adjustment(id(), ts, ts, loanId, today, "rate", "", null, null, "keep_emi", "")
    }

    fun reminder(today: String): CustomReminder {
        val ts = ts()
        return CustomReminder(id(), ts, ts, "", "", today, "09:00", "none", null, true)
    }

    fun bill(today: String): com.emitracker.core.Bill {
        val ts = ts()
        return com.emitracker.core.Bill(id(), ts, ts, "", "electricity", "", "", false, "monthly", today.substring(8).toInt(), today, null, true, true, null, "")
    }

    fun billPayment(billId: String, dueDate: String, today: String, amount: String): com.emitracker.core.BillPayment {
        val ts = ts()
        return com.emitracker.core.BillPayment(id(), ts, ts, billId, dueDate, today, amount, "")
    }

    fun debt(today: String, direction: String = "lent"): com.emitracker.core.Debt {
        val ts = ts()
        return com.emitracker.core.Debt(id(), ts, ts, direction, "", "", today, null, true, "")
    }

    fun debtRepayment(debtId: String, today: String, amount: String): com.emitracker.core.DebtRepayment {
        val ts = ts()
        return com.emitracker.core.DebtRepayment(id(), ts, ts, debtId, today, amount, "")
    }
}

/** Optional, clearly labelled demo data generated relative to today ("Demo …" names). */
object DemoData {
    suspend fun load(repo: Repository, today: String) {
        fun mk(i: Int, name: String, category: String, lender: String, type: String, principal: String, rate: String, n: Int, monthsAgo: Long, day: Int, rateType: String = "fixed", lateFee: String = "0.00", grace: Int = 0): Loan {
            val start = Dates.addMonths(today, -monthsAgo, day)
            val base = Defaults.loan(today, i).copy(name = name, category = category, lender = lender, loanType = type, principal = principal, sanctionedAmount = principal,
                disbursedAmount = principal, annualRate = rate, totalInstallments = n, startDate = start, firstEmiDate = Dates.addMonths(start, 1, day), emiDueDay = day,
                sanctionDate = start, rateType = rateType, lateFee = lateFee, gracePeriodDays = grace, trackingStartDate = start, notes = "Demo data — safe to delete.")
            return base.copy(emiAmount = Engine.calculateEmi(principal, rate, n, "monthly", "reducing_monthly", "rupee_nearest"))
        }
        val loans = listOf(
            mk(0, "Demo Home Loan", "Home", "Demo Bank", "home", "4500000.00", "8.50", 240, 26, 5, "floating").copy(processingFee = "10000.00", sanctionedAmount = "5000000.00"),
            mk(1, "Demo Car Loan", "Vehicle", "Demo Finance", "vehicle", "800000.00", "9.25", 60, 14, 10, lateFee = "500.00", grace = 3),
            mk(2, "Demo Personal Loan", "Personal", "Demo Credit", "personal", "300000.00", "12.50", 36, 8, 20),
        )
        loans.forEach { repo.saveLoan(it) }
        loans.forEachIndexed { li, loan ->
            val rows = Engine.compute(loan, emptyList(), emptyList(), loan.startDate, contract = true, skipBaseline = true).rows.filter { it.dueDate < today }
            rows.forEachIndexed { ri, r ->
                if (li == 2 && ri == rows.lastIndex) return@forEachIndexed // leave one EMI unpaid to demonstrate overdue tracking
                val late = li == 1 && ri % 5 == 4
                repo.savePayment(Defaults.payment(loan.id, r.dueDate).copy(txnDate = if (late) Dates.addDays(r.dueDate, 6) else Dates.addDays(r.dueDate, -(ri % 3).toLong()),
                    installmentNo = r.no, amount = r.scheduledAmount, reference = "DEMO-${li + 1}-${r.no}", notes = "Demo payment"), allowDuplicate = true)
            }
        }
        repo.savePayment(Defaults.payment(loans[0].id, Dates.addMonths(today, -6, 15)).copy(type = "prepayment", amount = "200000.00", reference = "DEMO-PREPAY", notes = "Demo prepayment"), allowDuplicate = true)
        repo.saveAdjustment(Defaults.adjustment(loans[0].id, Dates.addMonths(today, -10, 1)).copy(annualRate = "8.75", note = "Demo repo-rate revision"))
    }
}
