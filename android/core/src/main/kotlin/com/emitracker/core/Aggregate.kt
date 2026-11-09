package com.emitracker.core

import com.emitracker.core.Money.ZERO
import com.emitracker.core.Money.dec
import com.emitracker.core.Money.money
import java.math.BigDecimal

/** Portfolio aggregation for dashboard, heatmaps, calendar and reports (port of aggregate.ts). */
data class Filters(val loanIds: List<String>? = null, val from: String? = null, val to: String? = null)
data class Portfolio(val loans: List<Loan>, val comps: Map<String, LoanComputation>, val payments: List<Payment>)

data class DueItem(val loanId: String, val loanName: String, val no: Int, val date: String, val amount: String, val status: RowStatus)

data class DashboardTotals(
    val originalPrincipal: String, val sanctioned: String, val principalRepaid: String, val interestPaid: String, val chargesPaid: String,
    val totalPaid: String, val outstandingPrincipal: String, val outstandingInterest: String, val remainingInstallments: Int,
    val remainingScheduled: String, val remainingInterest: String, val remainingFees: String, val remainingOutflow: String,
    val activeLoans: Int, val closedLoans: Int, val progressPct: Double, val estimatedPortion: String, val paidInRange: String,
    val nextEmi: DueItem?, val dueToday: List<DueItem>, val overdue: List<DueItem>, val due7: List<DueItem>, val due30: List<DueItem>,
    val allClosedBy: String?, val anyOpenEnded: Boolean, val isEstimate: Boolean,
)

data class ActivityItem(val paymentId: String, val loanId: String, val date: String, val type: String, val amount: BigDecimal, val principal: BigDecimal, val interest: BigDecimal, val fees: BigDecimal, val penalty: BigDecimal)

enum class CalendarState { none, no_data, waived, upcoming, prepaid, paid, extra, due, partial, missed, overdue }

data class DayCell(
    val date: String, var amount: BigDecimal = ZERO, var count: Int = 0, var principal: BigDecimal = ZERO, var interest: BigDecimal = ZERO,
    var fees: BigDecimal = ZERO, var penalty: BigDecimal = ZERO, val loanIds: MutableList<String> = mutableListOf(),
    val paymentIds: MutableList<String> = mutableListOf(), var hasData: Boolean, val scheduled: MutableList<ScheduledMark> = mutableListOf(),
    var state: CalendarState,
)
data class ScheduledMark(val loanId: String, val no: Int, val status: RowStatus, val amount: String, val projected: Boolean)

data class MonthCell(
    val month: String, var amount: BigDecimal = ZERO, var principal: BigDecimal = ZERO, var interest: BigDecimal = ZERO, var fees: BigDecimal = ZERO,
    var installmentsPaid: Int = 0, var scheduledCount: Int = 0, var missedOrOverdue: Int = 0, var completionPct: Int? = null, var count: Int = 0, var hasData: Boolean,
)

enum class MonthMetric(val label: String) { amount("Total paid"), principal("Principal"), interest("Interest"), installments("Installments paid"), missed("Missed / overdue"), completion("% completed") }

data class MonthSeries(val month: String, var paid: Double = 0.0, var principal: Double = 0.0, var interest: Double = 0.0, var fees: Double = 0.0, var scheduled: Double = 0.0, var projected: Double = 0.0)

object Aggregate {
    private fun inRange(d: String, f: Filters) = (f.from == null || d >= f.from) && (f.to == null || d <= f.to)
    private fun selected(l: Loan, f: Filters) = f.loanIds.isNullOrEmpty() || l.id in f.loanIds

    fun dashboard(p: Portfolio, asOf: String, f: Filters = Filters()): DashboardTotals {
        var principal = ZERO; var sanctioned = ZERO; var repaid = ZERO; var interest = ZERO; var charges = ZERO; var paid = ZERO; var outstanding = ZERO
        var outInterest = ZERO; var remSched = ZERO; var remInterest = ZERO; var remFees = ZERO; var remOut = ZERO; var estimated = ZERO; var paidInRange = ZERO
        var remaining = 0; var active = 0; var closedCount = 0; var allClosedBy: String? = null; var openEnded = false; var isEstimate = false
        val dueToday = mutableListOf<DueItem>(); val overdue = mutableListOf<DueItem>(); val due7 = mutableListOf<DueItem>(); val due30 = mutableListOf<DueItem>()
        var next: DueItem? = null
        val d7 = Dates.addDays(asOf, 7); val d30 = Dates.addDays(asOf, 30)
        for (loan in p.loans) {
            if (!selected(loan, f) || loan.status == "archived") continue
            val c = p.comps[loan.id] ?: continue
            val s = c.summary
            val isActive = loan.status == "active"
            if (isActive) active++ else closedCount++
            principal = principal.add(dec(s.principal)); sanctioned = sanctioned.add(dec(s.sanctioned)); repaid = repaid.add(dec(s.principalRepaid))
            interest = interest.add(dec(s.interestPaid)); charges = charges.add(dec(s.feesPaid)).add(dec(s.penaltiesPaid)); paid = paid.add(dec(s.totalPaid))
            estimated = estimated.add(dec(s.principalRepaidEstimated)).add(dec(s.interestPaidEstimated))
            if (s.isEstimate) isEstimate = true
            for (pay in p.payments) if (pay.loanId == loan.id && pay.status == "active" && inRange(pay.txnDate, f) && pay.type !in MARKER_TYPES) paidInRange = paidInRange.add(dec(pay.amount))
            if (!isActive) continue
            outstanding = outstanding.add(dec(s.outstandingPrincipal)); outInterest = outInterest.add(dec(s.interestArrears)).add(dec(s.accruedInterest))
            remSched = remSched.add(dec(s.remainingScheduledAmount)); remInterest = remInterest.add(dec(s.remainingInterest)); remFees = remFees.add(dec(s.remainingFees))
            remOut = remOut.add(dec(s.remainingCashOutflow)); remaining += s.installmentsRemaining
            if (s.nonConverging) openEnded = true
            s.closureDate?.let { if (allClosedBy == null || it > allClosedBy!!) allClosedBy = it }
            for (r in c.rows) {
                if (r.status !in OPEN_STATUSES || r.status == RowStatus.unrecorded) continue
                val amt = if (dec(r.shortfall).signum() > 0) r.shortfall else r.scheduledAmount
                if (dec(amt).signum() <= 0) continue
                val item = DueItem(loan.id, loan.name, r.no, r.dueDate, money(amt), r.status)
                when {
                    r.dueDate == asOf -> dueToday.add(item)
                    r.dueDate < asOf -> overdue.add(item)
                    r.dueDate <= d7 -> due7.add(item)
                    r.dueDate <= d30 -> due30.add(item)
                }
                if (r.dueDate >= asOf && (next == null || r.dueDate < next!!.date)) next = item
            }
        }
        val base = repaid.add(outstanding)
        return DashboardTotals(
            money(principal), money(sanctioned), money(repaid), money(interest), money(charges), money(paid), money(outstanding), money(outInterest),
            remaining, money(remSched), money(remInterest), money(remFees), money(remOut), active, closedCount,
            if (base.signum() > 0) Math.round(repaid.d(base).toDouble() * 10000) / 100.0 else 0.0, money(estimated), money(paidInRange), next,
            dueToday, overdue, due7, (due7 + due30).sortedBy { it.date }, if (openEnded) null else allClosedBy, openEnded, isEstimate,
        )
    }

    fun activity(p: Portfolio, f: Filters = Filters()): List<ActivityItem> {
        val byId = p.loans.associateBy { it.id }
        return p.payments.mapNotNull { pay ->
            val loan = byId[pay.loanId] ?: return@mapNotNull null
            if (!selected(loan, f) || pay.status != "active" || pay.type in MARKER_TYPES || !inRange(pay.txnDate, f)) return@mapNotNull null
            val a = p.comps[pay.loanId]?.allocations?.get(pay.id)
            ActivityItem(pay.id, pay.loanId, pay.txnDate, pay.type, dec(pay.amount), a?.principal ?: ZERO, a?.interest ?: ZERO, a?.fees ?: ZERO, a?.penalty ?: ZERO)
        }.sortedBy { it.date }
    }

    fun trackedSince(p: Portfolio, f: Filters = Filters()): String? =
        p.loans.filter { selected(it, f) }.minOfOrNull { if (it.trackingStartDate < it.startDate) it.startDate else it.trackingStartDate }

    private fun rowState(s: RowStatus) = when (s) {
        RowStatus.paid, RowStatus.assumed_paid -> CalendarState.paid
        RowStatus.prepaid -> CalendarState.prepaid
        RowStatus.partially_paid -> CalendarState.partial
        RowStatus.overdue -> CalendarState.overdue
        RowStatus.missed -> CalendarState.missed
        RowStatus.due -> CalendarState.due
        RowStatus.upcoming -> CalendarState.upcoming
        RowStatus.waived -> CalendarState.waived
        RowStatus.unrecorded -> CalendarState.no_data
        else -> CalendarState.none
    }

    private fun pick(a: CalendarState, b: CalendarState) = if (b.ordinal > a.ordinal) b else a

    fun dailyCells(p: Portfolio, from: String, to: String, asOf: String, f: Filters = Filters()): LinkedHashMap<String, DayCell> {
        val since = trackedSince(p, f)
        val cells = linkedMapOf<String, DayCell>()
        var d = Dates.parse(from)
        val end = Dates.parse(to)
        while (!d.isAfter(end)) {
            val ds = d.toString()
            cells[ds] = DayCell(ds, hasData = since != null && ds >= since && ds <= asOf, state = if (since == null || ds < since) CalendarState.no_data else CalendarState.none)
            d = d.plusDays(1)
        }
        for (a in activity(p, f.copy(from = from, to = to))) {
            val c = cells[a.date] ?: continue
            c.amount = c.amount.add(a.amount); c.principal = c.principal.add(a.principal); c.interest = c.interest.add(a.interest)
            c.fees = c.fees.add(a.fees); c.penalty = c.penalty.add(a.penalty); c.count++; c.hasData = true
            if (a.loanId !in c.loanIds) c.loanIds.add(a.loanId)
            c.paymentIds.add(a.paymentId)
            if (a.type == "prepayment" || a.type == "foreclosure") c.state = pick(c.state, CalendarState.extra)
        }
        for (loan in p.loans) {
            if (!selected(loan, f) || loan.status == "archived") continue
            for (r in p.comps[loan.id]?.rows ?: emptyList()) {
                val c = cells[r.dueDate] ?: continue
                if (r.status == RowStatus.cancelled || r.status == RowStatus.moratorium) continue
                c.scheduled.add(ScheduledMark(loan.id, r.no, r.status, r.scheduledAmount, r.isProjected))
                c.state = pick(c.state, rowState(r.status))
            }
        }
        for (c in cells.values) if (c.count > 0 && c.state == CalendarState.none) c.state = CalendarState.paid
        return cells
    }

    fun monthlyCells(p: Portfolio, fromMonth: String, toMonth: String, asOf: String, f: Filters = Filters()): LinkedHashMap<String, MonthCell> {
        val since = trackedSince(p, f)
        val cells = linkedMapOf<String, MonthCell>()
        var ym = java.time.YearMonth.parse(fromMonth)
        val end = java.time.YearMonth.parse(toMonth)
        while (!ym.isAfter(end)) {
            val key = ym.toString()
            cells[key] = MonthCell(key, hasData = since != null && key >= since.substring(0, 7) && key <= asOf.substring(0, 7))
            ym = ym.plusMonths(1)
        }
        for (a in activity(p, f)) {
            val c = cells[a.date.substring(0, 7)] ?: continue
            c.amount = c.amount.add(a.amount); c.principal = c.principal.add(a.principal); c.interest = c.interest.add(a.interest)
            c.fees = c.fees.add(a.fees).add(a.penalty); c.count++; c.hasData = true
        }
        for (loan in p.loans) {
            if (!selected(loan, f) || loan.status == "archived") continue
            for (r in p.comps[loan.id]?.rows ?: emptyList()) {
                if (r.kind != "emi" || r.status == RowStatus.cancelled || r.dueDate > asOf) continue
                val c = cells[r.dueDate.substring(0, 7)] ?: continue
                c.scheduledCount++
                if (r.status in DONE_STATUSES && r.status != RowStatus.assumed_paid) c.installmentsPaid++
                if (r.status in setOf(RowStatus.overdue, RowStatus.missed, RowStatus.partially_paid)) c.missedOrOverdue++
            }
        }
        for (c in cells.values) c.completionPct = if (c.scheduledCount > 0) Math.round(c.installmentsPaid * 100.0 / c.scheduledCount).toInt() else null
        return cells
    }

    fun metricValue(c: MonthCell, m: MonthMetric): Double = when (m) {
        MonthMetric.amount -> c.amount.toDouble()
        MonthMetric.principal -> c.principal.toDouble()
        MonthMetric.interest -> c.interest.toDouble()
        MonthMetric.installments -> c.installmentsPaid.toDouble()
        MonthMetric.missed -> c.missedOrOverdue.toDouble()
        MonthMetric.completion -> (c.completionPct ?: 0).toDouble()
    }

    /** 0 = zero activity, 1..4 from ascending thresholds. */
    fun intensity(value: Double, thresholds: List<Double>): Int {
        if (value <= 0) return 0
        var level = 1
        for (t in thresholds.drop(1)) if (value >= t) level++
        return minOf(4, level)
    }

    fun autoThresholds(values: List<Double>): List<Double> {
        val v = values.filter { it > 0 }.sorted()
        if (v.isEmpty()) return listOf(0.0, 1.0, 2.0, 3.0)
        fun q(p: Double) = v[minOf(v.size - 1, (p * v.size).toInt())]
        return listOf(0.0, q(0.25), q(0.5), q(0.75))
    }

    fun monthlySeries(p: Portfolio, f: Filters, asOf: String): List<MonthSeries> {
        val map = sortedMapOf<String, MonthSeries>()
        fun get(k: String) = map.getOrPut(k) { MonthSeries(k) }
        for (a in activity(p, f)) {
            val s = get(a.date.substring(0, 7))
            s.paid += a.amount.toDouble(); s.principal += a.principal.toDouble(); s.interest += a.interest.toDouble(); s.fees += a.fees.add(a.penalty).toDouble()
        }
        for (loan in p.loans) {
            if (!selected(loan, f) || loan.status == "archived") continue
            for (r in p.comps[loan.id]?.rows ?: emptyList()) {
                if (!inRange(r.dueDate, f) || r.status == RowStatus.cancelled) continue
                val s = get(r.dueDate.substring(0, 7))
                if (r.dueDate <= asOf) s.scheduled += r.scheduledAmount.toDouble() else s.projected += r.projectedAmount.toDouble() + r.paidAmount.toDouble()
            }
        }
        return map.values.toList()
    }

    data class YearSummary(val year: Int, val paid: String, val principal: String, val interest: String, val fees: String, val count: Int)

    fun annualSummary(p: Portfolio, f: Filters = Filters()): List<YearSummary> =
        activity(p, f).groupBy { it.date.substring(0, 4).toInt() }.toSortedMap().map { (y, xs) ->
            YearSummary(y, money(xs.fold(ZERO) { s, a -> s.add(a.amount) }), money(xs.fold(ZERO) { s, a -> s.add(a.principal) }),
                money(xs.fold(ZERO) { s, a -> s.add(a.interest) }), money(xs.fold(ZERO) { s, a -> s.add(a.fees).add(a.penalty) }), xs.size)
        }

    data class FySummary(val fy: String, val principal: String, val interest: String, val paid: String)

    /** Indian financial year (April–March). */
    fun financialYears(p: Portfolio, f: Filters = Filters()): List<FySummary> =
        activity(p, f).groupBy {
            val y = it.date.substring(0, 4).toInt(); val m = it.date.substring(5, 7).toInt()
            val start = if (m >= 4) y else y - 1
            "FY $start-%02d".format((start + 1) % 100)
        }.toSortedMap().map { (fy, xs) ->
            FySummary(fy, money(xs.fold(ZERO) { s, a -> s.add(a.principal) }), money(xs.fold(ZERO) { s, a -> s.add(a.interest) }), money(xs.fold(ZERO) { s, a -> s.add(a.amount) }))
        }
}
