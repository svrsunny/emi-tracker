package com.emitracker.core

const val TS = "2024-01-01T00:00:00.000Z"

fun loan(
    id: String = "L1", principal: String = "100000.00", annualRate: String = "12", totalInstallments: Int = 12, emiAmount: String? = null,
    startDate: String = "2024-01-01", firstEmiDate: String = "2024-02-01", emiDueDay: Int = 1, frequency: String = "monthly",
    interestMethod: String = "reducing_monthly", moratoriumPeriods: Int = 0, moratoriumTreatment: String = "capitalize",
    lateFee: String = "0.00", penalRate: String = "0", gracePeriodDays: Int = 0, prepaymentEffect: String = "reduce_tenure",
    installmentsPaidBeforeTracking: Int = 0, openingOutstanding: String? = null, trackingStartDate: String = "2024-01-01",
    lenderOutstanding: String? = null, lenderOutstandingDate: String? = null, name: String = "Test loan", status: String = "active",
) = Loan(
    id, TS, TS, name, "Home", "Bank", "", true, "home", status, null, startDate, firstEmiDate, emiDueDay, principal, principal, principal,
    annualRate, "fixed", interestMethod, frequency, emiAmount, "paisa", totalInstallments, moratoriumPeriods, moratoriumTreatment, "0.00", "0.00",
    "0.00", lateFee, penalRate, gracePeriodDays, "0.00", prepaymentEffect, "interest_principal_fees", installmentsPaidBeforeTracking,
    openingOutstanding, trackingStartDate, lenderOutstanding, lenderOutstandingDate, true, null, "", "#4f8cff",
)

private var seq = 0
fun pay(
    loanId: String = "L1", txnDate: String = "2024-02-01", installmentNo: Int? = null, type: String = "emi", amount: String = "0.00",
    status: String = "active", manual: Boolean = false, allocPrincipal: String = "0.00", allocInterest: String = "0.00", id: String? = null,
): Payment {
    seq++
    return Payment(id ?: "P$seq", "2024-01-01T00:00:%02d.000Z".format(seq % 60), TS, loanId, txnDate, installmentNo, type, amount, manual,
        allocPrincipal, allocInterest, "0.00", "0.00", "", "", "", false, status, "", null)
}

fun adj(effectiveDate: String, kind: String = "rate", annualRate: String? = null, emiAmount: String? = null, remaining: Int? = null, recalc: String = "keep_emi"): Adjustment {
    seq++
    return Adjustment("A$seq", TS, TS, "L1", effectiveDate, kind, annualRate, emiAmount, remaining, recalc, "")
}

fun payAllUntil(rows: List<ScheduleRow>, until: String, loanId: String = "L1") =
    rows.filter { it.dueDate <= until }.map { pay(loanId = loanId, installmentNo = it.no, txnDate = it.dueDate, amount = it.scheduledAmount) }

fun sum(xs: List<String>) = xs.fold(java.math.BigDecimal.ZERO) { s, x -> s + x.toBigDecimal() }
