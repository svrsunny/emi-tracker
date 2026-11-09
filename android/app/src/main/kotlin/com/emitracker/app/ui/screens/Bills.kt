package com.emitracker.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.PieChart
import androidx.compose.material.icons.outlined.Receipt
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import com.emitracker.app.data.Defaults
import com.emitracker.app.ui.AppViewModel
import com.emitracker.app.ui.LocalPalette
import com.emitracker.app.ui.Screen
import com.emitracker.app.ui.UiState
import com.emitracker.app.ui.components.Callout
import com.emitracker.app.ui.components.DateField
import com.emitracker.app.ui.components.Dropdown
import com.emitracker.app.ui.components.EmiCard
import com.emitracker.app.ui.components.EmptyState
import com.emitracker.app.ui.components.Field
import com.emitracker.app.ui.components.IntField
import com.emitracker.app.ui.components.KvRow
import com.emitracker.app.ui.components.MoneyField
import com.emitracker.app.ui.components.Segmented
import com.emitracker.app.ui.components.SwitchRow
import com.emitracker.core.Bill
import com.emitracker.core.BillPayment
import com.emitracker.core.Bills
import com.emitracker.core.Dates
import com.emitracker.core.ExpenseItem
import com.emitracker.core.Validation

val BILL_CATEGORY_LABEL = linkedMapOf(
    "rent" to "Rent", "electricity" to "Electricity", "water" to "Water", "gas" to "Gas / LPG", "mobile" to "Mobile", "internet" to "Internet / broadband",
    "tv" to "TV / DTH", "insurance" to "Insurance", "subscription" to "Subscription", "education" to "School / tuition fees", "maintenance" to "Maintenance / society",
    "credit_card" to "Credit card", "other" to "Other",
)
val BILL_FREQUENCY_LABEL = linkedMapOf("monthly" to "Every month", "bimonthly" to "Every 2 months", "quarterly" to "Every 3 months", "half_yearly" to "Every 6 months", "yearly" to "Every year", "once" to "Only once")
private val BILL_OFFSETS = listOf(1, 2, 3, 5, 7)
private val KIND_LABEL = mapOf("loan" to "Loan EMIs", "chit" to "Chit installments", "bill" to "Bills")
private val KIND_COLOR = mapOf("loan" to Color(0xFF4F8CFF), "chit" to Color(0xFFA77BFF), "bill" to Color(0xFFF0A63A))
private val STATUS_TEXT = mapOf("paid" to "Paid", "partial" to "Part paid", "due" to "Due today", "overdue" to "Overdue", "upcoming" to "Upcoming", "no_record" to "No record")

// ---------------------------------------------------------------------------------------- bills
@Composable
fun BillsScreen(vm: AppViewModel, nav: NavHostController) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val p = LocalPalette.current
    val fmt = ui.fmt
    var pay by remember { mutableStateOf<Pair<Bill, String?>?>(null) }
    var open by rememberSaveable { mutableStateOf<String?>(null) }
    val recurring = ui.data.bills.filter { it.frequency != "once" }
    val oneTime = ui.data.bills.filter { it.frequency == "once" }.sortedByDescending { it.startDate }
    Screen("Bills", "Recurring bills and one-time expenses · counted in monthly expenses", actions = {
        TextButton(onClick = { nav.navigate("bill?once=true") }) { Text("One-time") }
        IconButton(onClick = { nav.navigate("bill") }) { Icon(Icons.Outlined.Add, "Add bill", tint = p.accent) }
    }) {
        if (ui.data.bills.isEmpty()) item {
            EmiCard {
                EmptyState(Icons.Outlined.Receipt, "No bills yet", "Add the bills you pay every month (or every few months) — rent, electricity, phone, insurance — or a one-time expense. You'll get reminders, and they show up in Monthly expenses next to your EMIs and chits.") {
                    Button(onClick = { nav.navigate("bill") }) { Text("Add your first bill") }
                    OutlinedButton(onClick = { nav.navigate("bill?once=true") }) { Text("Add a one-time expense") }
                }
            }
        } else if (recurring.isNotEmpty()) item {
            val active = recurring.filter { it.active }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                EmiCard(Modifier.weight(1f), padding = 12.dp) { Text("Average per month", style = MaterialTheme.typography.labelMedium, color = p.text3); Text(fmt.money(Bills.monthlyAverage(active).toPlainString()), style = MaterialTheme.typography.titleMedium, color = p.text) }
                EmiCard(Modifier.weight(1f), padding = 12.dp) { Text("Unpaid now", style = MaterialTheme.typography.labelMedium, color = p.text3); Text("${active.count { Bills.nextDue(it, ui.data.billPayments, ui.asOf)?.second == true }}", style = MaterialTheme.typography.titleMedium, color = p.text) }
            }
        }
        val groups = listOf("" to recurring, "One-time expenses" to oneTime).filter { it.second.isNotEmpty() }
        groups.forEach { (header, list) ->
        if (header.isNotEmpty()) item(key = "h-$header") { Text(header, style = MaterialTheme.typography.titleSmall, color = p.text2, modifier = Modifier.padding(top = 6.dp)) }
        items(list, key = { it.id }) { b ->
            val next = Bills.nextDue(b, ui.data.billPayments, ui.asOf)
            val once = b.frequency == "once"
            val lastPaid = if (once) ui.data.billPayments.firstOrNull { it.billId == b.id } else null
            EmiCard(padding = 12.dp, onClick = { open = if (open == b.id) null else b.id }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(b.name, style = MaterialTheme.typography.titleSmall, color = if (b.active) p.text else p.text3)
                        Text("${BILL_CATEGORY_LABEL[b.category]}${if (b.payee.isNotBlank()) " · ${b.payee}" else ""}${if (!b.active) " · paused" else ""}", style = MaterialTheme.typography.bodySmall, color = p.text3)
                        Text(if (once) "${fmt.date(b.startDate)} · ${when { lastPaid != null -> "paid"; next?.second == true -> "unpaid"; else -> "to pay" }}"
                            else "${BILL_FREQUENCY_LABEL[b.frequency]} · day ${b.dueDay}${next?.let { " · next ${fmt.date(it.first)}${if (it.second) " (unpaid)" else ""}" } ?: ""}",
                            style = MaterialTheme.typography.bodySmall, color = if (next?.second == true) p.danger else p.text2)
                    }
                    Text("${if (b.variable) "≈ " else ""}${fmt.money(lastPaid?.amount ?: b.amount)}", style = MaterialTheme.typography.titleSmall, color = p.text, fontWeight = FontWeight.SemiBold)
                }
                Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
                    TextButton(onClick = { nav.navigate("bill?id=${b.id}") }) { Text("Edit") }
                    if (b.active && next != null) FilledTonalButton(onClick = { pay = b to next.first }) { Text("Mark paid") }
                }
                if (open == b.id) {
                    val history = ui.data.billPayments.filter { it.billId == b.id }.sortedByDescending { it.dueDate }
                    if (history.isEmpty()) Text("No payments recorded yet.", style = MaterialTheme.typography.bodySmall, color = p.text3)
                    history.take(24).forEach { h ->
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 2.dp)) {
                            Text("Due ${fmt.date(h.dueDate)} · paid ${fmt.date(h.paidDate)}", style = MaterialTheme.typography.bodySmall, color = p.text2, modifier = Modifier.weight(1f))
                            Text(fmt.money(h.amount), style = MaterialTheme.typography.bodySmall, color = p.text)
                            TextButton(onClick = { vm.act("Marked unpaid") { vm.repo.deleteBillPayment(h.id) } }) { Text("Undo") }
                        }
                    }
                }
            }
        }
        }
    }
    pay?.let { (b, due) -> BillPayDialog(vm, ui, b, due) { pay = null } }
}

@Composable
fun BillFormScreen(vm: AppViewModel, nav: NavHostController, editId: String?, oneTime: Boolean = false) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val p = LocalPalette.current
    val initial = remember { editId?.let { id -> ui.data.bills.firstOrNull { it.id == id } } }
    var b by remember { mutableStateOf(initial ?: Defaults.bill(ui.asOf).let { if (oneTime) it.copy(frequency = "once", category = "other") else it }) }
    var errors by remember { mutableStateOf(emptyMap<String, String>()) }
    var confirmDelete by remember { mutableStateOf(false) }
    // a one-time expense on or before today is usually already paid: record it in the same step
    var alreadyPaid by remember { mutableStateOf(true) }
    val once = b.frequency == "once"
    val askPaid = once && initial == null && b.startDate <= ui.asOf
    val offsets = b.reminderOffsets ?: ui.prefs.reminders.offsets
    fun save() {
        val n = b.copy(name = b.name.trim(), amount = m2(b.amount) ?: b.amount).let { if (it.frequency == "once") it.copy(endDate = null, variable = false, dueDay = it.startDate.substring(8).toInt()) else it }
        errors = Validation.bill(n)
        val paid = askPaid && alreadyPaid
        if (errors.isEmpty()) vm.act(if (initial != null) "Saved" else if (once) (if (paid) "Expense added as paid" else "Expense added") else "Bill added", onDone = { nav.popBackStack() }) {
            vm.repo.saveBill(n)
            if (paid) vm.repo.saveBillPayment(Defaults.billPayment(n.id, n.startDate, n.startDate, n.amount))
        }
    }
    Screen(if (initial != null) "Edit" else if (once) "One-time expense" else "Add a bill", "Counts towards your monthly expenses", nav, back = true) {
        item {
            EmiCard {
                Field(if (once) "What for" else "Bill name", b.name, { b = b.copy(name = it) }, error = errors["name"], hint = if (once) "e.g. Car service, Gift" else "e.g. House rent, Electricity")
                Dropdown("Category", b.category, BILL_CATEGORY_LABEL.toList(), { b = b.copy(category = it) })
                MoneyField("Amount", b.amount, { b = b.copy(amount = it) }, ui.fmt.currencySymbol, error = errors["amount"], hint = if (b.variable) "Your usual amount; enter the actual one when you pay" else null)
                if (!once) SwitchRow("The amount changes every time", b.variable, { b = b.copy(variable = it) }, "Electricity, water…")
                Field("Paid to (optional)", b.payee, { b = b.copy(payee = it) }, hint = "e.g. landlord, electricity board")
            }
        }
        item {
            EmiCard(title = "When") {
                Dropdown("Repeats", b.frequency, BILL_FREQUENCY_LABEL.toList(), { b = b.copy(frequency = it) })
                DateField(if (once) "Date" else "First due date", b.startDate, { d -> d?.let { b = b.copy(startDate = it, dueDay = it.substring(8).toInt()) } }, error = errors["startDate"])
                if (!once) IntField("Due day of month", b.dueDay, { b = b.copy(dueDay = (it ?: 1).coerceIn(1, 31)) }, error = errors["dueDay"], hint = "31 = last day of shorter months")
                if (!once) DateField("Last due date (optional)", b.endDate, { b = b.copy(endDate = it) }, error = errors["endDate"], clearable = true, hint = "Leave empty if it keeps going")
                if (askPaid) SwitchRow("Already paid", alreadyPaid, { alreadyPaid = it }, "Recorded as paid on that date")
            }
        }
        if (!(askPaid && alreadyPaid)) item {
            EmiCard {
                Text(if (once) "Remind me about this expense?" else "Remind me about this bill?", style = MaterialTheme.typography.titleMedium, color = p.text)
                Spacer(Modifier.height(6.dp))
                Segmented(listOf(true to "Yes, remind me", false to "No reminders"), b.reminderEnabled, { b = b.copy(reminderEnabled = it) })
                if (b.reminderEnabled) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                        BILL_OFFSETS.forEach { d ->
                            FilterChip(selected = d in offsets, onClick = { b = b.copy(reminderOffsets = (if (d in offsets) offsets - d else offsets + d).sortedDescending()) },
                                label = { Text("$d day${if (d == 1) "" else "s"} before") })
                        }
                    }
                    Text("Also on the due day at ${ui.prefs.reminders.time}, and the day after if it is still unpaid.", style = MaterialTheme.typography.bodySmall, color = p.text3)
                }
            }
        }
        item {
            EmiCard {
                Field("Notes (optional)", b.notes, { b = b.copy(notes = it.take(2000)) }, singleLine = false)
                if (initial != null) SwitchRow("Active", b.active, { b = b.copy(active = it) }, "Turn off to pause a bill without deleting its history")
            }
        }
        if (errors.isNotEmpty()) item { Callout("Please fix: " + errors.values.take(3).joinToString(" · "), com.emitracker.app.ui.components.CalloutKind.Danger) }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (initial != null) OutlinedButton(onClick = { confirmDelete = true }, modifier = Modifier.weight(1f)) { Icon(Icons.Outlined.DeleteOutline, null); Text(" Delete") }
                Button(onClick = { save() }, modifier = Modifier.weight(1f)) { Text(if (initial != null) "Save changes" else if (once) "Add expense" else "Add bill") }
            }
        }
    }
    if (confirmDelete && initial != null) AlertDialog(onDismissRequest = { confirmDelete = false }, containerColor = p.surface, title = { Text("Delete ${initial.name}?") },
        text = { Text("The bill and its payment history are removed from all your synced devices. To stop it for now, turn off “Active” instead.") },
        confirmButton = { TextButton(onClick = { confirmDelete = false; vm.act("Bill deleted", onDone = { nav.popBackStack() }) { vm.repo.deleteBill(initial.id) } }) { Text("Delete", color = p.danger) } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } })
}

/** Mark a bill paid for one due date: unpaid ones from the last 3 months, the next one, or a later one. */
@Composable
fun BillPayDialog(vm: AppViewModel, ui: UiState, bill: Bill, dueDate: String?, onDismiss: () -> Unit) {
    val options = remember(ui.data.billPayments) { Bills.occurrences(listOf(bill), ui.data.billPayments, Dates.addDays(ui.asOf, -100), Dates.addDays(ui.asOf, 370), ui.asOf).filter { it.payment == null }.take(8).map { it.dueDate } }
    var pay by remember { mutableStateOf(Defaults.billPayment(bill.id, dueDate ?: options.firstOrNull() ?: ui.asOf, ui.asOf, if (bill.variable) "" else bill.amount)) }
    var errors by remember { mutableStateOf(emptyMap<String, String>()) }
    AlertDialog(onDismissRequest = onDismiss, containerColor = LocalPalette.current.surface, title = { Text("Mark ${bill.name} paid") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Dropdown("For the bill due on", pay.dueDate, (if (pay.dueDate in options) options else listOf(pay.dueDate) + options).map { it to ui.fmt.date(it) }, { pay = pay.copy(dueDate = it) })
                MoneyField("Amount paid", pay.amount, { pay = pay.copy(amount = it) }, ui.fmt.currencySymbol, error = errors["amount"], hint = if (bill.variable) "Usually about ${ui.fmt.money(bill.amount)}" else null)
                DateField("Paid on", pay.paidDate, { pay = pay.copy(paidDate = it ?: pay.paidDate) })
                Field("Note (optional)", pay.notes, { pay = pay.copy(notes = it.take(500)) })
            }
        },
        confirmButton = {
            FilledTonalButton(onClick = {
                val n = pay.copy(amount = m2(pay.amount) ?: "")
                errors = if (n.amount.isBlank()) mapOf("amount" to "Enter the amount you paid") else Validation.billPayment(n)
                if (errors.isEmpty()) vm.act("${bill.name} marked paid", onDone = onDismiss) { vm.repo.saveBillPayment(n) }
            }) { Text("Mark paid") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } })
}

// ---------------------------------------------------------------------------- monthly expenses
@Composable
fun ExpensesScreen(vm: AppViewModel, nav: NavHostController) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val p = LocalPalette.current
    val fmt = ui.fmt
    var month by rememberSaveable { mutableStateOf(ui.asOf.substring(0, 7)) }
    var payBill by remember { mutableStateOf<ExpenseItem?>(null) }
    val m = remember(ui, month) { Bills.monthlyExpenses(ui.data.loans, ui.comps, ui.data.bills, ui.data.billPayments, month, ui.asOf) }
    val all = m.totals.getValue("all")
    val kinds = listOf("loan", "chit", "bill").filter { m.totals.getValue(it).count > 0 }
    Screen("Monthly expenses", "EMIs, chits and bills due in the month") {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { month = Dates.addMonths("$month-01", -1L).substring(0, 7) }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Previous month", tint = p.text) }
                Text(fmt.month(month), style = MaterialTheme.typography.titleMedium, color = p.text, modifier = Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                IconButton(onClick = { month = Dates.addMonths("$month-01", 1L).substring(0, 7) }) { Icon(Icons.AutoMirrored.Outlined.ArrowForward, "Next month", tint = p.text) }
            }
            if (month != ui.asOf.substring(0, 7)) TextButton(onClick = { month = ui.asOf.substring(0, 7) }, modifier = Modifier.fillMaxWidth()) { Text("Back to this month") }
        }
        item {
            EmiCard(hero = true) {
                Text("Total for ${fmt.month(month)}", style = MaterialTheme.typography.labelMedium, color = p.text3)
                Text(fmt.money(all.expected), style = MaterialTheme.typography.headlineMedium, color = p.text)
                Text("${all.count} payment(s)", style = MaterialTheme.typography.bodySmall, color = p.text3)
                Spacer(Modifier.height(8.dp))
                KvRow("Paid", fmt.money(all.paid), p.positive)
                KvRow("Still to pay", fmt.money(all.remaining), if (all.remaining.toDouble() > 0) p.warning else null)
            }
        }
        if (all.expected.toDouble() > 0) item {
            EmiCard(title = "Where the money goes") {
                val total = all.expected.toDouble()
                Row(Modifier.fillMaxWidth().height(12.dp).clip(RoundedCornerShape(6.dp)).background(p.surface2)) {
                    kinds.forEach { k -> Box(Modifier.weight((m.totals.getValue(k).expected.toDouble() / total).toFloat().coerceAtLeast(0.001f)).fillMaxHeight().background(KIND_COLOR.getValue(k))) }
                }
                Spacer(Modifier.height(8.dp))
                kinds.forEach { k ->
                    val t = m.totals.getValue(k)
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 3.dp)) {
                        Box(Modifier.size(10.dp).clip(RoundedCornerShape(3.dp)).background(KIND_COLOR.getValue(k)))
                        Column(Modifier.weight(1f).padding(start = 8.dp)) {
                            Text("${KIND_LABEL[k]} · ${(t.expected.toDouble() / total * 100).toInt()}%", style = MaterialTheme.typography.bodyMedium, color = p.text)
                            Text("Paid ${fmt.money(t.paid)} · left ${fmt.money(t.remaining)}", style = MaterialTheme.typography.bodySmall, color = p.text3)
                        }
                        Text(fmt.money(t.expected), style = MaterialTheme.typography.titleSmall, color = p.text)
                    }
                }
            }
        }
        if (m.items.isEmpty()) item { EmiCard { EmptyState(Icons.Outlined.PieChart, "Nothing due this month", "Loans, chits and bills due in ${fmt.month(month)} appear here.") } }
        items(m.items, key = { "${it.kind}-${it.refId}-${it.dueDate}" }) { x ->
            EmiCard(padding = 12.dp, onClick = { nav.navigate(if (x.kind == "bill") "bills" else "loan/${x.refId}") }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(8.dp).clip(RoundedCornerShape(2.dp)).background(KIND_COLOR.getValue(x.kind)))
                    Column(Modifier.weight(1f).padding(start = 8.dp)) {
                        Text(x.name, style = MaterialTheme.typography.titleSmall, color = p.text)
                        Text("${fmt.date(x.dueDate)} · ${x.detail.ifBlank { KIND_LABEL[x.kind]!!.removeSuffix("s") }}", style = MaterialTheme.typography.bodySmall, color = p.text3)
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(fmt.money(x.expected), style = MaterialTheme.typography.titleSmall, color = p.text, fontWeight = FontWeight.SemiBold)
                        Text(STATUS_TEXT[x.status] ?: x.status, style = MaterialTheme.typography.bodySmall,
                            color = when (x.status) { "paid" -> p.positive; "overdue" -> p.danger; "partial" -> p.warning; "due" -> p.info; else -> p.text3 })
                    }
                }
                if (x.status != "paid") Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
                    if (x.remaining.toDouble() > 0 && x.remaining != x.expected) Text("Left ${fmt.money(x.remaining)}  ", style = MaterialTheme.typography.bodySmall, color = p.text2, modifier = Modifier.align(Alignment.CenterVertically))
                    if (x.kind == "bill") TextButton(onClick = { payBill = x }) { Text("Mark paid") }
                    else TextButton(onClick = { nav.navigate("payment?loanId=${x.refId}&inst=${x.rowNo}") }) { Text("Pay") }
                }
            }
        }
    }
    payBill?.let { x -> ui.data.bills.firstOrNull { it.id == x.refId }?.let { b -> BillPayDialog(vm, ui, b, x.dueDate) { payBill = null } } }
}
