package com.emitracker.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.emitracker.app.ui.Fmt
import com.emitracker.app.ui.LocalPalette
import com.emitracker.core.MonthSeries

data class Slice(val label: String, val value: Double, val color: Color)

@Composable
fun Donut(slices: List<Slice>, centerTop: String, centerValue: String, fmt: Fmt, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    val total = slices.sumOf { it.value }
    var selected by remember { mutableStateOf<Int?>(null) }
    Column(modifier.semantics { contentDescription = slices.joinToString { "${it.label} ${fmt.money(it.value)}" } }) {
        Box(Modifier.fillMaxWidth().height(170.dp), contentAlignment = Alignment.Center) {
            Canvas(Modifier.size(160.dp).pointerInput(slices) {
                detectTapGestures { o ->
                    val c = Offset(size.width / 2f, size.height / 2f)
                    var ang = Math.toDegrees(kotlin.math.atan2((o.y - c.y).toDouble(), (o.x - c.x).toDouble())) + 90
                    if (ang < 0) ang += 360
                    var acc = 0.0
                    selected = slices.indexOfFirst { acc += it.value / total * 360; ang <= acc }.takeIf { it >= 0 && total > 0 }
                }
            }) {
                val stroke = 20.dp.toPx()
                val r = Size(size.width - stroke, size.height - stroke)
                val tl = Offset(stroke / 2, stroke / 2)
                if (total <= 0) { drawArc(p.surface3, 0f, 360f, false, tl, r, style = Stroke(stroke)); return@Canvas }
                var start = -90f
                slices.forEachIndexed { i, s ->
                    val sweep = (s.value / total * 360).toFloat()
                    drawArc(s.color.copy(alpha = if (selected == null || selected == i) 1f else 0.35f), start, (sweep - 1.2f).coerceAtLeast(0.5f), false, tl, r, style = Stroke(stroke, cap = StrokeCap.Butt))
                    start += sweep
                }
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                val sel = selected?.let { slices.getOrNull(it) }
                Text(sel?.label ?: centerTop, style = MaterialTheme.typography.labelSmall, color = p.text3)
                Text(sel?.let { fmt.compact(it.value) } ?: centerValue, style = MaterialTheme.typography.titleLarge, color = p.text)
            }
        }
        slices.forEach { s ->
            Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(9.dp).clip(RoundedCornerShape(3.dp)).background(s.color))
                Spacer(Modifier.width(8.dp))
                Text(s.label, style = MaterialTheme.typography.bodySmall, color = p.text2, modifier = Modifier.weight(1f))
                Text(fmt.money(s.value), style = MaterialTheme.typography.bodySmall, color = p.text)
            }
        }
    }
}

/** Stacked principal / interest / fees bars per month; tap a bar for exact values. */
@Composable
fun MonthlyBars(data: List<MonthSeries>, fmt: Fmt, onMonth: ((String) -> Unit)? = null, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    var sel by remember(data) { mutableStateOf(data.lastIndex.takeIf { it >= 0 }) }
    if (data.isEmpty()) { Text("No payments in this range.", color = p.text3, style = MaterialTheme.typography.bodySmall); return }
    val max = (data.maxOf { it.paid }).coerceAtLeast(1.0)
    Column(modifier.semantics { contentDescription = "Monthly payments chart. " + data.takeLast(6).joinToString { "${fmt.month(it.month)} ${fmt.money(it.paid)}" } }) {
        sel?.let { i ->
            val m = data[i]
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(p.surface2).clickable(enabled = onMonth != null) { onMonth?.invoke(m.month) }.padding(10.dp)) {
                Column(Modifier.weight(1f)) {
                    Text(fmt.month(m.month), style = MaterialTheme.typography.labelMedium, color = p.text)
                    Text("Principal ${fmt.compact(m.principal)} · Interest ${fmt.compact(m.interest)}${if (m.fees > 0) " · Fees ${fmt.compact(m.fees)}" else ""}", style = MaterialTheme.typography.bodySmall, color = p.text2)
                }
                Text(fmt.money(m.paid), style = MaterialTheme.typography.titleSmall, color = p.text)
            }
            Spacer(Modifier.height(8.dp))
        }
        Canvas(Modifier.fillMaxWidth().height(150.dp).pointerInput(data) {
            detectTapGestures { o -> sel = (o.x / (size.width / data.size)).toInt().coerceIn(0, data.lastIndex) }
        }) {
            val w = size.width / data.size
            val bw = (w * 0.62f).coerceAtMost(26.dp.toPx())
            for (g in 1..3) drawLine(p.line, Offset(0f, size.height * g / 4), Offset(size.width, size.height * g / 4), 1f)
            data.forEachIndexed { i, m ->
                val x = i * w + (w - bw) / 2
                var y = size.height
                val alpha = if (sel == null || sel == i) 1f else 0.45f
                listOf(m.principal to p.accent, m.interest to p.warning, m.fees to p.danger).forEach { (v, c) ->
                    val h = (v / max * size.height).toFloat()
                    if (h > 0) { drawRect(c.copy(alpha = alpha), Offset(x, y - h), Size(bw, h)); y -= h }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
            Text(fmt.month(data.first().month), style = MaterialTheme.typography.labelSmall, color = p.text3, modifier = Modifier.weight(1f))
            Text(fmt.month(data.last().month), style = MaterialTheme.typography.labelSmall, color = p.text3)
        }
        Legend(listOf("Principal" to p.accent, "Interest" to p.warning, "Fees" to p.danger))
    }
}

@Composable
fun Legend(items: List<Pair<String, Color>>) {
    val p = LocalPalette.current
    Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        items.forEach { (l, c) ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).clip(RoundedCornerShape(2.dp)).background(c)); Spacer(Modifier.width(5.dp))
                Text(l, style = MaterialTheme.typography.labelSmall, color = p.text2)
            }
        }
    }
}

/** Actual paid bars vs scheduled (dashed line) and projected bars. */
@Composable
fun ActualVsScheduled(data: List<MonthSeries>, fmt: Fmt, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    var sel by remember(data) { mutableStateOf<Int?>(null) }
    if (data.isEmpty()) return
    val max = data.maxOf { maxOf(it.paid, it.scheduled, it.projected) }.coerceAtLeast(1.0)
    Column(modifier.semantics { contentDescription = "Actual versus scheduled payments" }) {
        sel?.let { i ->
            val m = data[i]
            Text("${fmt.month(m.month)} · paid ${fmt.money(m.paid)} · due ${fmt.money(m.scheduled)}${if (m.projected > 0) " · projected ${fmt.money(m.projected)}" else ""}",
                style = MaterialTheme.typography.bodySmall, color = p.text2, modifier = Modifier.padding(bottom = 6.dp))
        }
        Canvas(Modifier.fillMaxWidth().height(140.dp).pointerInput(data) { detectTapGestures { o -> sel = (o.x / (size.width / data.size)).toInt().coerceIn(0, data.lastIndex) } }) {
            val w = size.width / data.size
            val bw = (w * 0.55f).coerceAtMost(22.dp.toPx())
            val line = Path()
            data.forEachIndexed { i, m ->
                val x = i * w + (w - bw) / 2
                val hp = (m.paid / max * size.height).toFloat()
                val hj = (m.projected / max * size.height).toFloat()
                if (hp > 0) drawRoundRect(p.accent, Offset(x, size.height - hp), Size(bw, hp), CornerRadius(3f))
                if (hj > 0) drawRoundRect(p.info.copy(alpha = 0.35f), Offset(x, size.height - hj), Size(bw, hj), CornerRadius(3f))
                val y = size.height - (m.scheduled / max * size.height).toFloat()
                if (i == 0) line.moveTo(i * w + w / 2, y) else line.lineTo(i * w + w / 2, y)
            }
            drawPath(line, p.text3, style = Stroke(2f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 8f))))
        }
        Legend(listOf("Paid" to p.accent, "Projected" to p.info, "Scheduled" to p.text3))
    }
}

/** Outstanding balance: actual (solid) then projected (dashed); optional scenario overlay. */
@Composable
fun BalanceChart(points: List<Pair<String, Double>>, projectedFrom: Int, fmt: Fmt, compare: List<Pair<String, Double>>? = null, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    if (points.size < 2) return
    val max = (points.maxOf { it.second }).coerceAtLeast(1.0)
    val first = points.first().first; val last = maxOf(points.last().first, compare?.lastOrNull()?.first ?: "")
    val span = java.time.temporal.ChronoUnit.DAYS.between(java.time.LocalDate.parse(first), java.time.LocalDate.parse(last)).coerceAtLeast(1)
    fun xOf(d: String, w: Float) = (java.time.temporal.ChronoUnit.DAYS.between(java.time.LocalDate.parse(first), java.time.LocalDate.parse(d)).toFloat() / span * w)
    Column(modifier.semantics { contentDescription = "Outstanding balance from ${fmt.compact(points.first().second)} to zero by ${fmt.date(points.last().first)}" }) {
        Canvas(Modifier.fillMaxWidth().height(150.dp)) {
            for (g in 1..3) drawLine(p.line, Offset(0f, size.height * g / 4), Offset(size.width, size.height * g / 4), 1f)
            fun path(pts: List<Pair<String, Double>>) = Path().apply { pts.forEachIndexed { i, (d, v) -> val x = xOf(d, size.width); val y = size.height - (v / max * size.height).toFloat(); if (i == 0) moveTo(x, y) else lineTo(x, y) } }
            val actual = points.take(projectedFrom.coerceAtLeast(1))
            val proj = points.drop((projectedFrom - 1).coerceAtLeast(0))
            val area = path(actual).apply { lineTo(xOf(actual.last().first, size.width), size.height); lineTo(0f, size.height); close() }
            drawPath(area, Brush.verticalGradient(listOf(p.accent.copy(alpha = 0.28f), Color.Transparent)))
            drawPath(path(actual), p.accent, style = Stroke(2.5f))
            if (proj.size > 1) drawPath(path(proj), p.info, style = Stroke(2f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(12f, 8f))))
            compare?.takeIf { it.size > 1 }?.let { drawPath(path(it), p.positive, style = Stroke(2f)) }
        }
        Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
            Text(fmt.month(first.substring(0, 7)), style = MaterialTheme.typography.labelSmall, color = p.text3, modifier = Modifier.weight(1f))
            Text(fmt.month(last.substring(0, 7)), style = MaterialTheme.typography.labelSmall, color = p.text3)
        }
        Legend(listOfNotNull("Actual" to p.accent, "Projected" to p.info, compare?.let { "Scenario" to p.positive }))
    }
}

/** Horizontal bars from loan start to projected closure, with a "today" marker. */
@Composable
fun ClosureTimeline(items: List<Triple<String, Color, Pair<String, String?>>>, asOf: String, fmt: Fmt, onClick: (Int) -> Unit) {
    val p = LocalPalette.current
    if (items.isEmpty()) return
    val start = items.minOf { it.third.first }
    val end = maxOf(items.maxOf { it.third.second ?: asOf }, asOf)
    val span = java.time.temporal.ChronoUnit.DAYS.between(java.time.LocalDate.parse(start), java.time.LocalDate.parse(end)).coerceAtLeast(1).toFloat()
    fun frac(d: String) = java.time.temporal.ChronoUnit.DAYS.between(java.time.LocalDate.parse(start), java.time.LocalDate.parse(d)) / span
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items.forEachIndexed { i, (name, color, range) ->
            Column(Modifier.clickable { onClick(i) }.semantics(mergeDescendants = true) { contentDescription = "$name closes ${fmt.date(range.second)}" }) {
                Row { Text(name, style = MaterialTheme.typography.bodySmall, color = p.text, modifier = Modifier.weight(1f)); Text(range.second?.let { fmt.month(it.substring(0, 7)) } ?: "Never", style = MaterialTheme.typography.bodySmall, color = p.text2, fontWeight = FontWeight.Medium) }
                Canvas(Modifier.fillMaxWidth().height(10.dp).padding(top = 2.dp)) {
                    drawRoundRect(p.surface2, size = size, cornerRadius = CornerRadius(6f))
                    val s = frac(range.first) * size.width; val t = frac(asOf) * size.width; val e = frac(range.second ?: end) * size.width
                    drawRoundRect(color, Offset(s, 0f), Size((t - s).coerceAtLeast(0f), size.height), CornerRadius(6f))
                    drawRoundRect(color.copy(alpha = 0.35f), Offset(t, 0f), Size((e - t).coerceAtLeast(0f), size.height), CornerRadius(6f))
                    drawLine(p.text, Offset(t, -4f), Offset(t, size.height + 4f), 2f)
                }
            }
        }
    }
}
