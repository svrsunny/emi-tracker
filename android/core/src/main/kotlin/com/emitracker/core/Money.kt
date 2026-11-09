package com.emitracker.core

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode

/**
 * Decimal-safe money arithmetic — the same policy as the desktop app
 * (docs/FINANCIAL_CALCULATIONS.md):
 *  - money is stored as 2-decimal strings ("12345.67");
 *  - intermediate maths uses 40 significant digits;
 *  - every posted component is rounded HALF_UP to 2 decimals when posted;
 *  - EMI rounding is configurable per loan.
 */
object Money {
    val MC: MathContext = MathContext(40, RoundingMode.HALF_UP)
    val ZERO: BigDecimal = BigDecimal.ZERO
    /** Amounts at or below half a paisa are treated as settled. */
    val EPS: BigDecimal = BigDecimal("0.005")
    private val MONEY_RE = Regex("^-?\\d{1,13}(\\.\\d{1,2})?$")

    fun dec(s: String?): BigDecimal = if (s.isNullOrBlank()) ZERO else BigDecimal(s.trim())
    fun round2(v: BigDecimal): BigDecimal = v.setScale(2, RoundingMode.HALF_UP)
    fun money(v: BigDecimal): String = round2(v).toPlainString()
    fun money(s: String?): String = money(dec(s))
    fun isMoney(s: String): Boolean = MONEY_RE.matches(s.trim())

    fun roundEmi(v: BigDecimal, mode: String): BigDecimal = when (mode) {
        "paisa" -> v.setScale(2, RoundingMode.HALF_UP)
        "rupee_up" -> v.setScale(0, RoundingMode.CEILING)
        else -> v.setScale(0, RoundingMode.HALF_UP)
    }

    /** P * r * (1+r)^n / ((1+r)^n - 1); r = 0 => P / n. */
    fun emiFormula(principal: BigDecimal, periodicRate: BigDecimal, n: Int): BigDecimal {
        if (n <= 0) return principal
        if (periodicRate.signum() == 0) return principal.divide(BigDecimal(n), MC)
        val f = periodicRate.add(BigDecimal.ONE).pow(n, MC)
        return principal.multiply(periodicRate, MC).multiply(f, MC).divide(f.subtract(BigDecimal.ONE), MC)
    }
}

internal fun BigDecimal.d(other: BigDecimal): BigDecimal = this.divide(other, Money.MC)
internal fun BigDecimal.d(n: Int): BigDecimal = this.divide(BigDecimal(n), Money.MC)
internal fun BigDecimal.m(other: BigDecimal): BigDecimal = this.multiply(other, Money.MC)
internal fun BigDecimal.m(n: Int): BigDecimal = this.multiply(BigDecimal(n), Money.MC)
internal fun minD(a: BigDecimal, b: BigDecimal) = if (a < b) a else b
internal fun maxD(a: BigDecimal, b: BigDecimal) = if (a > b) a else b
internal val BigDecimal.pos get() = this.signum() > 0
