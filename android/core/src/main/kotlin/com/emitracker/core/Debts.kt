package com.emitracker.core

import kotlinx.serialization.Serializable
import java.math.BigDecimal

/** Money lent to someone or borrowed from someone. No interest; settled when repayments reach the amount. Same JSON as the desktop app. */
@Serializable
data class Debt(
    val id: String,
    val createdAt: String,
    val updatedAt: String,
    val direction: String, // lent | borrowed
    val person: String,
    val amount: String,
    val date: String, // when the money changed hands
    val dueDate: String?, // when it should be returned (optional)
    val reminderEnabled: Boolean,
    val notes: String,
)

/** Part or all of a debt returned (to you for money lent, by you for money borrowed). */
@Serializable
data class DebtRepayment(
    val id: String,
    val createdAt: String,
    val updatedAt: String,
    val debtId: String,
    val date: String,
    val amount: String,
    val notes: String,
)

data class DebtSummary(val repaid: String, val pending: String, val status: String, val repayments: List<DebtRepayment>) // settled | overdue | due | pending
data class DebtSideStats(val amount: String, val repaid: String, val pending: String, val count: Int)

/** Same rules as desktop src/shared/debts.ts. */
object Debts {
    fun summary(d: Debt, repayments: List<DebtRepayment>, asOf: String): DebtSummary {
        val own = repayments.filter { it.debtId == d.id }.sortedWith(compareByDescending<DebtRepayment> { it.date }.thenByDescending { it.id })
        val repaid = own.fold(BigDecimal.ZERO) { s, r -> s + r.amount.toBigDecimal() }
        val pending = (d.amount.toBigDecimal() - repaid).max(BigDecimal.ZERO)
        val status = when {
            pending.signum() <= 0 -> "settled"
            d.dueDate == null -> "pending"
            d.dueDate < asOf -> "overdue"
            d.dueDate == asOf -> "due"
            else -> "pending"
        }
        return DebtSummary(Money.money(repaid), Money.money(pending), status, own)
    }

    /** Totals of the entries on screen, per side ("lent", "borrowed"): amount given / taken, returned so far, still pending. */
    fun stats(rows: List<Pair<Debt, DebtSummary>>): Map<String, DebtSideStats> = listOf("lent", "borrowed").associateWith { dir ->
        val xs = rows.filter { it.first.direction == dir }
        fun sum(f: (Pair<Debt, DebtSummary>) -> String) = Money.money(xs.fold(BigDecimal.ZERO) { s, r -> s + f(r).toBigDecimal() })
        DebtSideStats(sum { it.first.amount }, sum { it.second.repaid }, sum { it.second.pending }, xs.size)
    }
}
