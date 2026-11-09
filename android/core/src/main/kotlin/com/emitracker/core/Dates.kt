package com.emitracker.core

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.time.temporal.IsoFields

/** Civil-date helpers on ISO "YYYY-MM-DD" strings (identical semantics to the desktop app). */
object Dates {
    fun parse(s: String): LocalDate = LocalDate.parse(s)
    fun valid(s: String?): Boolean = s != null && runCatching { LocalDate.parse(s); Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(s) }.getOrDefault(false)
    fun addDays(s: String, n: Long): String = parse(s).plusDays(n).toString()
    fun diffDays(from: String, to: String): Long = ChronoUnit.DAYS.between(parse(from), parse(to))

    /** Add months, clamping to month length; `day` overrides the day of month. */
    fun addMonths(s: String, n: Long, day: Int? = null): String {
        val d = parse(s)
        val ym = java.time.YearMonth.from(d).plusMonths(n)
        val want = day ?: d.dayOfMonth
        return ym.atDay(minOf(want, ym.lengthOfMonth())).toString()
    }

    /** 0 = Sunday … 6 = Saturday. */
    fun weekday(s: String): Int = parse(s).dayOfWeek.let { if (it == DayOfWeek.SUNDAY) 0 else it.value }
    fun monthKey(s: String) = s.substring(0, 7)
    fun startOfMonth(s: String) = s.substring(0, 8) + "01"
    fun endOfMonth(s: String): String = parse(s).let { it.withDayOfMonth(it.lengthOfMonth()).toString() }
    fun isoWeekKey(s: String): String {
        val d = parse(s)
        return "%d-W%02d".format(d.get(IsoFields.WEEK_BASED_YEAR), d.get(IsoFields.WEEK_OF_WEEK_BASED_YEAR))
    }
}
