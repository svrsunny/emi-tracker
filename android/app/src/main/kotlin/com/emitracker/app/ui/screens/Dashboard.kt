package com.emitracker.app.ui.screens

import com.emitracker.app.data.Defaults
import androidx.compose.material.icons.outlined.NotificationAdd
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountBalance
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import com.emitracker.app.data.DemoData
import com.emitracker.app.ui.AppViewModel
import com.emitracker.app.ui.LocalPalette
import com.emitracker.app.ui.Screen
import com.emitracker.app.ui.UiState
import com.emitracker.app.ui.components.ActualVsScheduled
import com.emitracker.app.ui.components.ClosureTimeline
import com.emitracker.app.ui.components.DailyHeatmap
import com.emitracker.app.ui.components.DayMetric
import com.emitracker.app.ui.components.Donut
import com.emitracker.app.ui.components.EmiCard
import com.emitracker.app.ui.components.EmptyState
import com.emitracker.app.ui.components.EstimateTag
import com.emitracker.app.ui.components.HEAT_PALETTES
import com.emitracker.app.ui.components.IntensityLegend
import com.emitracker.app.ui.components.KvRow
import com.emitracker.app.ui.components.MonthlyBars
import com.emitracker.app.ui.components.ProgressLine
import com.emitracker.app.ui.components.ProjectedTag
import com.emitracker.app.ui.components.Segmented
import com.emitracker.app.ui.components.Slice
import com.emitracker.app.ui.components.Stat
import com.emitracker.app.ui.components.StatusChip
import com.emitracker.app.ui.parseColor
import com.emitracker.core.Aggregate
import com.emitracker.core.DASHBOARD_WIDGETS
import com.emitracker.core.Dates
import com.emitracker.core.DueItem
import com.emitracker.core.Filters
import com.emitracker.core.Portfolio
import com.emitracker.core.WidgetPref

fun rangeFor(r: String, asOf: String): Pair<String?, String?> = when (r) {
    "3m" -> Dates.addMonths(asOf, -3) to asOf
    "6m" -> Dates.addMonths(asOf, -6) to asOf
    "12m" -> Dates.addMonths(asOf, -12) to asOf
    "ytd" -> asOf.substring(0, 4) + "-01-01" to asOf
    else -> null to null
}

fun portfolio(ui: UiState) = Portfolio(ui.data.loans, ui.comps, ui.data.payments)

@Composable
fun LoanFilterRow(ui: UiState, selected: String?, onSelect: (String?) -> Unit) {
    val loans = ui.data.loans.filter { it.status != "archived" }
    if (loans.size > 1) Segmented(listOf<Pair<String?, String>>(null to "All loans") + loans.map { it.id to it.name }, selected, onSelect)
}

@Composable
fun DashboardScreen(vm: AppViewModel, nav: NavHostController) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val p = LocalPalette.current
    val fmt = ui.fmt
    var range by rememberSaveable { mutableStateOf(ui.prefs.dashboardRange) }
    var loanId by rememberSaveable { mutableStateOf<String?>(null) }
    var customize by remember { mutableStateOf(false) }
    var reminder by remember { mutableStateOf<com.emitracker.core.CustomReminder?>(null) }
    reminder?.let { r -> CustomReminderDialog(vm, ui, r) { reminder = null } }

    if (ui.data.loans.isEmpty()) {
        Screen("Dashboard", "Your private loan ledger") {
            item { SyncNowCard(vm, ui.data.local) { nav.navigate("backup") } }
            item {
                EmiCard(hero = true) {
                    EmptyState(Icons.Outlined.AccountBalance, "Track every loan, privately",
                        "Add your loans to see what you've paid, what remains, when each loan closes and how prepayments change the picture. Everything stays on this phone.") {
                        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { nav.navigate("wizard") }) { Icon(Icons.Outlined.Add, null); Spacer(Modifier.width(6.dp)); Text("Add your first loan") }
                            OutlinedButton(onClick = { reminder = Defaults.reminder(ui.asOf) }) { Icon(Icons.Outlined.NotificationAdd, null); Spacer(Modifier.width(6.dp)); Text("Add a reminder") }
                            OutlinedButton(onClick = { vm.act("Demo loans added — delete them any time") { DemoData.load(vm.repo, ui.asOf) } }) {
                                Icon(Icons.Outlined.AutoAwesome, null); Spacer(Modifier.width(6.dp)); Text("Explore with demo data")
                            }
                        }
                    }
                }
            }
        }
        return
    }

    val pf = portfolio(ui)
    val (from, to) = rangeFor(range, ui.asOf)
    val filters = Filters(loanId?.let { listOf(it) }, from, to)
    val t = remember(ui, range, loanId) { Aggregate.dashboard(pf, ui.asOf, filters) }
    val series = remember(ui, range, loanId) { Aggregate.monthlySeries(pf, filters, ui.asOf) }
    val history = series.filter { it.month <= ui.asOf.substring(0, 7) }
    val visible = ui.prefs.dashboardWidgets.filter { it.visible }.map { it.id }

    Screen("Dashboard", "As of ${fmt.date(ui.asOf)}", actions = {
        IconButton(onClick = { customize = true }) { Icon(Icons.Outlined.Tune, "Customize dashboard", tint = p.text2) }
        IconButton(onClick = { reminder = Defaults.reminder(ui.asOf) }) { Icon(Icons.Outlined.NotificationAdd, "Add reminder", tint = p.text2) }
        IconButton(onClick = { nav.navigate("payment") }) { Icon(Icons.Outlined.Add, "Record payment", tint = p.accent) }
    }) {
        item { SyncNowCard(vm, ui.data.local) { nav.navigate("backup") } }
        item {
            val month = remember(ui) { com.emitracker.core.Bills.monthlyExpenses(ui.data.loans, ui.comps, ui.data.bills, ui.data.billPayments, ui.asOf.substring(0, 7), ui.asOf) }
            val t = month.totals.getValue("all")
            if (t.count > 0) EmiCard(title = "This month · ${fmt.month(ui.asOf.substring(0, 7))}", onClick = { nav.navigate("expenses") }) {
                KvRow("Total", fmt.money(t.expected))
                KvRow("EMIs · chits · bills", "${fmt.compact(month.totals.getValue("loan").expected)} · ${fmt.compact(month.totals.getValue("chit").expected)} · ${fmt.compact(month.totals.getValue("bill").expected)}")
                KvRow("Paid", fmt.money(t.paid), p.positive); KvRow("Still to pay", fmt.money(t.remaining), if (t.remaining.toDouble() > 0) p.warning else null)
            }
        }
        item { LoanFilterRow(ui, loanId) { loanId = it } }
        item { Segmented(listOf("3m" to "3M", "6m" to "6M", "12m" to "12M", "ytd" to "YTD", "all" to "All"), range, { range = it }) }
        for (id in visible) when (id) {
            "summary" -> {
                item {
                    EmiCard(hero = true) {
                        Row(verticalAlignment = Alignment.CenterVertically) { Text("Outstanding principal", style = MaterialTheme.typography.labelMedium, color = p.text2); Spacer(Modifier.width(6.dp)); if (t.isEstimate) EstimateTag() }
                        Text(fmt.money(t.outstandingPrincipal), style = MaterialTheme.typography.displaySmall, color = p.text)
                        Text("of ${fmt.money(t.originalPrincipal)} borrowed · ${t.activeLoans} active, ${t.closedLoans} closed", style = MaterialTheme.typography.bodySmall, color = p.text3)
                        Spacer(Modifier.height(12.dp)); ProgressLine(t.progressPct)
                        Row(Modifier.fillMaxWidth().padding(top = 6.dp)) {
                            Text("${"%.1f".format(t.progressPct)}% repaid", style = MaterialTheme.typography.bodySmall, color = p.text2, modifier = Modifier.weight(1f))
                            Text("${t.remainingInstallments} installments left", style = MaterialTheme.typography.bodySmall, color = p.text2)
                        }
                        Spacer(Modifier.height(10.dp))
                        Row { Text("Debt-free by ", style = MaterialTheme.typography.bodyMedium, color = p.text2); Text(if (t.anyOpenEnded) "never at current EMI" else fmt.month(t.allClosedBy?.substring(0, 7)), style = MaterialTheme.typography.bodyMedium, color = if (t.anyOpenEnded) p.danger else p.text, fontWeight = FontWeight.SemiBold); Spacer(Modifier.width(6.dp)); ProjectedTag() }
                    }
                }
                item {
                    Grid2(listOf(
                        { Stat("Total paid to date", fmt.compact(t.totalPaid), it, foot = if (t.estimatedPortion.toDouble() > 0) "incl. ${fmt.compact(t.estimatedPortion)} assumed" else "Recorded + upfront charges") },
                        { Stat("Future cash outflow", fmt.compact(t.remainingOutflow), it, foot = "EMIs, arrears & charges", tag = { ProjectedTag() }) },
                        { Stat("Principal repaid", fmt.compact(t.principalRepaid), it, tone = p.positive) },
                        { Stat("Interest paid", fmt.compact(t.interestPaid), it) },
                        { Stat("Fees & penalties", fmt.compact(t.chargesPaid), it) },
                        { Stat("Outstanding interest", fmt.compact(t.outstandingInterest), it, foot = "Arrears + accrued") },
                        { Stat("Remaining EMIs", fmt.compact(t.remainingScheduled), it, foot = "${t.remainingInstallments} installments") },
                        { Stat("Est. remaining interest", fmt.compact(t.remainingInterest), it) },
                        { Stat("Sanctioned", fmt.compact(t.sanctioned), it) },
                        { Stat("Paid in range", fmt.compact(t.paidInRange), it, foot = if (range == "all") "All time" else "${fmt.date(from)} – ${fmt.date(to)}") },
                    ))
                }
            }
            "due" -> item { DueCard(ui, t.overdue, t.dueToday, t.due7, t.due30, t.nextEmi, nav) }
            "breakdown" -> item {
                EmiCard(title = "Principal vs interest", sub = "Paid to date") {
                    val total = t.totalPaid.toDouble()
                    Donut(listOf(Slice("Principal", t.principalRepaid.toDouble(), p.accent), Slice("Interest", t.interestPaid.toDouble(), p.warning), Slice("Charges", t.chargesPaid.toDouble(), p.danger)),
                        "Interest share", if (total > 0) "%.1f%%".format(t.interestPaid.toDouble() / total * 100) else "0%", fmt)
                }
            }
            "paidRemaining" -> item {
                EmiCard(title = "Paid vs remaining", sub = "Total cost of all loans") {
                    val paid = t.totalPaid.toDouble(); val rem = t.remainingOutflow.toDouble()
                    Donut(listOf(Slice("Paid", paid, p.positive), Slice("Remaining (projected)", rem, p.surface3)), "Paid", if (paid + rem > 0) "%.0f%%".format(paid / (paid + rem) * 100) else "0%", fmt)
                }
            }
            "progress" -> item {
                EmiCard(title = "Loan-wise progress") {
                    ui.data.loans.filter { it.status == "active" && (loanId == null || it.id == loanId) }.forEach { l ->
                        val s = ui.comps[l.id]!!.summary
                        Column(Modifier.fillMaxWidth().clickable { nav.navigate("loan/${l.id}") }.padding(vertical = 6.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.size(8.dp).clip(CircleShape).background(parseColor(l.color))); Spacer(Modifier.width(8.dp))
                                Text(l.name, style = MaterialTheme.typography.bodyMedium, color = p.text, modifier = Modifier.weight(1f))
                                Text("${fmt.compact(s.outstandingPrincipal)} left · ${"%.0f".format(s.progressPct)}%", style = MaterialTheme.typography.bodySmall, color = p.text2)
                            }
                            Spacer(Modifier.height(6.dp)); ProgressLine(s.progressPct, parseColor(l.color))
                        }
                    }
                }
            }
            "monthly" -> item { EmiCard(title = "Monthly payment history", sub = "Tap a bar for details; tap the details to open payments") { MonthlyBars(history.takeLast(18), fmt, onMonth = { nav.navigate("payments?month=$it") }) } }
            "actualVsScheduled" -> item { EmiCard(title = "Actual vs scheduled", sub = "Next 6 months projected") { ActualVsScheduled(series.filter { it.month <= Dates.addMonths(ui.asOf, 6).substring(0, 7) }.takeLast(18), fmt) } }
            "interestTrend" -> item {
                EmiCard(title = "Interest paid over time", sub = "Cumulative") {
                    var cum = 0.0
                    val pts = history.filter { it.paid > 0 }.map { cum += it.interest; "${it.month}-01" to cum }
                    if (pts.size > 1) com.emitracker.app.ui.components.BalanceChart(pts, pts.size, fmt) else Text("Not enough payments yet.", color = p.text3, style = MaterialTheme.typography.bodySmall)
                }
            }
            "timeline" -> item {
                val active = ui.data.loans.filter { it.status == "active" && (loanId == null || it.id == loanId) }
                EmiCard(title = "Loan closure timeline", sub = "Elapsed solid, projected faded") {
                    ClosureTimeline(active.map { Triple(it.name, parseColor(it.color), it.startDate to ui.comps[it.id]!!.summary.closureDate) }, ui.asOf, fmt) { nav.navigate("loan/${active[it].id}") }
                }
            }
            "calendar" -> item { UpcomingCard(ui, nav, loanId) }
            "distribution" -> item {
                EmiCard(title = "Payment distribution by year") {
                    val years = Aggregate.annualSummary(pf, Filters(loanIds = filters.loanIds))
                    if (years.isEmpty()) Text("No payments yet.", color = p.text3)
                    years.forEach { y -> KvRow("${y.year} · ${y.count} payments", fmt.money(y.paid)); Text("Principal ${fmt.compact(y.principal)} · Interest ${fmt.compact(y.interest)} · Fees ${fmt.compact(y.fees)}", style = MaterialTheme.typography.bodySmall, color = p.text3) }
                }
            }
            "heatmap" -> item {
                EmiCard(title = "Repayment activity", sub = "Last 12 months", action = { TextButton(onClick = { nav.navigate("heatmaps") }) { Text("Open") } }) {
                    val fromH = Dates.addDays(Dates.addMonths(ui.asOf, -12), 1)
                    val cells = remember(ui, loanId) { Aggregate.dailyCells(pf, fromH, ui.asOf, ui.asOf, Filters(loanIds = filters.loanIds)) }
                    val pal = HEAT_PALETTES[ui.prefs.heatmapPalette] ?: HEAT_PALETTES.getValue("emerald")
                    val th = ui.prefs.heatmapThresholds.map { it.toDouble() }
                    DailyHeatmap(cells, fromH, ui.asOf, ui.asOf, th, pal, DayMetric.amount, false, ui.prefs.weekStart, null, fmt) { nav.navigate("heatmaps?date=${it.date}") }
                    IntensityLegend(pal, th) { fmt.compact(it) }
                }
            }
        }
    }
    if (customize) CustomizeDialog(ui.prefs.dashboardWidgets, { customize = false }) { w -> vm.act("Dashboard updated") { vm.repo.setPreferences(ui.prefs.copy(dashboardWidgets = w)) } }
}

@Composable
fun Grid2(cells: List<@Composable (Modifier) -> Unit>) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        cells.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { it(Modifier.weight(1f)) }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun DueCard(ui: UiState, overdue: List<DueItem>, today: List<DueItem>, due7: List<DueItem>, due30: List<DueItem>, next: DueItem?, nav: NavHostController) {
    val p = LocalPalette.current
    val fmt = ui.fmt
    EmiCard(title = "Due & overdue", sub = "Only recorded payments count as paid", action = { TextButton(onClick = { nav.navigate("payment") }) { Text("Record") } }) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(Triple("Overdue", overdue.size, p.danger), Triple("Today", today.size, p.warning), Triple("7 days", due7.size, p.text), Triple("30 days", due30.size, p.text)).forEach { (l, n, c) ->
                Column(Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).background(p.surface2).padding(10.dp)) {
                    Text(l, style = MaterialTheme.typography.labelSmall, color = p.text2)
                    Text("$n", style = MaterialTheme.typography.titleLarge, color = if (n > 0) c else p.text)
                }
            }
        }
        next?.let {
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(p.surface2).clickable { nav.navigate("loan/${it.loanId}") }.padding(12.dp)) {
                Text("Next EMI · ${it.loanName}", style = MaterialTheme.typography.bodyMedium, color = p.text2, modifier = Modifier.weight(1f))
                Text("${fmt.money(it.amount)} · ${fmt.date(it.date)}", style = MaterialTheme.typography.bodyMedium, color = p.text, fontWeight = FontWeight.SemiBold)
            }
        }
        (overdue + today + due30).take(8).forEach { d ->
            Row(Modifier.fillMaxWidth().clickable { nav.navigate("payment?loanId=${d.loanId}&inst=${d.no}") }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) { Text(d.loanName, style = MaterialTheme.typography.bodyMedium, color = p.text); Text(fmt.date(d.date), style = MaterialTheme.typography.bodySmall, color = p.text3) }
                StatusChip(d.status); Spacer(Modifier.width(10.dp))
                Text(fmt.money(d.amount), style = MaterialTheme.typography.bodyMedium, color = p.text)
            }
        }
    }
}

@Composable
fun UpcomingCard(ui: UiState, nav: NavHostController, loanId: String?) {
    val p = LocalPalette.current
    val fmt = ui.fmt
    val until = Dates.addDays(ui.asOf, 60)
    val items = ui.data.loans.filter { it.status == "active" && (loanId == null || it.id == loanId) }.flatMap { l ->
        ui.comps[l.id]!!.rows.filter { it.dueDate >= ui.asOf && it.dueDate <= until && it.status.name !in setOf("cancelled", "moratorium") }.map { l to it }
    }.sortedBy { it.second.dueDate }
    EmiCard(title = "Upcoming payments", sub = "Next 60 days", action = { TextButton(onClick = { nav.navigate("calendar") }) { Text("Calendar") } }) {
        if (items.isEmpty()) Text("Nothing scheduled in the next 60 days.", color = p.text3, style = MaterialTheme.typography.bodySmall)
        items.take(8).forEach { (l, r) ->
            Row(Modifier.fillMaxWidth().clickable { nav.navigate("loan/${l.id}") }.padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.width(44.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(r.dueDate.substring(8), style = MaterialTheme.typography.titleSmall, color = p.text)
                    Text(fmt.monthShort(r.dueDate), style = MaterialTheme.typography.labelSmall, color = p.text3)
                }
                Column(Modifier.weight(1f).padding(start = 8.dp)) { Text(l.name, style = MaterialTheme.typography.bodyMedium, color = p.text); StatusChip(r.status) }
                Text(fmt.money(if (r.shortfall.toDouble() > 0) r.shortfall else r.scheduledAmount), style = MaterialTheme.typography.bodyMedium, color = p.text)
            }
        }
    }
}

@Composable
private fun CustomizeDialog(current: List<WidgetPref>, onDismiss: () -> Unit, onSave: (List<WidgetPref>) -> Unit) {
    val known = current.map { it.id }.toSet()
    var w by remember { mutableStateOf(current + DASHBOARD_WIDGETS.filter { it.first !in known }.map { WidgetPref(it.first, true) }) }
    AlertDialog(onDismissRequest = onDismiss, containerColor = LocalPalette.current.surface, title = { Text("Customize dashboard") },
        text = {
            Column {
                w.forEachIndexed { i, x ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(x.visible, { v -> w = w.map { if (it.id == x.id) it.copy(visible = v) else it } })
                        Text(DASHBOARD_WIDGETS.firstOrNull { it.first == x.id }?.second ?: x.id, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                        IconButton(onClick = { if (i > 0) w = w.toMutableList().apply { add(i - 1, removeAt(i)) } }, enabled = i > 0) { Icon(Icons.Outlined.ArrowUpward, "Move up") }
                        IconButton(onClick = { if (i < w.lastIndex) w = w.toMutableList().apply { add(i + 1, removeAt(i)) } }, enabled = i < w.lastIndex) { Icon(Icons.Outlined.ArrowDownward, "Move down") }
                    }
                }
            }
        },
        confirmButton = { FilledTonalButton(onClick = { onSave(w); onDismiss() }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } })
}
