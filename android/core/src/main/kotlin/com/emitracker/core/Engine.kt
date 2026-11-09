package com.emitracker.core

import com.emitracker.core.Money.EPS
import com.emitracker.core.Money.ZERO
import com.emitracker.core.Money.dec
import com.emitracker.core.Money.money
import com.emitracker.core.Money.round2
import java.math.BigDecimal

/*
 * EMI / amortization engine — a faithful port of the desktop engine (src/shared/engine.ts),
 * verified by the same test cases. The engine walks the schedule period by period, processes
 * dated events (prepayments, foreclosure, fee/penalty payments, rate/EMI/restructure
 * adjustments) chronologically while accruing interest per segment, posts each period's
 * interest at the due date, and allocates the payments recorded against each installment.
 * Rows due after `asOf` without recorded payments are projected as paid on the due date.
 */

enum class RowStatus(val label: String) {
    upcoming("Upcoming"), due("Due"), paid("Paid"), partially_paid("Partially paid"), overdue("Overdue"), missed("Missed"),
    prepaid("Prepaid"), waived("Waived"), cancelled("Cancelled"), unrecorded("No record"), assumed_paid("Paid (assumed)"), moratorium("Moratorium");
}

val DONE_STATUSES = setOf(RowStatus.paid, RowStatus.prepaid, RowStatus.assumed_paid)
val OPEN_STATUSES = setOf(RowStatus.upcoming, RowStatus.due, RowStatus.partially_paid, RowStatus.overdue, RowStatus.missed, RowStatus.unrecorded)

data class ScheduleRow(
    val no: Int,
    val kind: String, // moratorium | emi
    val emiNo: Int?,
    val dueDate: String,
    val rate: String,
    val openingPrincipal: String,
    val emi: String,
    val scheduledAmount: String,
    val interest: String,
    val principalDue: String,
    val paidAmount: String,
    val projectedAmount: String,
    val paidPrincipal: String,
    val paidInterest: String,
    val feesCharged: String,
    val feesPaid: String,
    val extraPrincipal: String,
    val capitalized: String,
    var closingPrincipal: String,
    val shortfall: String,
    val status: RowStatus,
    val late: Boolean,
    val isProjected: Boolean,
    val isEstimated: Boolean,
    var remainingInstallments: Int,
    val lastPaymentDate: String?,
    val paymentIds: List<String>,
    val dividend: String = "0.00", // chit fund: full installment minus the amount actually paid (settled, not owed)
)

data class Allocation(
    var principal: BigDecimal = ZERO,
    var interest: BigDecimal = ZERO,
    var fees: BigDecimal = ZERO,
    var penalty: BigDecimal = ZERO,
    var unapplied: BigDecimal = ZERO,
    val rowNo: Int?,
    val simulated: Boolean,
)

data class DueRef(val no: Int, val date: String, val amount: String, val status: RowStatus)
data class Reconciliation(val lenderOutstanding: String, val date: String, val calculated: String, val difference: String)

data class LoanSummary(
    val principal: String,
    val sanctioned: String,
    val disbursed: String,
    val capitalizedInterest: String,
    val balanceAdjustment: String,
    val principalRepaid: String,
    val principalRepaidEstimated: String,
    val interestPaid: String,
    val interestPaidEstimated: String,
    val feesPaid: String,
    val penaltiesPaid: String,
    val upfrontCharges: String,
    val unapplied: String,
    val totalPaid: String,
    val totalPaidRecorded: String,
    val outstandingPrincipal: String,
    val interestArrears: String,
    val accruedInterest: String,
    val chargesDue: String,
    val payoffEstimate: String,
    val totalInstallments: Int,
    val installmentsPaid: Int,
    val installmentsRemaining: Int,
    val currentInstallment: Int?,
    val currentEmi: String,
    val remainingScheduledAmount: String,
    val remainingPrincipal: String,
    val remainingInterest: String,
    val remainingFees: String,
    val remainingCashOutflow: String,
    val nextDue: DueRef?,
    val nextUpcoming: DueRef?,
    val overdueCount: Int,
    val overdueAmount: String,
    val unrecordedCount: Int,
    val lastPaymentDate: String?,
    val closureDate: String?,
    val computedClosed: Boolean,
    val progressPct: Double,
    val baselineClosureDate: String?,
    val baselineTotalInterest: String,
    val lifetimeInterest: String,
    val interestSaved: String,
    val periodsSaved: Int,
    val nonConverging: Boolean,
    val isEstimate: Boolean,
    val warnings: List<String>,
    val reconciliation: Reconciliation?,
    val dividends: String = "0.00", // chit fund dividends
)

data class LoanComputation(val loanId: String, val rows: List<ScheduleRow>, val allocations: Map<String, Allocation>, val summary: LoanSummary)

object Engine {
    fun dueDateFor(loan: Loan, index: Int): String {
        if (index == 0) return loan.firstEmiDate
        val months = PERIOD_MONTHS[loan.frequency]
        if (months != null) return Dates.addMonths(loan.firstEmiDate, (index * months).toLong(), loan.emiDueDay)
        return Dates.addDays(loan.firstEmiDate, (index * if (loan.frequency == "weekly") 7 else 14).toLong())
    }

    fun periodicRate(annualPct: BigDecimal, frequency: String): BigDecimal = annualPct.d(BigDecimal(100)).d(FREQUENCY_PERIODS.getValue(frequency))

    fun calculateEmi(principal: String, annualRate: String, n: Int, frequency: String, method: String, rounding: String): String {
        val p = dec(principal)
        val r = dec(annualRate)
        if (n <= 0 || p.signum() <= 0) return "0.00"
        if (method == "flat") {
            val years = BigDecimal(n).d(FREQUENCY_PERIODS.getValue(frequency))
            return money(Money.roundEmi(p.add(p.m(r).d(BigDecimal(100)).m(years)).d(n), rounding))
        }
        return money(Money.roundEmi(Money.emiFormula(p, periodicRate(r, frequency), n), rounding))
    }

    private sealed class Ev(val date: String, val order: Int) {
        class Adj(date: String, val adj: Adjustment) : Ev(date, 1)
        class Pay(date: String, val pay: Payment) : Ev(date, 0)
        class AsOf(date: String) : Ev(date, 9)
    }

    private fun isSim(p: Payment) = p.id.startsWith("sim:")

    fun compute(
        loan: Loan,
        adjustmentsIn: List<Adjustment>,
        paymentsIn: List<Payment>,
        asOf: String,
        contract: Boolean = false,
        skipBaseline: Boolean = false,
        skipReconciliation: Boolean = false,
    ): LoanComputation {
        val ppy = FREQUENCY_PERIODS.getValue(loan.frequency)
        val flat = loan.interestMethod == "flat"
        val chit = loan.loanType == "chit_fund"
        val grace = maxOf(0, loan.gracePeriodDays).toLong()
        val mor = maxOf(0, loan.moratoriumPeriods)
        val preTrackEmi = if (contract) 0 else maxOf(0, loan.installmentsPaidBeforeTracking)
        val lateFee = dec(loan.lateFee)
        val penalRate = dec(loan.penalRate)
        val hundred = BigDecimal(100)

        val adjustments = adjustmentsIn.filter { it.loanId == loan.id }
            .sortedWith(compareBy<Adjustment> { it.effectiveDate }.thenBy { it.createdAt })
        val payments = if (contract) paymentsIn.filter { isSim(it) && it.loanId == loan.id }
        else paymentsIn.filter { it.status == "active" && it.loanId == loan.id }

        val instPays = sortedMapOf<Int, MutableList<Payment>>()
        val markers = mutableMapOf<Int, MutableSet<String>>()
        val events = mutableListOf<Ev>()
        for (p in payments) {
            when {
                p.type in INSTALLMENT_PAYMENT_TYPES && p.installmentNo != null -> instPays.getOrPut(p.installmentNo) { mutableListOf() }.add(p)
                p.type in MARKER_TYPES && p.installmentNo != null -> markers.getOrPut(p.installmentNo) { mutableSetOf() }.add(p.type)
                p.type in setOf("prepayment", "foreclosure", "fee", "penalty") -> events.add(Ev.Pay(p.txnDate, p))
            }
        }
        for (list in instPays.values) list.sortWith(compareBy<Payment> { it.txnDate }.thenBy { it.createdAt })
        for (a in adjustments) events.add(Ev.Adj(a.effectiveDate, a))
        events.sortWith(compareBy<Ev> { it.date }.thenBy { it.order }.thenBy { if (it is Ev.Pay) it.pay.createdAt else "" })

        // ---- running state
        var balance = dec(loan.principal)
        var rate = dec(loan.annualRate)
        var emi: BigDecimal? = if (!loan.emiAmount.isNullOrBlank() && dec(loan.emiAmount).pos) dec(loan.emiAmount) else null
        val emiWasProvided = emi != null
        var needRecompute = emi == null
        var plannedTotal = maxOf(1, loan.totalInstallments)
        var emiRowsDone = 0
        var arrears = ZERO
        var feesDue = ZERO
        var penaltyDue = ZERO
        var flatBase: BigDecimal? = null
        var accrued = ZERO
        var prev = loan.startDate
        var balanceAdjustment = ZERO
        var capitalizedActual = ZERO
        var accruedAtAsOf: BigDecimal? = null
        var arrearsSnapshot = ZERO
        var closed = false
        var closedDate: String? = null
        var nonConverging = false
        var estimatedCharges = false

        var dividends = ZERO
        var recPrincipal = ZERO; var recInterest = ZERO; var recFees = ZERO; var recPenalty = ZERO; var recUnapplied = ZERO; var recTotal = ZERO
        var estPrincipal = ZERO; var estInterest = ZERO
        var projPrincipal = ZERO; var projInterest = ZERO; var projPayments = ZERO
        var allInterest = ZERO
        val allocations = linkedMapOf<String, Allocation>()

        fun book(p: Payment, rowNo: Int?, part: String, amt: BigDecimal) {
            if (amt.signum() <= 0) return
            val a = allocations.getOrPut(p.id) { Allocation(rowNo = rowNo, simulated = isSim(p)) }
            when (part) {
                "principal" -> a.principal = a.principal.add(amt)
                "interest" -> a.interest = a.interest.add(amt)
                "fees" -> a.fees = a.fees.add(amt)
                "penalty" -> a.penalty = a.penalty.add(amt)
                else -> a.unapplied = a.unapplied.add(amt)
            }
            if (part == "interest") allInterest = allInterest.add(amt)
            if (isSim(p)) {
                projPayments = projPayments.add(amt)
                if (part == "principal") projPrincipal = projPrincipal.add(amt)
                if (part == "interest") projInterest = projInterest.add(amt)
                return
            }
            when (part) {
                "principal" -> recPrincipal = recPrincipal.add(amt)
                "interest" -> recInterest = recInterest.add(amt)
                "fees" -> recFees = recFees.add(amt)
                "penalty" -> recPenalty = recPenalty.add(amt)
                else -> recUnapplied = recUnapplied.add(amt)
            }
        }

        fun segment(from: String, to: String, periodDays: Long): BigDecimal {
            if (flat || balance.signum() <= 0) return ZERO
            val days = Dates.diffDays(from, to)
            if (days <= 0) return ZERO
            if (loan.interestMethod == "reducing_daily") return balance.m(rate).d(hundred).m(days.toInt()).d(365)
            return balance.m(rate).d(hundred).d(ppy).m(days.toInt()).d(BigDecimal(periodDays))
        }

        val rows = mutableListOf<ScheduleRow>()
        var evIdx = 0
        val cap = mor + plannedTotal + 1200
        val asOfOutside = asOf < loan.startDate

        var i = 1
        while (i <= cap && !closed) {
            val due = dueDateFor(loan, i - 1)
            val periodDays = maxOf(1L, Dates.diffDays(prev, due))
            val openingPrincipal = balance
            var extraPrincipal = ZERO
            var cursor = prev
            val isMor = i <= mor
            val emiNo = if (isMor) null else i - mor

            val periodEvents = mutableListOf<Ev>()
            while (evIdx < events.size && (events[evIdx].date < due || (events[evIdx].date == due && events[evIdx] is Ev.Pay))) periodEvents.add(events[evIdx++])
            if (!asOfOutside && prev < asOf && asOf < due) {
                periodEvents.add(Ev.AsOf(asOf))
                periodEvents.sortWith(compareBy<Ev> { it.date }.thenBy { it.order })
            }

            for (ev in periodEvents) {
                if (closed) {
                    if (ev is Ev.Pay) book(ev.pay, null, "unapplied", dec(ev.pay.amount))
                    continue
                }
                val at = if (ev.date > cursor) ev.date else cursor
                accrued = accrued.add(segment(cursor, at, periodDays))
                cursor = at
                when (ev) {
                    is Ev.AsOf -> accruedAtAsOf = round2(accrued)
                    is Ev.Adj -> {
                        val a = ev.adj
                        if ((a.kind == "rate" || a.kind == "restructure") && !a.annualRate.isNullOrBlank()) rate = dec(a.annualRate)
                        if (a.kind == "emi" && !a.emiAmount.isNullOrBlank()) {
                            emi = dec(a.emiAmount); needRecompute = false
                        } else if (a.kind == "restructure") {
                            if (a.remainingInstallments != null && a.remainingInstallments > 0) plannedTotal = emiRowsDone + a.remainingInstallments
                            if (!a.emiAmount.isNullOrBlank() && dec(a.emiAmount).pos) { emi = dec(a.emiAmount); needRecompute = false } else needRecompute = true
                        } else if (a.kind == "rate" && a.recalc == "recompute_emi") needRecompute = true
                    }
                    is Ev.Pay -> {
                        val p = ev.pay
                        var rem = dec(p.amount)
                        if (p.manualAllocation) {
                            val ap = minD(dec(p.allocPrincipal), balance)
                            balance = balance.subtract(ap); extraPrincipal = extraPrincipal.add(ap); book(p, i, "principal", ap)
                            val ai = dec(p.allocInterest)
                            arrears = maxD(ZERO, arrears.subtract(ai)); book(p, i, "interest", ai)
                            feesDue = maxD(ZERO, feesDue.subtract(dec(p.allocFees))); book(p, i, "fees", dec(p.allocFees))
                            penaltyDue = maxD(ZERO, penaltyDue.subtract(dec(p.allocPenalty))); book(p, i, "penalty", dec(p.allocPenalty))
                            book(p, i, "unapplied", rem.subtract(ap).subtract(ai).subtract(dec(p.allocFees)).subtract(dec(p.allocPenalty)))
                        } else when (p.type) {
                            "fee" -> { feesDue = maxD(ZERO, feesDue.subtract(rem)); book(p, i, "fees", rem) }
                            "penalty" -> { penaltyDue = maxD(ZERO, penaltyDue.subtract(rem)); book(p, i, "penalty", rem) }
                            "prepayment" -> {
                                val ap = minD(rem, balance)
                                balance = balance.subtract(ap); extraPrincipal = extraPrincipal.add(ap); book(p, i, "principal", ap)
                                rem = rem.subtract(ap)
                                val ai = minD(rem, arrears.add(round2(accrued)))
                                if (ai.pos) {
                                    val fromArrears = minD(ai, arrears)
                                    arrears = arrears.subtract(fromArrears)
                                    accrued = maxD(ZERO, accrued.subtract(ai.subtract(fromArrears)))
                                    book(p, i, "interest", ai); rem = rem.subtract(ai)
                                }
                                book(p, i, "unapplied", rem)
                                if (ap.pos && loan.prepaymentEffect == "reduce_emi") needRecompute = true
                            }
                            "foreclosure" -> {
                                val payPen = minD(rem, penaltyDue); penaltyDue = penaltyDue.subtract(payPen); rem = rem.subtract(payPen); book(p, i, "penalty", payPen)
                                val payFee = minD(rem, feesDue); feesDue = feesDue.subtract(payFee); rem = rem.subtract(payFee); book(p, i, "fees", payFee)
                                val interestNow = arrears.add(round2(accrued))
                                val ai = minD(rem, interestNow)
                                val fromArrears = minD(ai, arrears)
                                arrears = arrears.subtract(fromArrears)
                                accrued = maxD(ZERO, round2(accrued).subtract(ai.subtract(fromArrears)))
                                rem = rem.subtract(ai); book(p, i, "interest", ai)
                                val ap = minD(rem, balance)
                                balance = balance.subtract(ap); extraPrincipal = extraPrincipal.add(ap); rem = rem.subtract(ap); book(p, i, "principal", ap)
                                book(p, i, "unapplied", rem)
                                if (balance <= EPS && arrears <= EPS && accrued <= EPS) {
                                    closed = true; closedDate = p.txnDate; balance = ZERO; accrued = ZERO
                                }
                            }
                        }
                    }
                }
            }

            if (closed && closedDate != null && closedDate!! <= due) {
                rows.add(row(i, isMor, emiNo, due, rate, openingPrincipal, emi ?: ZERO, ZERO, ZERO, ZERO, ZERO, ZERO, ZERO, ZERO, ZERO, ZERO,
                    extraPrincipal, ZERO, ZERO, ZERO, RowStatus.cancelled, false, due > asOf, false, closedDate, emptyList()))
                for ((no, list) in instPays) if (no >= i) for (p in list) book(p, no, "unapplied", dec(p.amount))
                break
            }

            accrued = accrued.add(segment(cursor, due, periodDays))

            // ---- EMI determination
            if (!isMor && balance.pos && (needRecompute || emi == null)) {
                val remaining = maxOf(1, plannedTotal - emiRowsDone)
                emi = if (flat) {
                    flatBase = balance
                    val years = BigDecimal(remaining).d(ppy)
                    Money.roundEmi(balance.add(balance.m(rate).d(hundred).m(years)).d(remaining), loan.emiRounding)
                } else Money.roundEmi(Money.emiFormula(balance, periodicRate(rate, loan.frequency), remaining), loan.emiRounding)
                needRecompute = false
            }
            if (flat && !isMor && flatBase == null) flatBase = balance

            val interestRow: BigDecimal = when {
                flat && !isMor -> if (balance.pos && flatBase != null) round2(flatBase!!.m(rate).d(hundred).d(ppy)) else ZERO
                flat && isMor -> round2(balance.m(rate).d(hundred).d(ppy))
                else -> round2(accrued)
            }
            accrued = ZERO

            val emiNow = emi ?: ZERO
            var principalDue = ZERO
            val scheduled: BigDecimal
            if (isMor) {
                scheduled = if (loan.moratoriumTreatment == "interest_only") interestRow else ZERO
            } else {
                principalDue = minD(balance, maxD(ZERO, emiNow.subtract(interestRow)))
                val lastPlanned = emiRowsDone + 1 >= plannedTotal
                val residual = balance.subtract(principalDue)
                if (balance.add(interestRow) <= emiNow || (lastPlanned && residual <= emiNow.d(2))) principalDue = balance
                scheduled = interestRow.add(principalDue)
            }

            // ---- allocation against the row
            var interestOut = arrears.add(interestRow)
            var rowInterestUnpaid = interestRow
            var principalDueUnpaid = principalDue
            var paidAmount = ZERO
            var dividend = ZERO
            var projectedAmount = ZERO
            var paidPrincipal = ZERO
            var paidInterest = ZERO
            var feesPaid = ZERO
            var lastPaymentDate: String? = null
            var paidByGrace = ZERO
            var fullPaidDate: String? = null
            val graceDate = Dates.addDays(due, grace)
            val rowPays = instPays[i] ?: emptyList<Payment>()
            val preTracked = !contract && rowPays.isEmpty() && (if (isMor) preTrackEmi > 0 else (emiNo ?: 0) <= preTrackEmi)
            val paymentIds = mutableListOf<String>()

            fun payInterest(amt: BigDecimal): BigDecimal {
                val x = minD(amt, interestOut)
                interestOut = interestOut.subtract(x)
                rowInterestUnpaid = minD(rowInterestUnpaid, interestOut)
                paidInterest = paidInterest.add(x)
                return x
            }
            fun payScheduledPrincipal(amt: BigDecimal): BigDecimal {
                val x = minD(amt, minD(principalDueUnpaid, balance))
                principalDueUnpaid = principalDueUnpaid.subtract(x)
                balance = balance.subtract(x)
                paidPrincipal = paidPrincipal.add(x)
                return x
            }
            fun payCharges(p: Payment, amt: BigDecimal): BigDecimal {
                val pen = minD(amt, penaltyDue); penaltyDue = penaltyDue.subtract(pen); book(p, i, "penalty", pen)
                val fee = minD(amt.subtract(pen), feesDue); feesDue = feesDue.subtract(fee); book(p, i, "fees", fee)
                feesPaid = feesPaid.add(pen).add(fee)
                return pen.add(fee)
            }

            if (preTracked) {
                val amt = if (isMor) (if (loan.moratoriumTreatment == "interest_only") interestOut else ZERO) else interestOut.add(principalDue)
                val xi = payInterest(amt)
                val xp = payScheduledPrincipal(amt.subtract(xi))
                estInterest = estInterest.add(xi); estPrincipal = estPrincipal.add(xp); allInterest = allInterest.add(xi)
                paidAmount = xi.add(xp)
                fullPaidDate = due
            } else {
                for (p in rowPays) {
                    paymentIds.add(p.id)
                    var rem = dec(p.amount)
                    paidAmount = paidAmount.add(rem)
                    if (lastPaymentDate == null || p.txnDate > lastPaymentDate!!) lastPaymentDate = p.txnDate
                    if (p.manualAllocation) {
                        val ai = dec(p.allocInterest)
                        val xi = minD(ai, interestOut)
                        interestOut = interestOut.subtract(xi)
                        rowInterestUnpaid = minD(rowInterestUnpaid, interestOut)
                        paidInterest = paidInterest.add(ai)
                        book(p, i, "interest", ai)
                        val ap = minD(dec(p.allocPrincipal), balance)
                        val sched = minD(ap, principalDueUnpaid)
                        principalDueUnpaid = principalDueUnpaid.subtract(sched)
                        balance = balance.subtract(ap)
                        paidPrincipal = paidPrincipal.add(sched)
                        extraPrincipal = extraPrincipal.add(ap.subtract(sched))
                        book(p, i, "principal", ap)
                        feesDue = maxD(ZERO, feesDue.subtract(dec(p.allocFees)))
                        penaltyDue = maxD(ZERO, penaltyDue.subtract(dec(p.allocPenalty)))
                        book(p, i, "fees", dec(p.allocFees)); book(p, i, "penalty", dec(p.allocPenalty))
                        feesPaid = feesPaid.add(dec(p.allocFees)).add(dec(p.allocPenalty))
                        book(p, i, "unapplied", rem.subtract(ai).subtract(dec(p.allocPrincipal)).subtract(dec(p.allocFees)).subtract(dec(p.allocPenalty)).add(dec(p.allocPrincipal).subtract(ap)))
                    } else {
                        if (loan.allocationOrder == "fees_interest_principal") rem = rem.subtract(payCharges(p, rem))
                        val xi = payInterest(rem); rem = rem.subtract(xi); book(p, i, "interest", xi)
                        val xp = payScheduledPrincipal(rem); rem = rem.subtract(xp); book(p, i, "principal", xp)
                        if (loan.allocationOrder == "interest_principal_fees") rem = rem.subtract(payCharges(p, rem))
                        val extra = minD(rem, balance)
                        if (extra.pos) {
                            balance = balance.subtract(extra); extraPrincipal = extraPrincipal.add(extra); book(p, i, "principal", extra); rem = rem.subtract(extra)
                            if (loan.prepaymentEffect == "reduce_emi") needRecompute = true
                        }
                        book(p, i, "unapplied", rem)
                    }
                    if (p.txnDate <= graceDate) paidByGrace = paidByGrace.add(dec(p.amount))
                    if (fullPaidDate == null && rowInterestUnpaid.add(principalDueUnpaid) <= EPS) fullPaidDate = p.txnDate
                }
                // chit fund: whatever was paid settles the installment; the unpaid rest is the dividend
                if (chit && !isMor && paidAmount.pos) {
                    val rest = rowInterestUnpaid.add(principalDueUnpaid)
                    if (rest > EPS) {
                        dividend = rest
                        balance = balance.subtract(principalDueUnpaid)
                        interestOut = interestOut.subtract(rowInterestUnpaid)
                        principalDueUnpaid = ZERO
                        rowInterestUnpaid = ZERO
                        if (!contract) dividends = dividends.add(rest)
                        if (fullPaidDate == null) fullPaidDate = lastPaymentDate
                    }
                }
                if ((contract || due > asOf) && !closed && !(chit && paidAmount.pos)) {
                    val target = if (isMor) (if (loan.moratoriumTreatment == "interest_only") interestOut else ZERO) else minD(emiNow, interestOut.add(balance))
                    var topUp = maxD(ZERO, target.subtract(paidAmount))
                    if (!isMor && topUp < rowInterestUnpaid.add(principalDueUnpaid)) topUp = rowInterestUnpaid.add(principalDueUnpaid)
                    if (topUp.pos) {
                        val xi = payInterest(topUp)
                        val xp = payScheduledPrincipal(topUp.subtract(xi))
                        var leftover = topUp.subtract(xi).subtract(xp)
                        val xe = minD(leftover, balance)
                        if (xe.pos) { balance = balance.subtract(xe); paidPrincipal = paidPrincipal.add(xe); leftover = leftover.subtract(xe) }
                        val used = topUp.subtract(leftover)
                        projectedAmount = used
                        projInterest = projInterest.add(xi); projPrincipal = projPrincipal.add(xp).add(xe); projPayments = projPayments.add(used)
                        allInterest = allInterest.add(xi)
                    }
                }
            }

            var capitalized = ZERO
            if (isMor && loan.moratoriumTreatment == "capitalize" && interestOut.pos) {
                capitalized = interestOut
                balance = balance.add(capitalized)
                interestOut = ZERO
                rowInterestUnpaid = ZERO
                if (due <= asOf && !contract) capitalizedActual = capitalizedActual.add(capitalized)
            }

            val shortfall = rowInterestUnpaid.add(principalDueUnpaid)
            val rowMarkers = markers[i]
            val isProjected = projectedAmount.pos
            val status: RowStatus = when {
                rowMarkers?.contains("waiver") == true -> { interestOut = interestOut.subtract(rowInterestUnpaid); RowStatus.waived }
                preTracked -> if (isMor && loan.moratoriumTreatment == "capitalize") RowStatus.moratorium else RowStatus.assumed_paid
                isMor && scheduled <= EPS && paidAmount <= EPS -> RowStatus.moratorium
                shortfall <= EPS -> if (isProjected) RowStatus.upcoming else if (due > asOf) RowStatus.prepaid else RowStatus.paid
                due > asOf || contract -> if (paidAmount.pos) RowStatus.partially_paid else RowStatus.upcoming
                paidAmount.pos -> RowStatus.partially_paid
                rowMarkers?.contains("missed") == true -> RowStatus.missed
                due >= Dates.addDays(asOf, -grace) -> RowStatus.due
                due < loan.trackingStartDate -> RowStatus.unrecorded
                else -> RowStatus.overdue
            }
            arrears = interestOut
            if (due <= asOf) arrearsSnapshot = arrears

            val late = !preTracked && !contract && due <= asOf && scheduled > EPS && status != RowStatus.waived &&
                (if (shortfall > EPS) graceDate < asOf else (fullPaidDate ?: due) > graceDate)

            var feesCharged = ZERO
            if (late) {
                if (lateFee.pos) { feesDue = feesDue.add(lateFee); feesCharged = feesCharged.add(lateFee); estimatedCharges = true }
                if (penalRate.pos) {
                    val shortAtGrace = maxD(ZERO, scheduled.subtract(paidByGrace))
                    val end = if (fullPaidDate != null && fullPaidDate!! <= asOf) fullPaidDate!! else asOf
                    val days = maxOf(0L, Dates.diffDays(due, end))
                    val pen = round2(shortAtGrace.m(penalRate).d(hundred).m(days.toInt()).d(365))
                    if (pen.pos) { penaltyDue = penaltyDue.add(pen); feesCharged = feesCharged.add(pen); estimatedCharges = true }
                }
            }

            rows.add(row(i, isMor, emiNo, due, rate, openingPrincipal, emiNow, scheduled, interestRow, principalDue, paidAmount, projectedAmount,
                paidPrincipal, paidInterest, feesCharged, feesPaid, extraPrincipal, capitalized, balance, shortfall, status, late, isProjected,
                preTracked || status == RowStatus.unrecorded, lastPaymentDate, paymentIds, dividend))

            if (!contract && !isMor && preTrackEmi > 0 && emiNo == preTrackEmi && !loan.openingOutstanding.isNullOrBlank()) {
                val target = dec(loan.openingOutstanding)
                balanceAdjustment = target.subtract(balance)
                balance = target
                rows.last().closingPrincipal = money(balance)
            }

            if (!isMor) emiRowsDone++
            prev = due

            if (!isMor && balance <= EPS && arrears <= EPS) {
                closed = true
                closedDate = if (status == RowStatus.upcoming) due else lastPaymentDate ?: due
                balance = ZERO
            }
            // the EMI does not even cover the period's own interest: the loan never closes
            if (!closed && !isMor && (contract || due > asOf) && isProjected && balance.pos && emiNow <= interestRow) {
                nonConverging = true
                break
            }
            i++
        }
        if (!closed && rows.size >= cap) nonConverging = true

        for ((no, list) in instPays) for (p in list) if (!allocations.containsKey(p.id)) book(p, no, "unapplied", dec(p.amount))
        for (k in evIdx until events.size) { val e = events[k]; if (e is Ev.Pay && !allocations.containsKey(e.pay.id)) book(e.pay, null, "unapplied", dec(e.pay.amount)) }
        for (p in payments) if (!isSim(p) && p.type !in MARKER_TYPES) recTotal = recTotal.add(dec(p.amount))

        val notDone = setOf(RowStatus.paid, RowStatus.prepaid, RowStatus.assumed_paid, RowStatus.waived, RowStatus.cancelled)
        var remainingCount = rows.count { it.kind == "emi" && it.status !in notDone }
        for (r in rows) {
            if (r.kind == "emi" && r.status !in notDone) remainingCount--
            r.remainingInstallments = maxOf(0, remainingCount)
        }

        // ---- summary
        val principal = dec(loan.principal)
        val preEmi = dec(loan.preEmiInterest)
        val upfront = dec(loan.processingFee).add(dec(loan.otherCharges))
        val principalRepaid = recPrincipal.add(estPrincipal)
        val interestPaid = recInterest.add(estInterest).add(preEmi)
        val totalPaid = recTotal.add(estPrincipal).add(estInterest).add(preEmi).add(upfront)
        val outstanding = maxD(ZERO, principal.add(capitalizedActual).add(balanceAdjustment).subtract(principalRepaid).subtract(dividends))
        val chargesDue = feesDue.add(penaltyDue)
        val emiRows = rows.filter { it.kind == "emi" }
        val firstOpen = rows.firstOrNull { it.status in OPEN_STATUSES && it.kind == "emi" } ?: rows.firstOrNull { it.status in OPEN_STATUSES }
        val nextUp = rows.firstOrNull { it.dueDate >= asOf && it.status in OPEN_STATUSES }
        val graceCut = Dates.addDays(asOf, -grace)
        val overdueRows = rows.filter { it.dueDate <= asOf && it.status in setOf(RowStatus.overdue, RowStatus.missed, RowStatus.partially_paid, RowStatus.unrecorded, RowStatus.due) && dec(it.shortfall) > EPS && it.dueDate < graceCut }
        val overdueAmount = overdueRows.fold(ZERO) { s, r -> s.add(dec(r.shortfall)) }
        val unrecorded = rows.count { it.status == RowStatus.unrecorded }
        val lastPay = payments.filter { !isSim(it) && it.type !in MARKER_TYPES }.maxOfOrNull { it.txnDate }
        val base = principal.add(capitalizedActual).add(balanceAdjustment)
        val progress = if (base.pos) principalRepaid.add(dividends).d(base).toDouble().times(100).coerceIn(0.0, 100.0) else 0.0
        val accruedNow = accruedAtAsOf ?: ZERO
        val payoff = maxD(ZERO, outstanding.add(arrearsSnapshot).add(accruedNow).add(chargesDue).subtract(dec(loan.advanceEmiBalance)))

        val warnings = mutableListOf<String>()
        if (unrecorded > 0) warnings.add("$unrecorded past installment(s) before tracking started have no payment record; they are treated as unpaid.")
        if (nonConverging) warnings.add("The EMI does not cover the interest due; the loan will not close at this EMI.")
        if (preTrackEmi > 0) warnings.add("$preTrackEmi installment(s) before tracking are assumed paid on schedule (estimated split).")
        if (estimatedCharges) warnings.add("Late fees / penal interest are estimated from the loan configuration.")
        if (!emiWasProvided) warnings.add("EMI was calculated from the loan terms, not entered from the lender.")
        if (loan.interestMethod == "reducing_daily") warnings.add("Daily-reducing interest uses an actual/365 day count.")
        if (loan.interestMethod == "flat" && !chit) warnings.add("Flat-rate interest: prepayments reduce outstanding principal but interest per installment follows the flat base.")
        val isEstimate = preTrackEmi > 0 || unrecorded > 0 || estimatedCharges || !emiWasProvided || (loan.interestMethod != "reducing_monthly" && !chit)

        var reconciliation: Reconciliation? = null
        if (!skipReconciliation && !contract && !loan.lenderOutstanding.isNullOrBlank() && !loan.lenderOutstandingDate.isNullOrBlank()) {
            val at = compute(loan, adjustmentsIn, paymentsIn, loan.lenderOutstandingDate, skipBaseline = true, skipReconciliation = true)
            val calc = dec(at.summary.outstandingPrincipal)
            reconciliation = Reconciliation(money(loan.lenderOutstanding), loan.lenderOutstandingDate, money(calc), money(dec(loan.lenderOutstanding).subtract(calc)))
            if (dec(reconciliation.difference).abs() > BigDecimal.ONE) warnings.add("Lender balance differs from the calculated principal by ${reconciliation.difference}.")
        }

        var baselineClosure: String? = null
        var baselineInterest = ZERO
        var periodsSaved = 0
        val lifetimeInterest = allInterest.add(preEmi)
        if (!skipBaseline && !contract) {
            val b = compute(loan, adjustmentsIn, emptyList(), asOf, contract = true, skipBaseline = true, skipReconciliation = true)
            baselineClosure = b.summary.closureDate
            baselineInterest = dec(b.summary.lifetimeInterest)
            val bRows = b.rows.count { it.kind == "emi" }
            val nRows = rows.count { it.kind == "emi" && it.status != RowStatus.cancelled }
            periodsSaved = if (nonConverging || b.summary.nonConverging) 0 else bRows - nRows
        }

        val summary = LoanSummary(
            principal = money(principal), sanctioned = money(loan.sanctionedAmount.ifBlank { loan.principal }),
            disbursed = money(loan.disbursedAmount.ifBlank { loan.principal }), capitalizedInterest = money(capitalizedActual),
            balanceAdjustment = money(balanceAdjustment), principalRepaid = money(principalRepaid), principalRepaidEstimated = money(estPrincipal),
            interestPaid = money(interestPaid), interestPaidEstimated = money(estInterest), feesPaid = money(recFees.add(upfront)),
            penaltiesPaid = money(recPenalty), upfrontCharges = money(upfront), unapplied = money(recUnapplied), totalPaid = money(totalPaid),
            totalPaidRecorded = money(recTotal), outstandingPrincipal = money(outstanding), interestArrears = money(arrearsSnapshot),
            accruedInterest = money(accruedNow), chargesDue = money(chargesDue), payoffEstimate = money(payoff),
            totalInstallments = emiRows.count { it.status != RowStatus.cancelled }, installmentsPaid = emiRows.count { it.status in DONE_STATUSES },
            installmentsRemaining = emiRows.count { it.status in OPEN_STATUSES }, currentInstallment = firstOpen?.no,
            currentEmi = money(firstOpen?.let { dec(it.emi) } ?: emi ?: ZERO), remainingScheduledAmount = money(projPayments),
            remainingPrincipal = money(projPrincipal), remainingInterest = money(projInterest), remainingFees = money(chargesDue),
            remainingCashOutflow = money(projPayments.add(chargesDue)),
            nextDue = firstOpen?.let { DueRef(it.no, it.dueDate, money(if (dec(it.shortfall).pos) dec(it.shortfall) else dec(it.scheduledAmount)), it.status) },
            nextUpcoming = nextUp?.let { DueRef(it.no, it.dueDate, money(if (dec(it.shortfall).pos) dec(it.shortfall) else dec(it.scheduledAmount)), it.status) },
            overdueCount = overdueRows.size, overdueAmount = money(overdueAmount), unrecordedCount = unrecorded, lastPaymentDate = lastPay,
            closureDate = if (closed) closedDate else null, computedClosed = closed && (closedDate ?: "9999") <= asOf,
            progressPct = Math.round(progress * 100) / 100.0, baselineClosureDate = baselineClosure, baselineTotalInterest = money(baselineInterest),
            lifetimeInterest = money(lifetimeInterest), interestSaved = money(if (skipBaseline || contract) ZERO else baselineInterest.subtract(lifetimeInterest)),
            periodsSaved = periodsSaved, nonConverging = nonConverging, isEstimate = isEstimate, warnings = warnings, reconciliation = reconciliation,
            dividends = money(dividends),
        )
        return LoanComputation(loan.id, rows, allocations, summary)
    }

    private fun row(
        no: Int, isMor: Boolean, emiNo: Int?, due: String, rate: BigDecimal, opening: BigDecimal, emi: BigDecimal, scheduled: BigDecimal,
        interest: BigDecimal, principalDue: BigDecimal, paid: BigDecimal, projected: BigDecimal, paidPrincipal: BigDecimal, paidInterest: BigDecimal,
        feesCharged: BigDecimal, feesPaid: BigDecimal, extra: BigDecimal, capitalized: BigDecimal, closing: BigDecimal, shortfall: BigDecimal,
        status: RowStatus, late: Boolean, isProjected: Boolean, isEstimated: Boolean, lastPaymentDate: String?, paymentIds: List<String>,
        dividend: BigDecimal = ZERO,
    ) = ScheduleRow(
        no, if (isMor) "moratorium" else "emi", emiNo, due, rate.setScale(2, java.math.RoundingMode.HALF_UP).toPlainString(), money(opening), money(emi),
        money(scheduled), money(interest), money(principalDue), money(paid), money(projected), money(paidPrincipal), money(paidInterest),
        money(feesCharged), money(feesPaid), money(extra), money(capitalized), money(closing), money(shortfall), status, late, isProjected,
        isEstimated, 0, lastPaymentDate, paymentIds, money(dividend),
    )
}
