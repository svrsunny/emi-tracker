package com.emitracker.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.ShowChart
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import com.emitracker.app.ui.AppViewModel
import com.emitracker.app.ui.LocalPalette
import com.emitracker.app.ui.Screen
import com.emitracker.app.ui.components.BalanceChart
import com.emitracker.app.ui.components.Callout
import com.emitracker.app.ui.components.CalloutKind
import com.emitracker.app.ui.components.ClosureTimeline
import com.emitracker.app.ui.components.DailyHeatmap
import com.emitracker.app.ui.components.DateField
import com.emitracker.app.ui.components.DayMetric
import com.emitracker.app.ui.components.Dropdown
import com.emitracker.app.ui.components.EmiCard
import com.emitracker.app.ui.components.EmptyState
import com.emitracker.app.ui.components.EstimateTag
import com.emitracker.app.ui.components.Field
import com.emitracker.app.ui.components.HEAT_PALETTES
import com.emitracker.app.ui.components.IntensityLegend
import com.emitracker.app.ui.components.KvRow
import com.emitracker.app.ui.components.MoneyField
import com.emitracker.app.ui.components.MonthlyHeatmap
import com.emitracker.app.ui.components.ProjectedTag
import com.emitracker.app.ui.components.Segmented
import com.emitracker.app.ui.components.StateLegend
import com.emitracker.app.ui.components.StatusChip
import com.emitracker.app.ui.components.dayValue
import com.emitracker.app.ui.components.monthColor
import com.emitracker.app.ui.components.monthText
import com.emitracker.app.ui.components.noData
import com.emitracker.app.ui.components.stateColor
import com.emitracker.app.ui.Fmt
import com.emitracker.app.ui.parseColor
import com.emitracker.core.Aggregate
import com.emitracker.core.CalendarState
import com.emitracker.core.Dates
import com.emitracker.core.DayCell
import com.emitracker.core.Filters
import com.emitracker.core.Forecast
import com.emitracker.core.MonthCell
import com.emitracker.core.MonthMetric
import com.emitracker.core.Scenario
import java.time.LocalDate

@Composable
fun HeatmapScreen(vm: AppViewModel, nav: NavHostController, focusDate: String?) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val p = LocalPalette.current
    val fmt = ui.fmt
    var mode by rememberSaveable { mutableStateOf("daily") }
    var loanId by rememberSaveable { mutableStateOf<String?>(null) }
    var metric by rememberSaveable { mutableStateOf(DayMetric.amount) }
    var mMetric by rememberSaveable { mutableStateOf(MonthMetric.amount) }
    var auto by rememberSaveable { mutableStateOf(false) }
    val currentYear = ui.asOf.substring(0, 4).toInt()
    val years = remember(ui) {
        val first = ui.data.loans.minOfOrNull { it.startDate.substring(0, 4).toInt() } ?: currentYear
        val last = ui.data.loans.maxOfOrNull { (ui.comps[it.id]?.summary?.closureDate ?: ui.asOf).substring(0, 4).toInt() } ?: currentYear
        (minOf(first, currentYear)..maxOf(last, currentYear)).toList()
    }
    var year by rememberSaveable { mutableStateOf(focusDate?.substring(0, 4)?.toInt() ?: 0) } // 0 = last 12 months
    var selDay by remember { mutableStateOf<DayCell?>(null) }
    var selMonth by remember { mutableStateOf<MonthCell?>(null) }
    val pf = portfolio(ui)
    val filters = Filters(loanIds = loanId?.let { listOf(it) })
    val from = if (year == 0) Dates.addDays(Dates.addMonths(ui.asOf, -12), 1) else "$year-01-01"
    val to = if (year == 0) (if (mode == "calendar") Dates.addDays(ui.asOf, 90) else ui.asOf) else "$year-12-31"
    val palette = HEAT_PALETTES[ui.prefs.heatmapPalette] ?: HEAT_PALETTES.getValue("emerald")
    val days = remember(ui, from, to, loanId) { Aggregate.dailyCells(pf, from, to, ui.asOf, filters) }
    val months = remember(ui, loanId, years) { Aggregate.monthlyCells(pf, "${years.first()}-01", "${years.last()}-12", ui.asOf, filters) }
    val th = if (auto || metric == DayMetric.count) (if (metric == DayMetric.count) listOf(0.0, 1.0, 2.0, 3.0) else Aggregate.autoThresholds(days.values.map { dayValue(it, metric) })) else ui.prefs.heatmapThresholds.map { it.toDouble() }
    val mTh = if (auto) Aggregate.autoThresholds(months.values.map { Aggregate.metricValue(it, mMetric) }) else ui.prefs.heatmapThresholds.map { it * 4.0 }
    if (focusDate != null && selDay == null) days[focusDate]?.let { selDay = it }

    Screen("Heatmaps", "What you actually paid · hatched = no data, not zero") {
        item { LoanFilterRow(ui, loanId) { loanId = it } }
        item { Segmented(listOf("daily" to "Daily", "weekly" to "Weekly", "monthly" to "Monthly", "yearly" to "Yearly", "loans" to "Compare loans", "calendar" to "Scheduled vs actual"), mode, { mode = it; selDay = null; selMonth = null }) }
        if (mode == "daily" || mode == "calendar") item { Segmented(listOf(0 to if (mode == "calendar") "Last 12 + next 3 mo" else "Last 12 months") + years.map { it to "$it" }, year, { year = it; selDay = null }) }
        if (mode == "daily") item { Segmented(DayMetric.entries.map { it to it.label }, metric, { metric = it }) }
        if (mode == "monthly" || mode == "loans") item { Segmented(MonthMetric.entries.map { it to it.label }, mMetric, { mMetric = it }) }
        if (mode != "calendar") item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Segmented(HEAT_PALETTES.keys.map { it to it.replaceFirstChar(Char::uppercase) }, ui.prefs.heatmapPalette, { vm.act { vm.repo.setPreferences(ui.prefs.copy(heatmapPalette = it)) } })
            }
        }
        if (mode != "calendar") item { Segmented(listOf(false to "My thresholds", true to "Auto (quartiles)"), auto, { auto = it }) }
        item {
            EmiCard(title = when (mode) { "calendar" -> "Scheduled and actual payments"; "loans" -> "Loan comparison"; else -> "${mode.replaceFirstChar(Char::uppercase)} activity" },
                sub = if (mode == "daily") "${days.values.count { it.count > 0 }} day(s) with payments · ${fmt.money(days.values.sumOf { it.amount.toDouble() })}" else null) {
                when (mode) {
                    "daily", "calendar" -> {
                        DailyHeatmap(days, from, to, ui.asOf, th, palette, metric, mode == "calendar", ui.prefs.weekStart, selDay?.date, fmt) { selDay = it }
                        if (mode == "calendar") StateLegend() else IntensityLegend(palette, th) { if (metric == DayMetric.count) "%.0f".format(it) else fmt.compact(it) }
                    }
                    "monthly" -> { MonthlyHeatmap(months, mMetric, mTh, palette, selMonth?.month, fmt) { selMonth = it }; IntensityLegend(palette, mTh) { fmt.compact(it) } }
                    "weekly" -> WeeklyStrip(ui.fmt, remember(ui, loanId, years) { Aggregate.dailyCells(pf, "${years.first()}-01-01", "${years.last()}-12-31", ui.asOf, filters) }, years, palette, if (auto) null else ui.prefs.heatmapThresholds.map { it * 1.5 })
                    "yearly" -> YearlyCards(fmt, months, palette) { y -> year = y; mode = "daily" }
                    "loans" -> {
                        val y = years.lastOrNull { it <= currentYear } ?: currentYear
                        Text("$y", style = MaterialTheme.typography.labelMedium, color = p.text2)
                        ui.data.loans.filter { it.status != "archived" }.forEach { l ->
                            val cells = remember(ui, l.id, y) { Aggregate.monthlyCells(pf, "$y-01", "$y-12", ui.asOf, Filters(loanIds = listOf(l.id))) }
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 3.dp)) {
                                Box(Modifier.size(8.dp).clip(CircleShape).background(parseColor(l.color))); Spacer(Modifier.width(6.dp))
                                Text(l.name, style = MaterialTheme.typography.bodySmall, color = p.text, maxLines = 1, modifier = Modifier.width(96.dp))
                                cells.values.forEach { c ->
                                    val color = monthColor(c, mMetric, mTh, palette, p)
                                    Box(Modifier.weight(1f).padding(1.dp).aspectRatio(1f).clip(RoundedCornerShape(4.dp))
                                        .then(if (color == null) Modifier.noData(p) else Modifier.background(color))
                                        .clickable { nav.navigate("payments?loan=${l.id}&month=${c.month}") }
                                        .semantics { contentDescription = "${l.name} ${fmt.month(c.month)}: ${if (c.hasData) monthText(c, mMetric, fmt) else "no data"}" })
                                }
                            }
                        }
                        IntensityLegend(palette, mTh) { fmt.compact(it) }
                    }
                }
            }
        }
        selDay?.let { c -> item { DayDetails(ui, c, nav) } }
        selMonth?.let { c ->
            item {
                EmiCard(title = fmt.month(c.month)) {
                    if (!c.hasData) Callout("No records for this month. Tracking had not started or nothing was entered — not the same as a missed payment.")
                    else {
                        KvRow("Total paid", fmt.money(c.amount.toPlainString())); KvRow("Principal", fmt.money(c.principal.toPlainString())); KvRow("Interest", fmt.money(c.interest.toPlainString()))
                        KvRow("Fees & penalties", fmt.money(c.fees.toPlainString())); KvRow("Payments", "${c.count}"); KvRow("Installments paid", "${c.installmentsPaid} of ${c.scheduledCount} due")
                        KvRow("Overdue / missed", "${c.missedOrOverdue}"); KvRow("Completion", c.completionPct?.let { "$it%" } ?: "—")
                    }
                    TextButton(onClick = { nav.navigate("payments?month=${c.month}${loanId?.let { "&loan=$it" } ?: ""}") }) { Text("Open payment records") }
                }
            }
        }
        if (selDay == null && selMonth == null) item {
            Callout("Tap a cell for details. Colour intensity is the amount actually paid; thresholds are set in Settings. Past installments with no record are never shown as missed unless you mark them missed.")
        }
    }
}

@Composable
private fun DayDetails(ui: com.emitracker.app.ui.UiState, c: DayCell, nav: NavHostController) {
    val fmt = ui.fmt
    val p = LocalPalette.current
    EmiCard(title = fmt.date(c.date)) {
        if (!c.hasData && c.count == 0 && c.date <= ui.asOf) Callout("No data recorded for this date (before tracking started).")
        if (c.count > 0) {
            KvRow("Total paid", fmt.money(c.amount.toPlainString())); KvRow("Payments", "${c.count}"); KvRow("Principal", fmt.money(c.principal.toPlainString()))
            KvRow("Interest", fmt.money(c.interest.toPlainString())); KvRow("Fees & penalties", fmt.money((c.fees + c.penalty).toPlainString()))
            KvRow("Loans", c.loanIds.mapNotNull { id -> ui.data.loans.firstOrNull { it.id == id }?.name }.joinToString())
        } else if (c.hasData) Text("No payments on this day.", color = p.text3, style = MaterialTheme.typography.bodySmall)
        c.scheduled.forEach { s ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 3.dp)) {
                Text(ui.data.loans.firstOrNull { it.id == s.loanId }?.name ?: "", style = MaterialTheme.typography.bodySmall, color = p.text, modifier = Modifier.weight(1f))
                StatusChip(s.status); Spacer(Modifier.width(8.dp)); Text(fmt.money(s.amount), style = MaterialTheme.typography.bodySmall, color = p.text)
            }
        }
        ui.data.payments.filter { it.id in c.paymentIds }.forEach { x ->
            KvRow("${ui.data.loans.firstOrNull { it.id == x.loanId }?.name} · ${PAYMENT_TYPE_LABEL[x.type]}${if (x.reference.isNotBlank()) " · " + x.reference else ""}", fmt.money(x.amount))
        }
        if (c.count > 0 || c.scheduled.isNotEmpty()) TextButton(onClick = { nav.navigate("payments?date=${c.date}") }) { Text("Open in payment tracker") }
    }
}

@Composable
private fun WeeklyStrip(fmt: Fmt, days: Map<String, DayCell>, years: List<Int>, palette: List<Color>, thresholds: List<Double>?) {
    val p = LocalPalette.current
    val weeks = days.values.groupBy { Dates.isoWeekKey(it.date) }.mapValues { (_, v) -> Triple(v.sumOf { it.amount.toDouble() }, v.sumOf { it.count }, v.any { it.hasData }) }
    val th = thresholds ?: Aggregate.autoThresholds(weeks.values.map { it.first })
    years.forEach { y ->
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 2.dp)) {
            Text("$y", style = MaterialTheme.typography.labelSmall, color = p.text2, modifier = Modifier.width(36.dp))
            (1..53).forEach { w ->
                val key = "$y-W%02d".format(w)
                val v = weeks[key]
                Box(Modifier.weight(1f).height(20.dp).padding(horizontal = 0.5.dp).clip(RoundedCornerShape(2.dp))
                    .then(when { v == null -> Modifier; !v.third -> Modifier.noData(p); else -> Modifier.background(Aggregate.intensity(v.first, th).let { if (it == 0) p.heat0 else palette[it - 1] }) })
                    .semantics { contentDescription = "Week $w of $y: ${if (v?.third == true) "${fmt.money(v.first)}, ${v.second} payments" else "no data"}" })
            }
        }
    }
    IntensityLegend(palette, th) { fmt.compact(it) }
}

@Composable
private fun YearlyCards(fmt: Fmt, months: Map<String, MonthCell>, palette: List<Color>, onYear: (Int) -> Unit) {
    val p = LocalPalette.current
    val ys = months.values.groupBy { it.month.substring(0, 4).toInt() }.toSortedMap()
    val th = Aggregate.autoThresholds(ys.values.map { v -> v.sumOf { it.amount.toDouble() } })
    ys.forEach { (y, cs) ->
        val total = cs.sumOf { it.amount.toDouble() }; val has = cs.any { it.hasData }
        val lvl = Aggregate.intensity(total, th)
        Row(Modifier.fillMaxWidth().padding(vertical = 4.dp).clip(RoundedCornerShape(10.dp)).background(p.surface2).clickable { onYear(y) }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(14.dp).clip(RoundedCornerShape(4.dp)).then(if (!has) Modifier.noData(p) else Modifier.background(if (lvl == 0) p.heat0 else palette[lvl - 1])))
            Text("  $y", style = MaterialTheme.typography.titleSmall, color = p.text, modifier = Modifier.weight(1f))
            Text(if (has) "${fmt.compact(total)} · ${cs.sumOf { it.count }} payments" else "No data", style = MaterialTheme.typography.bodySmall, color = p.text2)
        }
    }
}

@Composable
fun CalendarScreen(vm: AppViewModel, nav: NavHostController) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val p = LocalPalette.current
    val fmt = ui.fmt
    var month by rememberSaveable { mutableStateOf(Dates.startOfMonth(ui.asOf)) }
    var sel by rememberSaveable { mutableStateOf(ui.asOf) }
    var loanId by rememberSaveable { mutableStateOf<String?>(null) }
    val first = LocalDate.parse(month)
    val lead = ((first.dayOfWeek.value % 7) - ui.prefs.weekStart + 7) % 7
    val gridStart = first.minusDays(lead.toLong()).toString()
    val gridEnd = Dates.addDays(gridStart, 41)
    val cells = remember(ui, gridStart, loanId) { Aggregate.dailyCells(portfolio(ui), gridStart, gridEnd, ui.asOf, Filters(loanIds = loanId?.let { listOf(it) })) }
    // bills due on each day (not when one loan is selected) and what was actually paid out each day
    val billsDue = remember(ui, gridStart, loanId) {
        if (loanId != null) emptyMap() else com.emitracker.core.Bills.occurrences(ui.data.bills, ui.data.billPayments, gridStart, gridEnd, ui.asOf).groupBy { it.dueDate }
    }
    val spent = remember(ui, gridStart, loanId) {
        com.emitracker.core.Spending.byDay(ui.data.loans, ui.data.payments, ui.data.bills, ui.data.billPayments, gridStart, gridEnd, loanId?.let { listOf(it) })
    }
    var payBill by remember { mutableStateOf<Pair<com.emitracker.core.Bill, String>?>(null) }
    val dows = if (ui.prefs.weekStart == 1) listOf("M", "T", "W", "T", "F", "S", "S") else listOf("S", "M", "T", "W", "T", "F", "S")
    val monthEnd = Dates.endOfMonth(month)
    val due = cells.values.filter { it.date in month..monthEnd }.sumOf { c -> c.scheduled.sumOf { it.amount.toDouble() } } +
        billsDue.filterKeys { it in month..monthEnd }.values.flatten().sumOf { (it.payment?.amount ?: it.bill.amount).toDouble() }
    val monthSpent = com.emitracker.core.Spending.totals(spent.filterKeys { it in month..monthEnd }.values.flatten())

    Screen("Calendar", "Due ${fmt.compact(due)} · spent ${fmt.compact(monthSpent.getValue("all").toDouble())} in ${fmt.month(month)}") {
        item { LoanFilterRow(ui, loanId) { loanId = it } }
        item {
            EmiCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { month = Dates.addMonths(month, -1) }) { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowLeft, "Previous month", tint = p.text) }
                    Text(fmt.month(month), style = MaterialTheme.typography.titleMedium, color = p.text, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
                    IconButton(onClick = { month = Dates.addMonths(month, 1) }) { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, "Next month", tint = p.text) }
                    TextButton(onClick = { month = Dates.startOfMonth(ui.asOf); sel = ui.asOf }) { Text("Today") }
                }
                Row { dows.forEach { Text(it, style = MaterialTheme.typography.labelSmall, color = p.text3, textAlign = TextAlign.Center, modifier = Modifier.weight(1f)) } }
                (0 until 6).forEach { w ->
                    Row {
                        (0 until 7).forEach { d ->
                            val date = Dates.addDays(gridStart, (w * 7 + d).toLong())
                            val c = cells[date]!!
                            val other = date < month || date > monthEnd
                            val bills = billsDue[date].orEmpty()
                            val daySpent = com.emitracker.core.Spending.totals(spent[date].orEmpty()).getValue("all").toDouble()
                            val dot = if (c.state == CalendarState.none || c.state == CalendarState.no_data) bills.firstOrNull()?.let { billColor(it.status, p) } else stateColor(c.state, p)
                            Column(Modifier.weight(1f).aspectRatio(0.9f).padding(2.dp).clip(RoundedCornerShape(8.dp))
                                .background(if (date == sel) p.accent.copy(alpha = 0.18f) else p.surface2.copy(alpha = if (other) 0.3f else 1f))
                                .then(if (date == ui.asOf) Modifier.border(1.dp, p.accent, RoundedCornerShape(8.dp)) else Modifier)
                                .clickable { sel = date }
                                .semantics { contentDescription = "${fmt.date(date)}: ${c.scheduled.size + bills.size} due${if (daySpent > 0) ", spent ${fmt.money(daySpent)}" else ""}" },
                                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                                Text("${date.substring(8).toInt()}", style = MaterialTheme.typography.labelMedium, color = if (other) p.text3 else p.text)
                                if (dot != null) Box(Modifier.padding(top = 2.dp).size(6.dp).clip(CircleShape).background(dot))
                                if (daySpent > 0) Text(fmt.compact(daySpent), style = MaterialTheme.typography.labelSmall, fontSize = 9.sp, color = p.positive, maxLines = 1)
                            }
                        }
                    }
                }
                StateLegend()
            }
        }
        item {
            EmiCard(title = "Spent in ${fmt.month(month)}", sub = "Money actually paid, by the day it was paid") {
                KvRow("Total", fmt.money(monthSpent["all"]))
                if (loanId == null) com.emitracker.core.SPEND_KINDS.forEach { k -> KvRow(SPEND_LABEL.getValue(k), fmt.money(monthSpent[k])) }
            }
        }
        cells[sel]?.let { c ->
            val selBills = billsDue[sel].orEmpty()
            val selSpent = spent[sel].orEmpty()
            item {
                EmiCard(title = fmt.date(sel), sub = if (sel == ui.asOf) "Today" else if (sel < ui.asOf) "Past" else "Upcoming") {
                    if (c.scheduled.isEmpty() && selBills.isEmpty() && selSpent.isEmpty()) Text("Nothing due or paid.", color = p.text3, style = MaterialTheme.typography.bodySmall)
                    c.scheduled.forEach { s ->
                        val l = ui.data.loans.firstOrNull { it.id == s.loanId } ?: return@forEach
                        val r = ui.comps[l.id]?.rows?.firstOrNull { it.no == s.no }
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 4.dp)) {
                            Column(Modifier.weight(1f)) { Text(l.name, color = p.text, style = MaterialTheme.typography.bodyMedium); Text("EMI #${r?.emiNo ?: s.no} · ${fmt.money(s.amount)}", color = p.text3, style = MaterialTheme.typography.bodySmall) }
                            StatusChip(s.status)
                            if (r != null && r.shortfall.toDouble() > 0 && l.status == "active") TextButton(onClick = { nav.navigate("payment?loanId=${l.id}&inst=${s.no}") }) { Text("Pay") }
                        }
                    }
                    selBills.forEach { o ->
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 4.dp)) {
                            Column(Modifier.weight(1f)) {
                                Text(o.bill.name, color = p.text, style = MaterialTheme.typography.bodyMedium)
                                Text("${if (o.bill.frequency == "once") "One-time" else "Bill"} · ${fmt.money(o.payment?.amount ?: o.bill.amount)} · ${BILL_STATUS_TEXT[o.status] ?: o.status}", color = billColor(o.status, p), style = MaterialTheme.typography.bodySmall)
                            }
                            if (o.payment == null && o.bill.active) TextButton(onClick = { payBill = o.bill to o.dueDate }) { Text("Mark paid") }
                        }
                    }
                    if (selSpent.isNotEmpty()) {
                        Spacer(Modifier.height(6.dp))
                        KvRow("Spent on this day", fmt.money(com.emitracker.core.Spending.totals(selSpent)["all"]), p.positive)
                        selSpent.forEach { x -> KvRow("${x.name} · ${SPEND_LABEL[x.kind]}", fmt.money(x.amount)) }
                    }
                }
            }
        }
    }
    payBill?.let { (b, d) -> BillPayDialog(vm, ui, b, d) { payBill = null } }
}

private val SPEND_LABEL = mapOf("loan" to "Loan EMIs", "chit" to "Chits", "bill" to "Bills", "one_time" to "One-time")
private val BILL_STATUS_TEXT = mapOf("paid" to "Paid", "overdue" to "Overdue", "due" to "Due today", "upcoming" to "Upcoming")
private fun billColor(status: String, p: com.emitracker.app.ui.Palette) = when (status) { "paid" -> p.positive; "overdue" -> p.danger; "due" -> p.info; else -> p.text3 }

@Composable
fun SchedulesScreen(vm: AppViewModel, nav: NavHostController, loanArg: String?) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val loans = ui.data.loans.filter { it.status != "archived" }
    var id by rememberSaveable { mutableStateOf(loanArg ?: loans.firstOrNull()?.id) }
    val loan = ui.data.loans.firstOrNull { it.id == id }
    val comp = loan?.let { ui.comps[it.id] }
    val export = com.emitracker.app.ui.rememberCsvExporter(vm)
    val fmt = ui.fmt
    Screen("Amortization", "Actual to date, contractual projection after", nav, back = true, actions = {
        if (loan != null && comp != null) TextButton(onClick = { export("${loan.name} - amortization.csv", scheduleCsv(loan, comp)) }) { Text("CSV") }
    }) {
        if (loan == null || comp == null) { item { EmiCard { EmptyState(Icons.Outlined.ShowChart, "No loans yet", "Add a loan to see its schedule.") } }; return@Screen }
        item { Segmented(loans.map { it.id to it.name }, id, { id = it }) }
        item {
            val s = comp.summary
            EmiCard {
                KvRow("Installments", "${s.totalInstallments} · ${s.installmentsPaid} paid · ${s.installmentsRemaining} left"); KvRow("Current EMI", fmt.money(s.currentEmi))
                KvRow("Interest paid / remaining", "${fmt.compact(s.interestPaid)} / ${fmt.compact(s.remainingInterest)}"); KvRow("Projected last payment", fmt.date(s.closureDate))
                if (s.isEstimate) EstimateTag("Contains estimates")
            }
        }
        scheduleItems(ui, loan, comp, nav)
    }
}

fun scheduleCsv(loan: com.emitracker.core.Loan, c: com.emitracker.core.LoanComputation): String = com.emitracker.core.Csv.write(
    listOf(listOf("Loan", "No", "EMI no", "Due date", "Rate %", "Opening principal", "Scheduled EMI", "Interest", "Principal due", "Actual paid", "Projected payment",
        "Principal paid", "Interest paid", "Fees & penalties", "Additional principal", "Capitalised", "Closing principal", "Unpaid", "Status", "Remaining installments", "Estimate")) +
        c.rows.map { r -> listOf(loan.name, r.no, r.emiNo ?: "M", r.dueDate, r.rate, r.openingPrincipal, r.scheduledAmount, r.interest, r.principalDue, r.paidAmount, r.projectedAmount,
            r.paidPrincipal, r.paidInterest, r.feesCharged, r.extraPrincipal, r.capitalized, r.closingPrincipal, r.shortfall, r.status.label, r.remainingInstallments,
            if (r.isEstimated) "yes" else if (r.isProjected) "projected" else "no") })

@Composable
fun WhatIfScreen(vm: AppViewModel, nav: NavHostController) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val p = LocalPalette.current
    val fmt = ui.fmt
    val active = ui.data.loans.filter { it.status == "active" }
    var loanId by rememberSaveable { mutableStateOf(active.firstOrNull()?.id) }
    val loan = active.firstOrNull { it.id == loanId }
    val base = loan?.let { ui.comps[it.id] }
    var scenarios by remember { mutableStateOf(listOf(Scenario(name = "EMI +10%", emiIncrease = base?.summary?.currentEmi?.toDoubleOrNull()?.let { Math.round(it * 0.1).toString() } ?: ""), Scenario(name = "Extra ₹5,000 / month", extraMonthly = "5000"))) }
    var chart by rememberSaveable { mutableStateOf(0) }
    val combined = Forecast.combined(active.mapNotNull { ui.comps[it.id] })
    Screen("Forecasts & what-if", "Same amortization rules as your schedule — never balance ÷ EMI", nav, back = true) {
        item {
            EmiCard(title = "All active loans", sub = "Combined contractual projection", hero = true) {
                Row(verticalAlignment = Alignment.CenterVertically) { Text("Debt-free by  ", color = p.text2); Text(if (combined.anyOpenEnded) "Not at current EMIs" else fmt.month(combined.allClosedBy?.substring(0, 7)), style = MaterialTheme.typography.titleLarge, color = if (combined.anyOpenEnded) p.danger else p.text); Spacer(Modifier.width(6.dp)); ProjectedTag() }
                KvRow("Remaining outflow", fmt.money(combined.remainingOutflow)); KvRow("of which interest", fmt.money(combined.remainingInterest))
                Spacer(Modifier.height(8.dp))
                ClosureTimeline(active.map { Triple(it.name, parseColor(it.color), it.startDate to ui.comps[it.id]!!.summary.closureDate) }, ui.asOf, fmt) { nav.navigate("loan/${active[it].id}") }
            }
        }
        if (loan == null || base == null) { item { EmiCard { EmptyState(Icons.Outlined.ShowChart, "No active loans", "Forecasts need at least one active loan.") } }; return@Screen }
        item { Segmented(active.map { it.id to it.name }, loanId, { loanId = it }) }
        if (base.summary.isEstimate) item { Callout("This loan's figures include estimates (${base.summary.warnings.firstOrNull() ?: ""}). Scenario results inherit that uncertainty.", CalloutKind.Warn) }
        item {
            val s = base.summary
            EmiCard(title = "Current contract", sub = "Contractual — continue the existing EMI") {
                KvRow("Closure", fmt.month(s.closureDate?.substring(0, 7))); KvRow("Remaining interest", fmt.money(s.remainingInterest)); KvRow("Total repayment", fmt.money(s.remainingCashOutflow))
                KvRow("Current EMI", fmt.money(s.currentEmi)); KvRow("Rate", "${base.rows.firstOrNull { it.no == s.currentInstallment }?.rate ?: loan.annualRate}%")
            }
        }
        val results = scenarios.map { Forecast.run(loan, ui.data.adjustments, ui.data.payments, ui.asOf, it, base) }
        scenarios.forEachIndexed { i, sc ->
            item(key = "sc-$i") {
                val r = results[i]
                EmiCard(title = null) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Field("Scenario name", sc.name, { v -> scenarios = scenarios.toMutableList().also { it[i] = sc.copy(name = v) } }, Modifier.weight(1f))
                        IconButton(onClick = { scenarios = scenarios.filterIndexed { j, _ -> j != i } }) { Icon(Icons.Outlined.DeleteOutline, "Remove scenario", tint = p.text3) }
                    }
                    fun upd(f: (Scenario) -> Scenario) { scenarios = scenarios.toMutableList().also { it[i] = f(sc) } }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        MoneyField("Increase EMI by", sc.emiIncrease, { v -> upd { it.copy(emiIncrease = v) } }, fmt.currencySymbol, Modifier.weight(1f))
                        MoneyField("Extra each month", sc.extraMonthly, { v -> upd { it.copy(extraMonthly = v) } }, fmt.currencySymbol, Modifier.weight(1f))
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        MoneyField("One-time prepayment", sc.oneTimeAmount, { v -> upd { it.copy(oneTimeAmount = v) } }, fmt.currencySymbol, Modifier.weight(1f))
                        DateField("On", sc.oneTimeDate, { v -> upd { it.copy(oneTimeDate = v) } }, Modifier.weight(1f), clearable = true)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        MoneyField("Annual prepayment", sc.annualAmount, { v -> upd { it.copy(annualAmount = v) } }, fmt.currencySymbol, Modifier.weight(1f))
                        Dropdown("Every", sc.annualMonth, Fmt.monthNames.mapIndexed { k, m -> (k + 1) to m }, { v -> upd { it.copy(annualMonth = v) } }, Modifier.weight(1f))
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Field("New rate", sc.newRate, { v -> upd { it.copy(newRate = v.filter { c -> c.isDigit() || c == '.' }) } }, Modifier.weight(1f), suffix = "%", keyboard = androidx.compose.ui.text.input.KeyboardType.Decimal)
                        Dropdown("Rate effect", sc.rateRecalc, listOf("keep_emi" to "Keep EMI", "recompute_emi" to "New EMI"), { v -> upd { it.copy(rateRecalc = v) } }, Modifier.weight(1f))
                    }
                    Dropdown("Prepayments", sc.prepaymentEffect, listOf("loan_default" to "Loan setting", "reduce_tenure" to "Reduce tenure", "reduce_emi" to "Reduce EMI"), { v -> upd { it.copy(prepaymentEffect = v) } })
                    Spacer(Modifier.height(8.dp))
                    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(p.surface2).padding(12.dp)) {
                        Column {
                            KvRow("Revised closure", if (r.nonConverging) "Never" else fmt.month(r.closureDate?.substring(0, 7)), if (r.nonConverging) p.danger else null)
                            KvRow("Months saved", when { r.monthsSaved > 0 -> "${r.monthsSaved} earlier"; r.monthsSaved < 0 -> "${-r.monthsSaved} later"; else -> "No change" }, if (r.monthsSaved > 0) p.positive else if (r.monthsSaved < 0) p.danger else null)
                            KvRow("Interest saved", fmt.money(r.interestSaved), if (r.interestSaved.toDouble() > 0) p.positive else if (r.interestSaved.toDouble() < 0) p.danger else null)
                            KvRow("Revised total repayment", fmt.money(r.totalRepayment))
                            KvRow("Extra cash / month", fmt.money(r.extraMonthlyCash) + if ((sc.annualAmount.toDoubleOrNull() ?: 0.0) > 0) " + ${fmt.compact(sc.annualAmount)} yearly" else "")
                        }
                    }
                }
            }
        }
        if (scenarios.size < 4) item { Button(onClick = { scenarios = scenarios + Scenario(name = "Scenario ${scenarios.size + 1}") }) { Icon(Icons.Outlined.Add, null); Text(" Add scenario") } }
        if (results.isNotEmpty()) item {
            EmiCard(title = "Balance: contract vs scenario") {
                Segmented(results.mapIndexed { i, r -> i to r.name }, chart.coerceAtMost(results.lastIndex), { chart = it })
                Spacer(Modifier.height(8.dp))
                val pts = base.rows.map { it.dueDate to it.closingPrincipal.toDouble() }
                val cmp = results[chart.coerceAtMost(results.lastIndex)].computation.rows.filter { it.dueDate > ui.asOf }.map { it.dueDate to it.closingPrincipal.toDouble() }
                BalanceChart(pts, base.rows.count { !it.isProjected || it.paidAmount.toDouble() > 0 }.coerceAtLeast(1), fmt, cmp)
            }
        }
        item { Text("Projection: assumes future EMIs are paid on their due dates. Hypothetical — nothing here changes your records.", style = MaterialTheme.typography.bodySmall, color = p.text3) }
    }
}
