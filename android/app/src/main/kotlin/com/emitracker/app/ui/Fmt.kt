package com.emitracker.app.ui

import android.icu.text.NumberFormat
import android.icu.util.Currency
import android.icu.util.ULocale
import com.emitracker.core.Preferences
import kotlin.math.abs

private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

/** Currency / date formatting from preferences (ICU gives Indian lakh-crore grouping for en-IN). */
class Fmt(private val p: Preferences) {
    private val cur: NumberFormat = NumberFormat.getCurrencyInstance(ULocale.forLanguageTag(p.locale)).apply {
        runCatching { currency = Currency.getInstance(p.currency) }
        minimumFractionDigits = p.decimals; maximumFractionDigits = p.decimals
    }
    private val symbol: String = runCatching { Currency.getInstance(p.currency).getSymbol(ULocale.forLanguageTag(p.locale)) }.getOrDefault(p.currency)

    fun money(v: String?): String = if (v.isNullOrBlank()) "—" else cur.format(v.toBigDecimal())
    fun money(v: Double): String = cur.format(v)

    fun compact(v: Double): String {
        val a = abs(v); val sign = if (v < 0) "-" else ""
        if (p.locale == "en-IN" && p.currency == "INR") {
            return when {
                a >= 1e7 -> "$sign₹%.2f Cr".format(a / 1e7)
                a >= 1e5 -> "$sign₹%.2f L".format(a / 1e5)
                a >= 1e3 -> "$sign₹%.1fK".format(a / 1e3)
                else -> "$sign₹%.0f".format(a)
            }
        }
        return when {
            a >= 1e9 -> "$sign$symbol%.1fB".format(a / 1e9)
            a >= 1e6 -> "$sign$symbol%.1fM".format(a / 1e6)
            a >= 1e3 -> "$sign$symbol%.1fK".format(a / 1e3)
            else -> "$sign$symbol%.0f".format(a)
        }
    }
    fun compact(v: String?) = compact(v?.toDoubleOrNull() ?: 0.0)
    val currencySymbol get() = symbol

    fun date(d: String?): String {
        if (d.isNullOrBlank() || d.length < 10) return "—"
        val y = d.substring(0, 4); val m = d.substring(5, 7); val day = d.substring(8, 10)
        return when (p.dateFormat) {
            "DD/MM/YYYY" -> "$day/$m/$y"
            "MM/DD/YYYY" -> "$m/$day/$y"
            "YYYY-MM-DD" -> d.substring(0, 10)
            else -> "$day ${MONTHS[m.toInt() - 1]} $y"
        }
    }
    fun month(key: String?): String = if (key == null || key.length < 7) "—" else "${MONTHS[key.substring(5, 7).toInt() - 1]} ${key.substring(0, 4)}"
    fun monthShort(key: String): String = MONTHS[key.substring(5, 7).toInt() - 1]
    fun pct(v: Double) = "%.1f%%".format(v)

    companion object { val monthNames = MONTHS }
}
