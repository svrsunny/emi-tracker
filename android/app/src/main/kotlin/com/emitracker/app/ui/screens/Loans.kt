package com.emitracker.app.ui.screens

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
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountBalance
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material.icons.outlined.Restore
import androidx.compose.material.icons.outlined.TrendingUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import com.emitracker.app.data.Defaults
import com.emitracker.app.io.FileFolder
import com.emitracker.app.ui.AppViewModel
import com.emitracker.app.ui.LocalPalette
import com.emitracker.app.ui.Screen
import com.emitracker.app.ui.UiState
import com.emitracker.app.ui.components.BalanceChart
import com.emitracker.app.ui.components.Callout
import com.emitracker.app.ui.components.CalloutKind
import com.emitracker.app.ui.components.ConfirmDialog
import com.emitracker.app.ui.components.DateField
import com.emitracker.app.ui.components.Dropdown
import com.emitracker.app.ui.components.EmiCard
import com.emitracker.app.ui.components.EmptyState
import com.emitracker.app.ui.components.EstimateTag
import com.emitracker.app.ui.components.Field
import com.emitracker.app.ui.components.IntField
import com.emitracker.app.ui.components.KvRow
import com.emitracker.app.ui.components.MoneyField
import com.emitracker.app.ui.components.ProgressLine
import com.emitracker.app.ui.components.ProjectedTag
import com.emitracker.app.ui.components.Segmented
import com.emitracker.app.ui.components.StatusChip
import com.emitracker.app.ui.components.Tag
import com.emitracker.app.ui.parseColor
import com.emitracker.core.Adjustment
import com.emitracker.core.AuditEntry
import com.emitracker.core.Loan
import com.emitracker.core.LoanComputation
import com.emitracker.core.OPEN_STATUSES
import com.emitracker.core.ScheduleRow
import com.emitracker.core.Validation

val LOAN_TYPE_LABEL = mapOf("home" to "Home loan", "personal" to "Personal loan", "vehicle" to "Vehicle loan", "education" to "Education loan", "gold" to "Gold loan",
    "business" to "Business loan", "consumer_durable" to "Consumer durable", "credit_card" to "Credit card EMI", "loan_against_property" to "Loan against property", "chit_fund" to "Chit fund", "other" to "Other")

fun maskRef(ref: String, mask: Boolean) = if (!mask || ref.length <= 4) ref else "•••• " + ref.takeLast(4)

@Composable
fun LoansScreen(vm: AppViewModel, nav: NavHostController) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val p = LocalPalette.current
    var filter by rememberSaveable { mutableStateOf(ui.prefs.loanFilter) }
    var sort by rememberSaveable { mutableStateOf(ui.prefs.loanSort) }
    val loans = ui.data.loans.filter { filter == "all" || it.status == filter || (filter == "closed" && it.status == "foreclosed") }.let { xs ->
        fun s(l: Loan) = ui.comps[l.id]!!.summary
        when (sort) {
            "outstanding" -> xs.sortedByDescending { s(it).outstandingPrincipal.toDouble() }
            "closure" -> xs.sortedBy { s(it).closureDate ?: "9999" }
            "rate" -> xs.sortedByDescending { it.annualRate.toDoubleOrNull() ?: 0.0 }
            "next_due" -> xs.sortedBy { s(it).nextDue?.date ?: "9999" }
            else -> xs.sortedBy { it.name }
        }
    }
    Screen("Loans", "${ui.data.loans.count { it.status == "active" }} active · ${ui.data.loans.size} total", actions = {
        IconButton(onClick = { nav.navigate("wizard") }) { Icon(Icons.Outlined.Add, "Add loan", tint = p.accent) }
    }) {
        item { Segmented(listOf("active" to "Active", "closed" to "Closed", "archived" to "Archived", "all" to "All"), filter, { filter = it; vm.act { vm.repo.setPreferences(ui.prefs.copy(loanFilter = it)) } }) }
        item { Segmented(listOf("next_due" to "Next due", "outstanding" to "Outstanding", "closure" to "Closure", "rate" to "Rate", "name" to "Name"), sort, { sort = it; vm.act { vm.repo.setPreferences(ui.prefs.copy(loanSort = it)) } }) }
        if (loans.isEmpty()) item {
            EmiCard { EmptyState(Icons.Outlined.AccountBalance, if (ui.data.loans.isEmpty()) "No loans yet" else "No loans match", if (ui.data.loans.isEmpty()) "Create a loan with the guided wizard, or restore a backup." else "Try another filter.") {
                Button(onClick = { nav.navigate("wizard") }) { Text("Add loan") } } }
        }
        items(loans, key = { it.id }) { l -> LoanCard(ui, l) { nav.navigate("loan/${l.id}") } }
    }
}

@Composable
private fun LoanCard(ui: UiState, l: Loan, onClick: () -> Unit) {
    val p = LocalPalette.current
    val s = ui.comps[l.id]!!.summary
    val fmt = ui.fmt
    val c = parseColor(l.color)
    EmiCard(onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(38.dp).clip(RoundedCornerShape(10.dp)).background(c.copy(alpha = 0.16f)), contentAlignment = Alignment.Center) { Icon(Icons.Outlined.AccountBalance, null, tint = c) }
            Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                Text(l.name, style = MaterialTheme.typography.titleSmall, color = p.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("${l.lender.ifBlank { "No lender" }} · ${LOAN_TYPE_LABEL[l.loanType]}${if (l.accountRef.isNotBlank()) " · " + maskRef(l.accountRef, l.maskAccountRef) else ""}", style = MaterialTheme.typography.bodySmall, color = p.text3, maxLines = 1)
            }
            Tag(l.status, p.text2)
        }
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.Bottom) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) { Text("Outstanding ", style = MaterialTheme.typography.labelMedium, color = p.text2); if (s.isEstimate) EstimateTag() }
                Text(fmt.money(s.outstandingPrincipal), style = MaterialTheme.typography.titleLarge, color = p.text)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(if (l.loanType == "chit_fund") "Installment ${fmt.compact(s.currentEmi)}" else "${ui.comps[l.id]!!.rows.firstOrNull { it.no == s.currentInstallment }?.rate ?: l.annualRate}% · EMI ${fmt.compact(s.currentEmi)}", style = MaterialTheme.typography.bodySmall, color = p.text2)
                Text("closes ${fmt.month(s.closureDate?.substring(0, 7))}", style = MaterialTheme.typography.bodySmall, color = p.text3)
            }
        }
        Spacer(Modifier.height(10.dp)); ProgressLine(s.progressPct, c)
        Row(Modifier.fillMaxWidth().padding(top = 6.dp)) {
            Text("${s.installmentsPaid}/${s.totalInstallments} paid · ${s.installmentsRemaining} left", style = MaterialTheme.typography.bodySmall, color = p.text3, modifier = Modifier.weight(1f))
            when {
                s.overdueCount > 0 -> Text("${s.overdueCount} overdue", style = MaterialTheme.typography.bodySmall, color = p.danger)
                s.nextDue != null -> Text("next ${fmt.date(s.nextDue!!.date)}", style = MaterialTheme.typography.bodySmall, color = p.text3)
                else -> Text("No dues", style = MaterialTheme.typography.bodySmall, color = p.positive)
            }
        }
    }
}

@Composable
fun LoanDetailScreen(vm: AppViewModel, nav: NavHostController, id: String) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val p = LocalPalette.current
    val fmt = ui.fmt
    val loan = ui.data.loans.firstOrNull { it.id == id }
    val comp = loan?.let { ui.comps[it.id] }
    var tab by rememberSaveable { mutableStateOf("overview") }
    var menu by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf<String?>(null) }
    var adj by remember { mutableStateOf<Adjustment?>(null) }
    val ledger = rememberLedger(id, null, null)
    val audit = if (tab == "history") rememberAudit(vm) else emptyList()
    var reverse by remember { mutableStateOf<com.emitracker.core.Payment?>(null) }
    reverse?.let { x -> ReverseDialog(vm, ui, x) { reverse = null } }
    if (loan == null || comp == null) { Screen("Loan", nav = nav, back = true) { item { EmiCard { EmptyState(Icons.Outlined.AccountBalance, "Loan not found", "It may have been deleted.") } } }; return }
    val s = comp.summary
    val adjustments = ui.data.adjustments.filter { it.loanId == id }.sortedBy { it.effectiveDate }

    Screen(loan.name, "${loan.lender.ifBlank { "No lender" }} · ${LOAN_TYPE_LABEL[loan.loanType]} · ${loan.status}", nav, back = true, actions = {
        if (loan.status == "active") IconButton(onClick = { nav.navigate("payment?loanId=${loan.id}") }) { Icon(Icons.Outlined.Payments, "Record payment", tint = p.accent) }
        IconButton(onClick = { nav.navigate("wizard?id=${loan.id}") }) { Icon(Icons.Outlined.Edit, "Edit loan", tint = p.text2) }
        Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, "More actions", tint = p.text2) }
            DropdownMenu(menu, { menu = false }) {
                DropdownMenuItem({ Text("Rate / EMI change") }, { menu = false; adj = Defaults.adjustment(loan.id, ui.asOf) }, leadingIcon = { Icon(Icons.Outlined.TrendingUp, null) })
                if (loan.status == "active") {
                    if (s.computedClosed) DropdownMenuItem({ Text("Mark closed") }, { menu = false; confirm = "close" }, leadingIcon = { Icon(Icons.Outlined.CheckCircle, null) })
                    DropdownMenuItem({ Text("Archive") }, { menu = false; confirm = "archive" }, leadingIcon = { Icon(Icons.Outlined.Archive, null) })
                } else DropdownMenuItem({ Text("Reactivate") }, { menu = false; confirm = "reopen" }, leadingIcon = { Icon(Icons.Outlined.Restore, null) })
                DropdownMenuItem({ Text("Delete permanently", color = p.danger) }, { menu = false; confirm = "delete" }, leadingIcon = { Icon(Icons.Outlined.DeleteOutline, null, tint = p.danger) })
            }
        }
    }) {
        if (s.computedClosed && loan.status == "active") item { Callout("All principal and interest are paid according to your records. Mark the loan closed to stop reminders.", CalloutKind.Ok) }
        s.warnings.forEach { w -> item { Callout(w, CalloutKind.Warn) } }
        item {
            Segmented(listOf("overview" to "Overview", "schedule" to "Schedule (${comp.rows.size})", "payments" to "Payments", "changes" to "Changes (${adjustments.size})", "history" to "History"), tab, { tab = it })
        }
        when (tab) {
            "overview" -> overview(ui, loan, comp, nav)
            "schedule" -> scheduleItems(ui, loan, comp, nav)
            "payments" -> paymentLedger(this, ui, vm, nav, ledger, loan.id) { reverse = it }
            "changes" -> {
                item {
                    EmiCard(title = "Rate, EMI and restructuring history", action = { TextButton(onClick = { adj = Defaults.adjustment(loan.id, ui.asOf) }) { Text("Add") } }) {
                        KvRow("${fmt.date(loan.startDate)} · initial", "${loan.annualRate}%")
                        adjustments.forEach { a ->
                            Row(Modifier.fillMaxWidth().clickable { adj = a }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(when (a.kind) { "rate" -> "Rate → ${a.annualRate}%"; "emi" -> "EMI → ${fmt.money(a.emiAmount)}"; else -> "Restructure" + listOfNotNull(a.annualRate?.let { " · $it%" }, a.remainingInstallments?.let { " · $it installments" }, a.emiAmount?.let { " · EMI ${fmt.money(it)}" }).joinToString("") }, style = MaterialTheme.typography.bodyMedium, color = p.text)
                                    Text("${fmt.date(a.effectiveDate)}${if (a.effectiveDate > ui.asOf) " · future" else ""} · ${if (a.kind == "rate") (if (a.recalc == "keep_emi") "EMI kept, tenure adjusts" else "Tenure kept, EMI recalculated") else if (a.kind == "emi") "Tenure adjusts" else "EMI recalculated"}${if (a.note.isNotBlank()) " · " + a.note else ""}", style = MaterialTheme.typography.bodySmall, color = p.text3)
                                }
                                IconButton(onClick = { vm.act("Change removed") { vm.repo.deleteAdjustment(a.id) } }) { Icon(Icons.Outlined.DeleteOutline, "Remove change", tint = p.text3) }
                            }
                        }
                    }
                }
            }
            "history" -> auditItems(vm, setOf(loan.id) + ui.data.payments.filter { it.loanId == loan.id }.map { it.id } + adjustments.map { it.id }, audit)
        }
    }

    when (confirm) {
        "close" -> ConfirmDialog("Mark loan closed?", "Reminders stop for this loan. All records stay and you can reactivate it at any time.", "Mark closed",
            onConfirm = { confirm = null; vm.act("Loan closed") { vm.repo.setLoanStatus(loan.id, if (ui.data.payments.any { it.loanId == loan.id && it.type == "foreclosure" && it.status == "active" }) "foreclosed" else "closed") } }, onDismiss = { confirm = null })
        "archive" -> ConfirmDialog("Archive this loan?", "Archived loans are hidden from the dashboard and reminders. Payment history is kept.", "Archive",
            onConfirm = { confirm = null; vm.act("Loan archived") { vm.repo.setLoanStatus(loan.id, "archived") } }, onDismiss = { confirm = null })
        "reopen" -> ConfirmDialog("Reactivate loan?", "The loan returns to the dashboard and reminders resume.", "Reactivate",
            onConfirm = { confirm = null; vm.act("Loan reactivated") { vm.repo.setLoanStatus(loan.id, "active") } }, onDismiss = { confirm = null })
        "delete" -> ConfirmDialog("Delete permanently?", "This removes the loan and its ${ui.data.payments.count { it.loanId == loan.id }} payment record(s). A recovery backup is saved in the app first. Prefer Archive to just hide it.",
            "Delete permanently", danger = true, typeToConfirm = loan.name,
            onConfirm = {
                confirm = null
                vm.act("Loan deleted — a recovery backup was saved", onDone = { nav.popBackStack() }) {
                    vm.backup.backupToFolder(FileFolder(vm.backup.recoveryDir), kind = "recovery", label = "before-delete")
                    vm.repo.deleteLoanPermanently(loan.id, loan.name)
                }
            }, onDismiss = { confirm = null })
    }
    adj?.let { a -> AdjustmentDialog(vm, ui, a) { adj = null } }
}

private fun LazyListScope.overview(ui: UiState, loan: Loan, comp: LoanComputation, nav: NavHostController) {
    val s = comp.summary
    val fmt = ui.fmt
    item {
        val p = LocalPalette.current
        EmiCard(hero = true) {
            Row(verticalAlignment = Alignment.CenterVertically) { Text("Outstanding principal ", style = MaterialTheme.typography.labelMedium, color = p.text2); if (s.isEstimate) EstimateTag() }
            Text(fmt.money(s.outstandingPrincipal), style = MaterialTheme.typography.displaySmall, color = p.text)
            Text("Calculated from your records — not the lender's figure", style = MaterialTheme.typography.bodySmall, color = p.text3)
            Spacer(Modifier.height(12.dp)); ProgressLine(s.progressPct, parseColor(loan.color))
            Row(Modifier.fillMaxWidth().padding(top = 6.dp)) {
                Text("${"%.1f".format(s.progressPct)}% repaid", style = MaterialTheme.typography.bodySmall, color = p.text2, modifier = Modifier.weight(1f))
                Text("Installment ${comp.rows.firstOrNull { it.no == s.currentInstallment }?.emiNo ?: "—"} of ${s.totalInstallments}", style = MaterialTheme.typography.bodySmall, color = p.text2)
            }
        }
    }
    item {
        Grid2(listOf(
            { com.emitracker.app.ui.components.Stat("Next EMI", s.nextDue?.let { fmt.money(it.amount) } ?: "—", it, foot = s.nextDue?.let { d -> "${if (d.status.name == "overdue") "Overdue since" else "Due"} ${fmt.date(d.date)}" }, tone = if (s.nextDue?.status?.name == "overdue") LocalPalette.current.danger else null) },
            { com.emitracker.app.ui.components.Stat("Expected closure", s.closureDate?.let { c -> fmt.month(c.substring(0, 7)) } ?: if (s.nonConverging) "Never" else "—", it, foot = s.closureDate?.let { c -> "Last payment ${fmt.date(c)}" }, tag = { ProjectedTag() }) },
        ))
    }
    item {
        EmiCard(title = "Installments") {
            KvRow("Total scheduled", "${s.totalInstallments}"); KvRow("Paid", "${s.installmentsPaid}"); KvRow("Remaining", "${s.installmentsRemaining}")
            KvRow("Overdue", if (s.overdueCount > 0) "${s.overdueCount} · ${fmt.money(s.overdueAmount)}" else "0", if (s.overdueCount > 0) LocalPalette.current.danger else null)
            KvRow("Current EMI", fmt.money(s.currentEmi))
        }
    }
    item {
        EmiCard(title = "Paid to date") {
            if (loan.loanType == "chit_fund") {
                KvRow("Installments paid", fmt.money(s.principalRepaid)); KvRow("Dividends received", fmt.money(s.dividends), LocalPalette.current.positive)
                KvRow("Fees & charges", fmt.money(s.feesPaid)); KvRow("Total paid", fmt.money(s.totalPaid))
            } else {
                KvRow("Principal repaid", fmt.money(s.principalRepaid)); KvRow("Interest paid", fmt.money(s.interestPaid)); KvRow("Fees & charges", fmt.money(s.feesPaid))
                KvRow("Penalties", fmt.money(s.penaltiesPaid)); KvRow("Total paid", fmt.money(s.totalPaid))
            }
            if (s.principalRepaidEstimated.toDouble() > 0) Text("Includes ${fmt.money((s.principalRepaidEstimated.toBigDecimal() + s.interestPaidEstimated.toBigDecimal()).toPlainString())} assumed before tracking", style = MaterialTheme.typography.bodySmall, color = LocalPalette.current.warning)
            if (s.unapplied.toDouble() > 0) Text("${fmt.money(s.unapplied)} unapplied (paid beyond amount due)", style = MaterialTheme.typography.bodySmall, color = LocalPalette.current.text3)
        }
    }
    item {
        EmiCard(title = "Remaining", sub = "If every EMI is paid on schedule") {
            KvRow("Scheduled EMIs", fmt.money(s.remainingScheduledAmount)); KvRow("Est. interest", fmt.money(s.remainingInterest)); KvRow("Est. fees / charges due", fmt.money(s.remainingFees))
            KvRow("Overdue amount", fmt.money(s.overdueAmount)); KvRow("Total future outflow", fmt.money(s.remainingCashOutflow))
        }
    }
    if (loan.loanType != "chit_fund") item {
        val saved = s.interestSaved.toDouble()
        EmiCard(title = "Prepayment impact", sub = "Versus the original contract · estimate") {
            KvRow("Contract interest", fmt.money(s.baselineTotalInterest)); KvRow("Lifetime interest now", fmt.money(s.lifetimeInterest))
            KvRow(if (saved >= 0) "Interest saved" else "Extra interest", fmt.money(kotlin.math.abs(saved)), if (saved >= 0) LocalPalette.current.positive else LocalPalette.current.danger)
            KvRow(if (s.periodsSaved >= 0) "Installments saved" else "Installments added", "${kotlin.math.abs(s.periodsSaved)}"); KvRow("Contract closure", fmt.date(s.baselineClosureDate))
        }
    }
    item {
        EmiCard(title = "Outstanding balance", sub = "Actual to date, projected afterwards") {
            val pts = comp.rows.map { it.dueDate to it.closingPrincipal.toDouble() }
            BalanceChart(listOf(loan.startDate to loan.principal.toDouble()) + pts, 1 + comp.rows.count { !it.isProjected || it.paidAmount.toDouble() > 0 }, fmt)
        }
    }
    s.reconciliation?.let { r ->
        item {
            EmiCard(title = "Lender reconciliation", sub = "Statement as of ${fmt.date(r.date)}") {
                KvRow("Lender's outstanding", fmt.money(r.lenderOutstanding)); KvRow("Calculated principal", fmt.money(r.calculated))
                KvRow("Difference", fmt.money(r.difference), if (kotlin.math.abs(r.difference.toDouble()) > 1) LocalPalette.current.warning else LocalPalette.current.positive)
                if (kotlin.math.abs(r.difference.toDouble()) > 1) Text("The lender's figure may include accrued interest or charges. Review payments, or record the lender's allocation on each payment.", style = MaterialTheme.typography.bodySmall, color = LocalPalette.current.text3)
            }
        }
    }
    item {
        EmiCard(title = "Loan terms") {
            KvRow("Sanctioned", fmt.money(loan.sanctionedAmount)); KvRow("Disbursed", fmt.money(loan.disbursedAmount)); KvRow("Original principal", fmt.money(loan.principal))
            if (loan.loanType == "chit_fund") KvRow("Type", "Chit fund · no interest")
            else { KvRow("Rate", "${comp.rows.firstOrNull { it.no == s.currentInstallment }?.rate ?: loan.annualRate}% ${loan.rateType}"); KvRow("Method", loan.interestMethod.replace('_', ' ')) }
            KvRow("Frequency", loan.frequency.replace('_', '-')); KvRow("Start", fmt.date(loan.startDate)); KvRow("First EMI", fmt.date(loan.firstEmiDate)); KvRow("Due day", "${loan.emiDueDay}")
            KvRow("Grace period", "${loan.gracePeriodDays} days"); KvRow("Prepayments", if (loan.prepaymentEffect == "reduce_tenure") "Reduce tenure" else "Reduce EMI")
            KvRow("Payoff estimate today", fmt.money(s.payoffEstimate))
            if (loan.notes.isNotBlank()) { Spacer(Modifier.height(8.dp)); Text(loan.notes, style = MaterialTheme.typography.bodySmall, color = LocalPalette.current.text2) }
        }
    }
    if (loan.loanType != "chit_fund") item { FilledTonalButton(onClick = { nav.navigate("whatif") }, modifier = Modifier.fillMaxWidth()) { Text("What if I prepay or raise my EMI?") } }
}

fun LazyListScope.scheduleItems(ui: UiState, loan: Loan, comp: LoanComputation, nav: NavHostController) {
    item { Row(verticalAlignment = Alignment.CenterVertically) { ProjectedTag(); Text("  rows assume the EMI is paid on its due date", style = MaterialTheme.typography.bodySmall, color = LocalPalette.current.text3) } }
    items(comp.rows, key = { "${loan.id}-${it.no}" }) { r -> ScheduleRowCard(ui, loan, r, nav) }
}

@Composable
private fun ScheduleRowCard(ui: UiState, loan: Loan, r: ScheduleRow, nav: NavHostController) {
    val p = LocalPalette.current
    val fmt = ui.fmt
    var open by remember { mutableStateOf(false) }
    val canPay = r.status in OPEN_STATUSES && loan.status == "active"
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(p.surface).clickable { open = !open }.padding(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(r.emiNo?.let { "#$it" } ?: "M${r.no}", style = MaterialTheme.typography.labelMedium, color = p.text3, modifier = Modifier.width(44.dp))
            Column(Modifier.weight(1f)) {
                Text(fmt.date(r.dueDate), style = MaterialTheme.typography.bodyMedium, color = if (r.isProjected && r.paidAmount.toDouble() == 0.0) p.text2 else p.text)
                StatusChip(r.status)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(fmt.money(r.scheduledAmount), style = MaterialTheme.typography.bodyMedium, color = p.text, fontWeight = FontWeight.Medium)
                Text("bal ${fmt.compact(r.closingPrincipal)}", style = MaterialTheme.typography.bodySmall, color = p.text3)
            }
        }
        if (open) {
            Spacer(Modifier.height(8.dp))
            if (loan.loanType == "chit_fund") {
                KvRow("Installment", fmt.money(r.scheduledAmount))
                if (r.dividend.toDouble() > 0) KvRow("Dividend", fmt.money(r.dividend), p.positive)
            } else {
                KvRow("Opening principal", fmt.money(r.openingPrincipal)); KvRow("Interest", fmt.money(r.interest)); KvRow("Principal", fmt.money(r.principalDue))
                KvRow("Rate", "${r.rate}%")
            }
            KvRow("Actually paid", if (r.paidAmount.toDouble() > 0) fmt.money(r.paidAmount) + (r.lastPaymentDate?.let { " on ${fmt.date(it)}" } ?: "") else if (r.isProjected) "Projected ${fmt.money(r.projectedAmount)}" else "—")
            if (r.feesCharged.toDouble() > 0) KvRow("Fees / penal (est.)", fmt.money(r.feesCharged), p.warning)
            if (r.extraPrincipal.toDouble() > 0) KvRow("Extra principal", fmt.money(r.extraPrincipal), p.positive)
            if (r.capitalized.toDouble() > 0) KvRow("Capitalised interest", fmt.money(r.capitalized), p.warning)
            KvRow("Closing principal", fmt.money(r.closingPrincipal))
            if (r.shortfall.toDouble() > 0 && r.dueDate <= ui.asOf) KvRow("Unpaid", fmt.money(r.shortfall), p.warning)
            KvRow("Installments left after this", "${r.remainingInstallments}")
            if (canPay) Button(onClick = { nav.navigate("payment?loanId=${loan.id}&inst=${r.no}") }, modifier = Modifier.padding(top = 8.dp)) { Text("Record payment") }
        }
    }
}

fun LazyListScope.auditItems(vm: AppViewModel, ids: Set<String>?, entries: List<AuditEntry>) {
    item { EmiCard(title = "Audit history", sub = "Every significant change, never edited") { if (entries.isEmpty()) Text("No entries yet.", color = LocalPalette.current.text3) } }
    items(entries.filter { ids == null || (it.entityId != null && it.entityId in ids) }.take(1000), key = { "audit-${it.id}" }) { a ->
        val p = LocalPalette.current
        Column(Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 2.dp)) {
            Text(a.summary, style = MaterialTheme.typography.bodyMedium, color = p.text)
            Text("${a.at.replace('T', ' ').take(16)} · ${a.entity} · ${a.action}", style = MaterialTheme.typography.bodySmall, color = p.text3)
        }
    }
}

/** Audit entries are read off the main thread whenever the data changes. */
@Composable
fun rememberAudit(vm: AppViewModel): List<AuditEntry> {
    val data = vm.ui.collectAsStateWithLifecycle().value.data
    val entries by androidx.compose.runtime.produceState(emptyList<AuditEntry>(), data) {
        value = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { vm.repo.audit(3000) }
    }
    return entries
}

@Composable
fun AdjustmentDialog(vm: AppViewModel, ui: UiState, initial: Adjustment, onDismiss: () -> Unit) {
    var a by remember { mutableStateOf(initial) }
    var errors by remember { mutableStateOf(emptyMap<String, String>()) }
    AlertDialog(onDismissRequest = onDismiss, containerColor = LocalPalette.current.surface, title = { Text("Rate / EMI change") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Dropdown("Kind", a.kind, listOf("rate" to "Interest rate change", "emi" to "EMI amount change", "restructure" to "Restructuring"), { a = a.copy(kind = it) })
                DateField("Effective date", a.effectiveDate, { a = a.copy(effectiveDate = it ?: a.effectiveDate) }, error = errors["effectiveDate"])
                if (a.kind != "emi") Field("New annual rate", a.annualRate ?: "", { a = a.copy(annualRate = it.filter { c -> c.isDigit() || c == '.' }) }, error = errors["annualRate"], suffix = "%", keyboard = androidx.compose.ui.text.input.KeyboardType.Decimal)
                if (a.kind == "rate") Dropdown("Then", a.recalc, listOf("keep_emi" to "Keep EMI, change tenure", "recompute_emi" to "Keep tenure, change EMI"), { a = a.copy(recalc = it) })
                if (a.kind != "rate") MoneyField(if (a.kind == "emi") "New EMI" else "New EMI (optional)", a.emiAmount, { a = a.copy(emiAmount = it) }, ui.fmt.currencySymbol, error = errors["emiAmount"])
                if (a.kind == "restructure") IntField("Remaining installments", a.remainingInstallments, { a = a.copy(remainingInstallments = it) }, error = errors["remainingInstallments"] ?: errors["kind"])
                Field("Note", a.note, { a = a.copy(note = it) })
            }
        },
        confirmButton = {
            FilledTonalButton(onClick = {
                val fixed = a.copy(annualRate = a.annualRate?.ifBlank { null }, emiAmount = a.emiAmount?.ifBlank { null }?.let { "%.2f".format(it.toDouble()) })
                errors = Validation.adjustment(fixed)
                if (errors.isEmpty()) vm.act("Change saved", onDone = onDismiss) { vm.repo.saveAdjustment(fixed) }
            }) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } })
}
