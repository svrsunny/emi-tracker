package com.emitracker.core

import kotlinx.serialization.Serializable
import java.math.BigDecimal
import java.time.LocalDate
import java.time.YearMonth

val BILL_CATEGORIES = listOf("rent", "electricity", "water", "gas", "mobile", "internet", "tv", "insurance", "subscription", "education", "maintenance", "credit_card", "other")
/** Months between due dates; "once" (0) is a one-time expense with a single due date, the start date. */
val BILL_FREQUENCY_MONTHS = linkedMapOf("monthly" to 1, "bimonthly" to 2, "quarterly" to 3, "half_yearly" to 6, "yearly" to 12, "once" to 0)

/** A recurring bill (rent, electricity, phone…). Counts towards monthly expenses. Same JSON as the desktop app. */
@Serializable
data class Bill(
    val id: String,
    val createdAt: String,
    val updatedAt: String,
    val name: String,
    val category: String,
    val payee: String,
    val amount: String, // usual amount; for variable bills the expected amount
    val variable: Boolean, // amount changes every time
    val frequency: String, // monthly | bimonthly | quarterly | half_yearly | yearly | once
    val dueDay: Int,
    val startDate: String, // first due date
    val endDate: String?,
    val active: Boolean,
    val reminderEnabled: Boolean,
    val reminderOffsets: List<Int>?,
    val notes: String,
)

/** One bill paid for one due date. */
@Serializable
data class BillPayment(
    val id: String,
    val createdAt: String,
    val updatedAt: String,
    val billId: String,
    val dueDate: String,
    val paidDate: String,
    val amount: String,
    val notes: String,
)

data class BillOccurrence(val bill: Bill, val dueDate: String, val payment: BillPayment?, val status: String) // paid | due | overdue | upcoming

data class ExpenseItem(
    val kind: String, // loan | chit | bill
    val refId: String,
    val name: String,
    val detail: String,
    val dueDate: String,
    val expected: String,
    val paid: String,
    val remaining: String,
    val status: String, // paid | partial | due | overdue | upcoming | no_record
    val rowNo: Int?,
)

data class ExpenseTotals(val expected: String, val paid: String, val remaining: String, val count: Int)
data class MonthlyExpenses(val month: String, val items: List<ExpenseItem>, val totals: Map<String, ExpenseTotals>) // keys: all, loan, chit, bill

/** Same rules as desktop src/shared/bills.ts. */
object Bills {
    /** Due dates of a bill in [from, to]; the due day is clamped to the month length. */
    fun dueDates(b: Bill, from: String, to: String): List<String> {
        if (b.frequency == "once") return if (b.startDate in from..to) listOf(b.startDate) else emptyList()
        val step = BILL_FREQUENCY_MONTHS[b.frequency] ?: 1
        val start = YearMonth.from(LocalDate.parse(b.startDate))
        val last = if (b.endDate != null && b.endDate < to) b.endDate else to
        val out = mutableListOf<String>()
        for (i in 0 until 2400) {
            val ym = start.plusMonths(i.toLong() * step)
            val d = ym.atDay(minOf(b.dueDay, ym.lengthOfMonth())).toString()
            if (d > last) break
            if (d >= from && d >= b.startDate) out += d
        }
        return out
    }

    fun occurrences(bills: List<Bill>, payments: List<BillPayment>, from: String, to: String, asOf: String): List<BillOccurrence> {
        val paid = payments.associateBy { "${it.billId}:${it.dueDate}" }
        val out = mutableListOf<BillOccurrence>()
        for (b in bills) for (d in dueDates(b, from, to)) {
            val p = paid["${b.id}:$d"]
            if (!b.active && p == null) continue
            out += BillOccurrence(b, d, p, when { p != null -> "paid"; d < asOf -> "overdue"; d == asOf -> "due"; else -> "upcoming" })
        }
        return out.sortedWith(compareBy({ it.dueDate }, { it.bill.name }))
    }

    private val ROW_STATUS = mapOf(
        RowStatus.paid to "paid", RowStatus.prepaid to "paid", RowStatus.assumed_paid to "paid", RowStatus.waived to "paid", RowStatus.partially_paid to "partial",
        RowStatus.overdue to "overdue", RowStatus.missed to "overdue", RowStatus.due to "due", RowStatus.upcoming to "upcoming", RowStatus.unrecorded to "no_record",
    )

    /** Everything due in a month (YYYY-MM): EMIs, chit installments and bills, with totals per kind. */
    fun monthlyExpenses(loans: List<Loan>, comps: Map<String, LoanComputation>, bills: List<Bill>, billPayments: List<BillPayment>, month: String, asOf: String): MonthlyExpenses {
        val ym = YearMonth.parse(month)
        val from = ym.atDay(1).toString()
        val to = ym.atEndOfMonth().toString()
        val items = mutableListOf<ExpenseItem>()
        for (loan in loans) {
            if (loan.status == "archived") continue
            val comp = comps[loan.id] ?: continue
            val chit = loan.loanType == "chit_fund"
            for (r in comp.rows) {
                if (r.dueDate < from || r.dueDate > to || r.status == RowStatus.cancelled || r.scheduledAmount.toBigDecimal().signum() <= 0) continue
                val status = ROW_STATUS[r.status] ?: "upcoming"
                val paid = if (r.status == RowStatus.assumed_paid) r.scheduledAmount.toBigDecimal() else r.paidAmount.toBigDecimal()
                // future rows are projected as paid in the schedule; here anything not yet paid is still to pay
                val remaining = if (status == "paid") BigDecimal.ZERO else (r.scheduledAmount.toBigDecimal() - paid - r.dividend.toBigDecimal()).max(BigDecimal.ZERO)
                items += ExpenseItem(if (chit) "chit" else "loan", loan.id, loan.name,
                    "${if (chit) "Installment" else "EMI"} ${r.emiNo ?: r.no}${if (r.dividend.toBigDecimal().signum() > 0) " · dividend ${Money.money(r.dividend)}" else ""}",
                    r.dueDate, r.scheduledAmount, Money.money(paid), Money.money(remaining), status, r.no)
            }
        }
        for (o in occurrences(bills, billPayments, from, to, asOf)) {
            val expected = o.bill.amount.toBigDecimal()
            val paid = o.payment?.amount?.toBigDecimal() ?: BigDecimal.ZERO
            items += ExpenseItem("bill", o.bill.id, o.bill.name, listOf(if (o.bill.frequency == "once") "one-time" else "", o.bill.payee, if (o.bill.variable) "amount varies" else "").filter { it.isNotBlank() }.joinToString(" · "),
                o.dueDate, Money.money(if (o.payment != null) paid else expected), Money.money(paid), if (o.payment != null) "0.00" else Money.money(expected), o.status, null)
        }
        val sorted = items.sortedWith(compareBy({ it.dueDate }, { it.name }))
        fun total(xs: List<ExpenseItem>): ExpenseTotals {
            fun sum(f: (ExpenseItem) -> String) = Money.money(xs.fold(BigDecimal.ZERO) { s, x -> s + f(x).toBigDecimal() })
            return ExpenseTotals(sum { it.expected }, sum { it.paid }, sum { it.remaining }, xs.size)
        }
        return MonthlyExpenses(month, sorted, mapOf("all" to total(sorted), "loan" to total(sorted.filter { it.kind == "loan" }),
            "chit" to total(sorted.filter { it.kind == "chit" }), "bill" to total(sorted.filter { it.kind == "bill" })))
    }

    /** Next unpaid due date on or after asOf, or the oldest overdue one (within ~3 months). */
    fun nextDue(b: Bill, payments: List<BillPayment>, asOf: String): Pair<String, Boolean>? {
        val occ = occurrences(listOf(b), payments.filter { it.billId == b.id }, Dates.addDays(asOf, -92), Dates.addDays(asOf, 400), asOf).filter { it.payment == null }
        occ.firstOrNull { it.dueDate < asOf }?.let { return it.dueDate to true }
        return occ.firstOrNull()?.let { it.dueDate to false }
    }

    /** Average monthly cost of the active recurring bills (one-time expenses are not counted). */
    fun monthlyAverage(bills: List<Bill>): BigDecimal = bills.filter { it.active && it.frequency != "once" }.fold(BigDecimal.ZERO) { s, b ->
        s + b.amount.toBigDecimal().divide(BigDecimal(BILL_FREQUENCY_MONTHS[b.frequency] ?: 1), 2, java.math.RoundingMode.HALF_UP)
    }
}

/** Money actually paid out on a day. kind: loan | chit | bill | one_time. */
data class SpendEntry(val id: String, val kind: String, val refId: String, val name: String, val amount: String, val date: String)
val SPEND_KINDS = listOf("loan", "chit", "bill", "one_time")

/** Same rules as desktop spendingByDay / spendTotals in src/shared/bills.ts. */
object Spending {
    /**
     * Loan / chit payments (not reversed, not the zero-amount missed / waiver markers) and bill payments, by the day
     * they were paid; one-time expenses kept apart. Lending & borrowing is not spending. [loanIds] limits it to those loans (no bills).
     */
    fun byDay(loans: List<Loan>, payments: List<Payment>, bills: List<Bill>, billPayments: List<BillPayment>, from: String, to: String, loanIds: List<String>? = null): Map<String, List<SpendEntry>> {
        val out = mutableMapOf<String, MutableList<SpendEntry>>()
        fun add(e: SpendEntry) { if (e.date in from..to) out.getOrPut(e.date) { mutableListOf() } += e }
        val byId = loans.associateBy { it.id }
        for (p in payments) {
            val l = byId[p.loanId] ?: continue
            if (p.status != "active" || p.type == "missed" || p.type == "waiver" || p.amount.toBigDecimal().signum() <= 0) continue
            if (loanIds != null && l.id !in loanIds) continue
            add(SpendEntry(p.id, if (l.loanType == "chit_fund") "chit" else "loan", l.id, l.name, Money.money(p.amount), p.txnDate))
        }
        if (loanIds == null) {
            val billById = bills.associateBy { it.id }
            for (p in billPayments) {
                val b = billById[p.billId] ?: continue
                add(SpendEntry(p.id, if (b.frequency == "once") "one_time" else "bill", b.id, b.name, Money.money(p.amount), p.paidDate))
            }
        }
        return out.mapValues { (_, xs) -> xs.sortedWith(compareBy<SpendEntry>({ SPEND_KINDS.indexOf(it.kind) }, { it.name })) }
    }

    /** Totals per kind plus "all". */
    fun totals(entries: List<SpendEntry>): Map<String, String> {
        fun sum(xs: List<SpendEntry>) = Money.money(xs.fold(BigDecimal.ZERO) { s, x -> s + x.amount.toBigDecimal() })
        return mapOf("all" to sum(entries)) + SPEND_KINDS.associateWith { k -> sum(entries.filter { it.kind == k }) }
    }
}
