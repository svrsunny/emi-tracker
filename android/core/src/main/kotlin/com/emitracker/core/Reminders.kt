package com.emitracker.core

import java.time.LocalDateTime
import java.time.YearMonth
import java.time.format.DateTimeFormatter

/**
 * Reminder planning (port of reminders.ts). Pure: loan state + settings + delivery history in,
 * occurrences out. Every occurrence has a deterministic dedupe key, so a reminder is delivered at
 * most once regardless of how often WorkManager runs, across reboots and across synced devices.
 * Times are local wall-clock strings "YYYY-MM-DDTHH:MM".
 */
data class PlannedReminder(val key: String, val category: String, val title: String, val body: String, val loanId: String?, val at: String, val late: Boolean)

data class HistoryItem(val key: String, val state: String, val snoozedUntil: String?)

data class PlannerInput(
    val now: String,
    val settings: ReminderSettings,
    val loans: List<Loan>,
    val comps: Map<String, LoanComputation>,
    val adjustments: List<Adjustment>,
    val custom: List<CustomReminder>,
    val history: List<HistoryItem>,
    val lastBackupDate: String?,
    val formatMoney: (String) -> String,
    val formatDate: (String) -> String,
    val bills: List<Bill> = emptyList(),
    val billPayments: List<BillPayment> = emptyList(),
    val debts: List<Debt> = emptyList(),
    val debtRepayments: List<DebtRepayment> = emptyList(),
)

object Reminders {
    private val WALL = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm")
    private fun at(d: String, t: String) = "${d}T$t"

    private fun inQuiet(time: String, s: ReminderSettings): Boolean {
        if (!s.quietEnabled || s.quietStart == s.quietEnd) return false
        return if (s.quietStart < s.quietEnd) time >= s.quietStart && time < s.quietEnd else time >= s.quietStart || time < s.quietEnd
    }

    fun adjustTime(whenTime: String, s: ReminderSettings): String {
        var date = whenTime.substring(0, 10)
        var time = whenTime.substring(11, 16)
        if (inQuiet(time, s)) {
            if (s.quietStart > s.quietEnd && time >= s.quietStart) date = Dates.addDays(date, 1)
            time = s.quietEnd
        }
        if (s.weekdays.any { it }) {
            var i = 0
            while (i < 7 && !s.weekdays[Dates.weekday(date)]) { date = Dates.addDays(date, 1); i++ }
        }
        return at(date, time)
    }

    fun addMinutes(whenTime: String, minutes: Long): String = LocalDateTime.parse(whenTime, WALL).plusMinutes(minutes).format(WALL)

    fun customOccurrences(r: CustomReminder, from: String, to: String): List<String> {
        if (r.repeat == "none") return if (r.date in from..to) listOf(r.date) else emptyList()
        val out = mutableListOf<String>()
        val base = Dates.parse(r.date)
        for (i in 0 until 5000) {
            val d = when (r.repeat) {
                "daily" -> base.plusDays(i.toLong())
                "weekly" -> base.plusWeeks(i.toLong())
                "monthly" -> YearMonth.from(base).plusMonths(i.toLong()).let { it.atDay(minOf(base.dayOfMonth, it.lengthOfMonth())) }
                else -> YearMonth.of(base.year + i, base.monthValue).let { it.atDay(minOf(base.dayOfMonth, it.lengthOfMonth())) }
            }.toString()
            if (d > to) break
            if (d >= from) out.add(d)
        }
        return out
    }

    fun plan(input: PlannerInput, horizonDays: Long): List<PlannedReminder> {
        val s = input.settings
        val today = input.now.substring(0, 10)
        val from = Dates.addDays(today, -maxOf(0, s.catchUpDays).toLong())
        val to = Dates.addDays(today, horizonDays)
        val out = mutableListOf<PlannedReminder>()
        if (!s.enabled) return out
        fun push(category: String, key: String, date: String, title: String, body: String, loanId: String?, time: String = s.time) {
            if (category != "test" && !s.categories.enabled(category)) return
            if (date < from || date > to) return
            out.add(PlannedReminder(key, category, title, body, loanId, adjustTime(at(date, time), s), false))
        }
        val fm = input.formatMoney
        val fd = input.formatDate
        for (loan in input.loans) {
            if (loan.status != "active" || !loan.reminderEnabled) continue
            val c = input.comps[loan.id] ?: continue
            val offsets = loan.reminderOffsets ?: s.offsets
            for (r in c.rows) {
                if (r.status !in OPEN_STATUSES || r.status == RowStatus.unrecorded) continue
                val amount = if (r.shortfall.toBigDecimal().signum() > 0) r.shortfall else r.scheduledAmount
                if (amount.toBigDecimal().signum() <= 0) continue
                val label = r.emiNo?.let { "EMI #$it" } ?: "Installment ${r.no}"
                for (off in offsets) {
                    if (off <= 0) continue
                    push("emi_upcoming", "emi_upcoming:${loan.id}:${r.no}:${r.dueDate}:$off", Dates.addDays(r.dueDate, -off.toLong()),
                        "${loan.name}: EMI due in $off day${if (off == 1) "" else "s"}", "$label of ${fm(amount)} is due on ${fd(r.dueDate)}.", loan.id)
                }
                push("emi_due", "emi_due:${loan.id}:${r.no}:${r.dueDate}", r.dueDate, "${loan.name}: EMI due today", "$label of ${fm(amount)} is due today.", loan.id)
                if (r.dueDate < today && r.status != RowStatus.due) {
                    for (k in 0 until maxOf(1, s.maxRepeats)) {
                        val d = Dates.addDays(r.dueDate, (1 + loan.gracePeriodDays + k * maxOf(1, s.overdueRepeatDays)).toLong())
                        if (d > today) break
                        push("emi_overdue", "emi_overdue:${loan.id}:${r.no}:${r.dueDate}:$k", d, "${loan.name}: EMI overdue",
                            "$label of ${fm(amount)} was due on ${fd(r.dueDate)} (${Dates.diffDays(r.dueDate, d)} days ago). Record the payment once made.", loan.id)
                    }
                }
                if (r.status == RowStatus.missed) push("emi_missed", "emi_missed:${loan.id}:${r.no}:${r.dueDate}", today, "${loan.name}: missed EMI",
                    "$label due ${fd(r.dueDate)} is marked missed. Outstanding ${fm(amount)}.", loan.id)
            }
            val close = c.summary.closureDate
            if (close != null && close > today) push("loan_closure", "loan_closure:${loan.id}:$close", Dates.addDays(close, -s.closureLeadDays.toLong()),
                "${loan.name} closes soon", "Projected last payment on ${fd(close)}. Remaining ${fm(c.summary.remainingCashOutflow)}.", loan.id)
        }
        for (a in input.adjustments) {
            val loan = input.loans.firstOrNull { it.id == a.loanId } ?: continue
            if (loan.status != "active" || a.effectiveDate <= today) continue
            push("rate_change", "rate_change:${a.id}:${a.effectiveDate}", Dates.addDays(a.effectiveDate, -1),
                "${loan.name}: ${if (a.kind == "rate") "rate change" else "loan change"} tomorrow",
                if (a.kind == "rate") "Interest rate changes to ${a.annualRate}% from ${fd(a.effectiveDate)}." else "A ${a.kind} change takes effect on ${fd(a.effectiveDate)}.", loan.id)
        }
        var d = from
        while (d <= to) {
            if (d.endsWith("-01")) push("summary_monthly", "summary_monthly:${d.substring(0, 7)}", d, "Monthly repayment summary", "Your monthly loan summary is ready in EMI Tracker.", null)
            if (Dates.weekday(d) == s.weeklySummaryDay) push("summary_weekly", "summary_weekly:${Dates.isoWeekKey(d)}", d, "Weekly financial summary", "Review this week's EMIs and payments in EMI Tracker.", null)
            d = Dates.addDays(d, 1)
        }
        val interval = maxOf(1, s.backupIntervalDays)
        if (input.lastBackupDate == null) push("backup", "backup:never:$today", today, "No backup yet", "Create a backup so your loan records are safe.", null)
        else {
            val since = Dates.diffDays(input.lastBackupDate, today)
            if (since >= interval) {
                val n = since / interval
                push("backup", "backup:${input.lastBackupDate}:$n", Dates.addDays(input.lastBackupDate, n * interval), "Backup reminder",
                    "Your last backup was $since days ago (${fd(input.lastBackupDate)}).", null)
            }
        }
        // bills: before the due date, on it, and once the day after if still unpaid
        for (o in Bills.occurrences(input.bills.filter { it.active && it.reminderEnabled }, input.billPayments, from, Dates.addDays(to, 61), today)) {
            if (o.payment != null) continue
            val b = o.bill
            val amount = "${if (b.variable) "about " else ""}${fm(b.amount)}"
            for (off in b.reminderOffsets ?: s.offsets) {
                if (off <= 0) continue
                push("bill", "bill:${b.id}:${o.dueDate}:$off", Dates.addDays(o.dueDate, -off.toLong()), "${b.name}: due in $off day${if (off == 1) "" else "s"}", "$amount is due on ${fd(o.dueDate)}.", null)
            }
            push("bill", "bill_due:${b.id}:${o.dueDate}", o.dueDate, "${b.name}: due today", "$amount is due today.", null)
            push("bill", "bill_overdue:${b.id}:${o.dueDate}", Dates.addDays(o.dueDate, 1), "${b.name}: unpaid", "$amount was due on ${fd(o.dueDate)}. Mark it paid once done.", null)
        }
        // lending & borrowing: the day before, on and the day after the return date while money is pending
        for (d in input.debts.filter { it.reminderEnabled && it.dueDate != null }) {
            val due = d.dueDate!!
            if (due < Dates.addDays(from, -1) || due > Dates.addDays(to, 1)) continue
            val sum = Debts.summary(d, input.debtRepayments, today)
            if (sum.status == "settled") continue
            val amount = fm(sum.pending)
            val lent = d.direction == "lent"
            val body = if (lent) "Lent on ${fd(d.date)}. Record it once you get it back." else "Borrowed on ${fd(d.date)}. Record it once you repay."
            push("debt", "debt:${d.id}:$due:1", Dates.addDays(due, -1), if (lent) "Collect $amount from ${d.person} tomorrow" else "Return $amount to ${d.person} tomorrow", body, null)
            push("debt", "debt_due:${d.id}:$due", due, if (lent) "Collect $amount from ${d.person} today" else "Return $amount to ${d.person} today", body, null)
            push("debt", "debt_overdue:${d.id}:$due", Dates.addDays(due, 1), if (lent) "${d.person} has not returned $amount yet" else "$amount to ${d.person} was due on ${fd(due)}", body, null)
        }
        for (r in input.custom) {
            if (!r.enabled) continue
            for (day in customOccurrences(r, from, to)) push("custom", "custom:${r.id}:$day", day, r.title, r.description.ifBlank { "Reminder" }, r.loanId, r.time.ifBlank { s.time })
        }
        return out.sortedBy { it.at }
    }

    fun due(input: PlannerInput): List<PlannedReminder> {
        val hist = input.history.associateBy { it.key }
        val catchUpFrom = at(Dates.addDays(input.now.substring(0, 10), -maxOf(0, input.settings.catchUpDays).toLong()), "00:00")
        return plan(input, 0).filter { r ->
            if (r.at > input.now || r.at < catchUpFrom) return@filter false
            val h = hist[r.key]
            h == null || (h.state == "snoozed" && h.snoozedUntil != null && h.snoozedUntil <= input.now)
        }.map { it.copy(late = addMinutes(it.at, 30) < input.now) }
    }

    fun upcoming(input: PlannerInput, days: Long = 30): List<PlannedReminder> {
        val delivered = input.history.map { it.key }.toSet()
        return plan(input, days).filter { it.at > input.now && it.key !in delivered }
    }

    fun wallTime(now: LocalDateTime): String = now.format(WALL)
}
