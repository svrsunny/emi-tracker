package com.emitracker.core

import com.emitracker.core.Money.dec
import com.emitracker.core.Money.money
import java.time.YearMonth

/**
 * What-if scenarios expressed as simulated future events (ids prefixed "sim:") run through
 * the same engine, so projections follow the identical interest rules. Never persisted.
 */
data class Scenario(
    val name: String = "Continue current EMI",
    val emiIncrease: String = "",
    val extraMonthly: String = "",
    val oneTimeAmount: String = "",
    val oneTimeDate: String? = null,
    val annualAmount: String = "",
    val annualMonth: Int = 4,
    val newRate: String = "",
    val rateRecalc: String = "keep_emi",
    val prepaymentEffect: String = "loan_default",
)

data class ScenarioResult(
    val name: String,
    val closureDate: String?,
    val remainingInstallments: Int,
    val remainingInterest: String,
    val totalRepayment: String,
    val monthsSaved: Int,
    val interestSaved: String,
    val extraMonthlyCash: String,
    val nonConverging: Boolean,
    val computation: LoanComputation,
)

object Forecast {
    private const val TS = "1970-01-01T00:00:00.000Z"

    private fun simPayment(loanId: String, n: Int, date: String, amount: String) = Payment(
        id = "sim:$n", createdAt = TS, updatedAt = TS, loanId = loanId, txnDate = date, installmentNo = null, type = "prepayment", amount = amount,
        manualAllocation = false, allocPrincipal = "0.00", allocInterest = "0.00", allocFees = "0.00", allocPenalty = "0.00", reference = "",
        notes = "simulated", attachmentPath = "", reconciled = false, status = "active", reversalReason = "", reversedAt = null,
    )

    private fun simAdj(loanId: String, n: Int, date: String, kind: String, rate: String? = null, emi: String? = null, recalc: String = "keep_emi") = Adjustment(
        id = "sim-adj:$n", createdAt = "9999-12-31T00:00:00.000Z", updatedAt = TS, loanId = loanId, effectiveDate = date, kind = kind,
        annualRate = rate, emiAmount = emi, remainingInstallments = null, recalc = recalc, note = "simulated",
    )

    private fun monthsBetween(a: String, b: String): Int {
        val ya = YearMonth.parse(a.substring(0, 7)); val yb = YearMonth.parse(b.substring(0, 7))
        return (yb.year - ya.year) * 12 + (yb.monthValue - ya.monthValue)
    }

    fun run(loan: Loan, adjustments: List<Adjustment>, payments: List<Payment>, asOf: String, s: Scenario, base: LoanComputation? = null): ScenarioResult {
        val current = base ?: Engine.compute(loan, adjustments, payments, asOf, skipBaseline = true, skipReconciliation = true)
        val effLoan = if (s.prepaymentEffect == "loan_default") loan else loan.copy(prepaymentEffect = s.prepaymentEffect)
        val future = current.rows.filter { it.dueDate > asOf && it.isProjected }
        val sims = mutableListOf<Payment>()
        val simAdjs = mutableListOf<Adjustment>()
        var n = 0
        val start = Dates.addDays(asOf, 1)
        if (dec(s.newRate).signum() > 0) simAdjs.add(simAdj(loan.id, n++, start, "rate", rate = dec(s.newRate).toPlainString(), recalc = s.rateRecalc))
        if (dec(s.emiIncrease).signum() > 0) simAdjs.add(simAdj(loan.id, n++, start, "emi", emi = money(dec(current.summary.currentEmi).add(dec(s.emiIncrease)))))
        if (dec(s.extraMonthly).signum() > 0) for (r in future) if (r.kind == "emi") sims.add(simPayment(loan.id, n++, r.dueDate, money(s.extraMonthly)))
        if (dec(s.oneTimeAmount).signum() > 0) sims.add(simPayment(loan.id, n++, if (s.oneTimeDate != null && s.oneTimeDate > asOf) s.oneTimeDate else start, money(s.oneTimeAmount)))
        if (dec(s.annualAmount).signum() > 0 && future.isNotEmpty()) {
            val last = future.last().dueDate
            for (y in start.substring(0, 4).toInt()..last.substring(0, 4).toInt()) {
                val ym = YearMonth.of(y, s.annualMonth)
                val d = ym.atDay(minOf(loan.emiDueDay, ym.lengthOfMonth())).toString()
                if (d > asOf && d <= last) sims.add(simPayment(loan.id, n++, d, money(s.annualAmount)))
            }
        }
        val comp = Engine.compute(effLoan, adjustments + simAdjs, payments + sims, asOf, skipBaseline = true, skipReconciliation = true)
        val sc = comp.summary
        val monthsSaved = if (current.summary.closureDate != null && sc.closureDate != null) monthsBetween(sc.closureDate, current.summary.closureDate) else 0
        return ScenarioResult(
            s.name, sc.closureDate, sc.installmentsRemaining, sc.remainingInterest, sc.remainingCashOutflow, monthsSaved,
            money(dec(current.summary.remainingInterest).subtract(dec(sc.remainingInterest))), money(dec(s.emiIncrease).add(dec(s.extraMonthly))),
            sc.nonConverging, comp,
        )
    }

    data class Combined(val allClosedBy: String?, val remainingOutflow: String, val remainingInterest: String, val anyOpenEnded: Boolean)

    fun combined(comps: Collection<LoanComputation>): Combined {
        var latest: String? = null
        var open = false
        var out = Money.ZERO
        var interest = Money.ZERO
        for (c in comps) {
            if (c.summary.nonConverging) open = true
            c.summary.closureDate?.let { if (latest == null || it > latest!!) latest = it }
            out = out.add(dec(c.summary.remainingCashOutflow))
            interest = interest.add(dec(c.summary.remainingInterest))
        }
        return Combined(if (open) null else latest, money(out), money(interest), open)
    }
}
