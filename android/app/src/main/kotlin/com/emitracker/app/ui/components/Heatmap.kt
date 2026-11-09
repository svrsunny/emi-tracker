package com.emitracker.app.ui.components

import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.drawText
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.emitracker.app.ui.Fmt
import com.emitracker.app.ui.LocalPalette
import com.emitracker.app.ui.Palette
import com.emitracker.core.Aggregate
import com.emitracker.core.CalendarState
import com.emitracker.core.DayCell
import com.emitracker.core.MonthCell
import com.emitracker.core.MonthMetric
import java.time.LocalDate

val HEAT_PALETTES: Map<String, List<Color>> = mapOf(
    "emerald" to listOf(Color(0xFF0E4429), Color(0xFF006D32), Color(0xFF26A641), Color(0xFF39D353)),
    "blue" to listOf(Color(0xFF0C2D6B), Color(0xFF1550B8), Color(0xFF2F7BF5), Color(0xFF7CB3FF)),
    "violet" to listOf(Color(0xFF2E1A5C), Color(0xFF4C2A9C), Color(0xFF7C4DDB), Color(0xFFB39BFF)),
    "amber" to listOf(Color(0xFF4A2F05), Color(0xFF8A5A0B), Color(0xFFD4911B), Color(0xFFF8C45C)),
    "rose" to listOf(Color(0xFF4C0F1F), Color(0xFF8C1C3A), Color(0xFFD33A63), Color(0xFFFF8FAB)),
)

fun stateColor(s: CalendarState, p: Palette): Color = when (s) {
    CalendarState.paid -> p.positive
    CalendarState.partial -> p.warning
    CalendarState.upcoming -> p.text3.copy(alpha = 0.55f)
    CalendarState.due -> p.info
    CalendarState.overdue -> p.danger
    CalendarState.missed -> Color(0xFFB5179E)
    CalendarState.prepaid -> p.violet
    CalendarState.extra -> p.accent
    CalendarState.waived -> p.text3
    else -> p.heat0
}

val STATE_LABELS = mapOf(
    CalendarState.paid to "Paid", CalendarState.prepaid to "Prepaid", CalendarState.extra to "Extra / prepayment", CalendarState.partial to "Partially paid",
    CalendarState.due to "Due", CalendarState.upcoming to "Upcoming", CalendarState.overdue to "Overdue", CalendarState.missed to "Missed", CalendarState.waived to "Waived",
)

/** Hatched fill marking "no data" (before tracking) — distinct from zero activity. */
fun Modifier.noData(p: Palette) = this.background(p.heat0).drawBehind {
    val step = 6f
    var x = -size.height
    while (x < size.width) {
        drawLine(p.line2, Offset(x, size.height), Offset(x + size.height, 0f), 2f)
        x += step
    }
}

enum class DayMetric(val label: String) { amount("Amount"), principal("Principal"), interest("Interest"), count("Count") }

fun dayValue(c: DayCell, m: DayMetric): Double = when (m) {
    DayMetric.amount -> c.amount.toDouble(); DayMetric.principal -> c.principal.toDouble(); DayMetric.interest -> c.interest.toDouble(); DayMetric.count -> c.count.toDouble()
}

/**
 * GitHub-style daily grid (weeks as columns), drawn as one Canvas so long ranges scroll smoothly.
 * Tapping a day selects it (details are shown below the grid); `calendar` mode colours by EMI
 * state instead of amount.
 */
@Composable
fun DailyHeatmap(cells: Map<String, DayCell>, from: String, to: String, asOf: String, thresholds: List<Double>, palette: List<Color>, metric: DayMetric,
                 calendarMode: Boolean, weekStart: Int, selected: String?, fmt: Fmt, onSelect: (DayCell) -> Unit) {
    val p = LocalPalette.current
    val weeks = remember(from, to, weekStart) {
        var start = LocalDate.parse(from)
        val wd = start.dayOfWeek.value % 7 // Sunday = 0
        start = start.minusDays(((wd - weekStart + 7) % 7).toLong())
        val end = LocalDate.parse(to)
        generateSequence(start) { it.plusWeeks(1) }.takeWhile { !it.isAfter(end) }.map { w -> (0..6).map { w.plusDays(it.toLong()).toString() } }.toList()
    }
    // colour of every cell, computed once per data change rather than on every frame
    val colors = remember(cells, weeks, thresholds, palette, metric, calendarMode, asOf, p) {
        weeks.map { w ->
            w.map { d ->
                val c = cells[d] ?: return@map null
                val noData = !c.hasData && c.count == 0 && (if (calendarMode) c.state == CalendarState.no_data else d <= asOf)
                when {
                    noData -> Color.Unspecified
                    calendarMode -> if (c.state == CalendarState.none) p.heat0 else stateColor(c.state, p)
                    else -> Aggregate.intensity(dayValue(c, metric), thresholds).let { if (it == 0) p.heat0 else palette[it - 1] }
                }
            }
        }
    }
    val monthLabels = remember(weeks) { weeks.mapIndexed { wi, w -> w.firstOrNull { it.endsWith("-01") }?.let { fmt.monthShort(it) } ?: if (wi == 0) fmt.monthShort(w[0]) else "" } }
    val dayNames = if (weekStart == 1) listOf("M", "", "W", "", "F", "", "S") else listOf("S", "", "T", "", "T", "", "S")
    val scroll = rememberScrollState()
    LaunchedEffect(weeks.size) { scroll.scrollTo(scroll.maxValue) }
    val measurer = rememberTextMeasurer()
    val labelStyle = MaterialTheme.typography.labelSmall.copy(color = p.text3)
    val density = LocalDensity.current
    val cell = 14.dp; val gap = 3.dp; val top = 16.dp; val left = 16.dp
    val width = left + (cell + gap) * weeks.size
    val height = top + (cell + gap) * 7
    val activeDays = remember(cells) { cells.values.count { it.count > 0 } }

    Box(Modifier.horizontalScroll(scroll)) {
        Canvas(Modifier.size(width, height)
            .semantics { contentDescription = "Daily heatmap from ${fmt.date(from)} to ${fmt.date(to)}: $activeDays day(s) with payments. Tap a day for details." }
            .pointerInput(weeks, cells) {
                detectTapGestures { o ->
                    val step = (cell + gap).toPx()
                    val wi = ((o.x - left.toPx()) / step).toInt()
                    val di = ((o.y - top.toPx()) / step).toInt()
                    if (o.x >= left.toPx() && o.y >= top.toPx() && wi in weeks.indices && di in 0..6) cells[weeks[wi][di]]?.let(onSelect)
                }
            }) {
            val cs = cell.toPx(); val step = (cell + gap).toPx(); val l = left.toPx(); val t = top.toPx()
            val radius = CornerRadius(3.dp.toPx())
            dayNames.forEachIndexed { i, n -> if (n.isNotEmpty()) drawText(measurer, n, Offset(0f, t + i * step), labelStyle) }
            weeks.forEachIndexed { wi, w ->
                val x = l + wi * step
                if (monthLabels[wi].isNotEmpty()) drawText(measurer, monthLabels[wi], Offset(x, 0f), labelStyle)
                w.forEachIndexed { di, d ->
                    val color = colors[wi][di] ?: return@forEachIndexed
                    val tl = Offset(x, t + di * step)
                    val sz = Size(cs, cs)
                    if (color == Color.Unspecified) {
                        drawRoundRect(p.heat0, tl, sz, radius)
                        clipRect(tl.x, tl.y, tl.x + cs, tl.y + cs) {
                            var hx = -cs
                            while (hx < cs) { drawLine(p.line2, Offset(tl.x + hx, tl.y + cs), Offset(tl.x + hx + cs, tl.y), 2f); hx += 6f }
                        }
                    } else drawRoundRect(color, tl, sz, radius)
                    if (d > asOf) drawRoundRect(Color.Black.copy(alpha = 0.25f), tl, sz, radius)
                    if (d == selected) drawRoundRect(p.text, tl, sz, radius, style = Stroke(with(density) { 1.5.dp.toPx() }))
                }
            }
        }
    }
}

@Composable
fun IntensityLegend(palette: List<Color>, thresholds: List<Double>, format: (Double) -> String) {
    val p = LocalPalette.current
    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.Center, modifier = Modifier.padding(top = 8.dp)) {
        Box(Modifier.size(11.dp).clip(RoundedCornerShape(3.dp)).noData(p)); Text(" No data   ", style = MaterialTheme.typography.labelSmall, color = p.text3)
        Text("0 ", style = MaterialTheme.typography.labelSmall, color = p.text3)
        Box(Modifier.size(11.dp).clip(RoundedCornerShape(3.dp)).background(p.heat0))
        palette.forEach { Box(Modifier.size(11.dp).clip(RoundedCornerShape(3.dp)).background(it)) }
        Text(" ${format(thresholds.last())}+", style = MaterialTheme.typography.labelSmall, color = p.text3)
    }
}

@Composable
fun StateLegend() {
    val p = LocalPalette.current
    FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(top = 8.dp)) {
        STATE_LABELS.forEach { (s, l) ->
            Row(verticalAlignment = Alignment.CenterVertically) { Box(Modifier.size(10.dp).clip(RoundedCornerShape(3.dp)).background(stateColor(s, p))); Text(" $l", style = MaterialTheme.typography.labelSmall, color = p.text2) }
        }
        Row(verticalAlignment = Alignment.CenterVertically) { Box(Modifier.size(10.dp).clip(RoundedCornerShape(3.dp)).noData(p)); Text(" No data", style = MaterialTheme.typography.labelSmall, color = p.text2) }
    }
}

fun monthColor(c: MonthCell, metric: MonthMetric, thresholds: List<Double>, palette: List<Color>, p: Palette): Color? {
    if (!c.hasData) return null
    return when (metric) {
        MonthMetric.completion -> c.completionPct?.let { pct -> when { pct >= 100 -> palette[3]; pct >= 75 -> palette[2]; pct >= 50 -> palette[1]; pct > 0 -> palette[0]; else -> p.danger.copy(alpha = 0.45f) } } ?: p.heat0
        MonthMetric.missed -> if (c.missedOrOverdue > 0) p.danger.copy(alpha = (0.35f + c.missedOrOverdue * 0.2f).coerceAtMost(1f)) else p.heat0
        MonthMetric.installments -> Aggregate.intensity(c.installmentsPaid.toDouble(), listOf(0.0, 1.0, 2.0, 4.0)).let { if (it == 0) p.heat0 else palette[it - 1] }
        else -> Aggregate.intensity(Aggregate.metricValue(c, metric), thresholds).let { if (it == 0) p.heat0 else palette[it - 1] }
    }
}

fun monthText(c: MonthCell, metric: MonthMetric, fmt: Fmt): String = when (metric) {
    MonthMetric.installments -> "${c.installmentsPaid} installment(s) paid"
    MonthMetric.missed -> "${c.missedOrOverdue} overdue / missed"
    MonthMetric.completion -> c.completionPct?.let { "$it% of scheduled paid" } ?: "Nothing scheduled"
    else -> fmt.money(Aggregate.metricValue(c, metric))
}

/** Years (rows) × months (columns). */
@Composable
fun MonthlyHeatmap(cells: Map<String, MonthCell>, metric: MonthMetric, thresholds: List<Double>, palette: List<Color>, selected: String?, fmt: Fmt, onSelect: (MonthCell) -> Unit) {
    val p = LocalPalette.current
    val years = cells.keys.map { it.substring(0, 4) }.distinct().sorted()
    Column(Modifier.horizontalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row {
            Spacer(Modifier.width(40.dp))
            Fmt.monthNames.forEach { Text(it.take(3), style = MaterialTheme.typography.labelSmall, color = p.text3, textAlign = TextAlign.Center, modifier = Modifier.width(44.dp)) }
        }
        years.forEach { y ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(y, style = MaterialTheme.typography.labelMedium, color = p.text2, modifier = Modifier.width(40.dp))
                (1..12).forEach { m ->
                    val key = "$y-%02d".format(m)
                    val c = cells[key]
                    if (c == null) Spacer(Modifier.size(width = 44.dp, height = 34.dp)) else {
                        val color = monthColor(c, metric, thresholds, palette, p)
                        Box(Modifier.padding(end = 4.dp).size(width = 40.dp, height = 34.dp).clip(RoundedCornerShape(6.dp))
                            .then(if (color == null) Modifier.noData(p) else Modifier.background(color))
                            .then(if (selected == key) Modifier.border(1.5.dp, p.text, RoundedCornerShape(6.dp)) else Modifier)
                            .clickable(role = Role.Button) { onSelect(c) }
                            .semantics { contentDescription = "${fmt.month(key)}: ${if (c.hasData) monthText(c, metric, fmt) else "no data"}" },
                            contentAlignment = Alignment.Center) {
                            if (c.hasData) Text(short(c, metric), style = MaterialTheme.typography.labelSmall, color = p.text, maxLines = 1)
                        }
                    }
                }
            }
        }
    }
}

private fun short(c: MonthCell, metric: MonthMetric): String = when (metric) {
    MonthMetric.installments -> if (c.installmentsPaid > 0) "${c.installmentsPaid}" else ""
    MonthMetric.missed -> if (c.missedOrOverdue > 0) "${c.missedOrOverdue}" else ""
    MonthMetric.completion -> c.completionPct?.let { "$it%" } ?: ""
    else -> Aggregate.metricValue(c, metric).let { v -> when { v <= 0 -> ""; v >= 1e5 -> "%.1fL".format(v / 1e5); v >= 1e3 -> "%.0fK".format(v / 1e3); else -> "%.0f".format(v) } }
}

@Composable
fun SelectedLine(text: String) {
    val p = LocalPalette.current
    Text(text, style = MaterialTheme.typography.bodySmall, color = p.text2, modifier = Modifier.fillMaxWidth().padding(top = 6.dp))
}
