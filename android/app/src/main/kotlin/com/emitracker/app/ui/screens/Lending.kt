package com.emitracker.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Handshake
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
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
import com.emitracker.app.ui.components.EmiCard
import com.emitracker.app.ui.components.EmptyState
import com.emitracker.app.ui.components.Field
import com.emitracker.app.ui.components.MoneyField
import com.emitracker.app.ui.components.Segmented
import com.emitracker.app.ui.components.SwitchRow
import com.emitracker.core.Debt
import com.emitracker.core.Debts
import com.emitracker.core.Validation

private val DEBT_STATUS = mapOf("settled" to "Settled", "overdue" to "Overdue", "due" to "Due today", "pending" to "Pending")

/** Money lent to and borrowed from people: no interest, just amounts, return dates and repayments. Not part of monthly expenses. */
@Composable
fun LendingScreen(vm: AppViewModel, nav: NavHostController) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val p = LocalPalette.current
    val fmt = ui.fmt
    var repay by remember { mutableStateOf<Debt?>(null) }
    var del by remember { mutableStateOf<Debt?>(null) }
    var open by rememberSaveable { mutableStateOf<String?>(null) }
    var filter by rememberSaveable { mutableStateOf("open") }
    val rows = remember(ui, filter) {
        ui.data.debts.map { it to Debts.summary(it, ui.data.debtRepayments, ui.asOf) }
            .filter { (d, s) -> filter == "all" || (if (filter == "settled") s.status == "settled" else s.status != "settled" && (filter == "open" || d.direction == filter)) }
            .sortedWith(compareBy<Pair<Debt, com.emitracker.core.DebtSummary>>({ it.second.status == "settled" }, { it.first.dueDate ?: "9999" }).thenByDescending { it.first.date })
    }
    // the cards at the top describe exactly the entries listed below
    val cards = remember(rows, filter, fmt) { lendingCards(filter, Debts.stats(rows), fmt) }
    Screen("Lending & borrowing", "What comes back to you and what you owe", nav, back = true) {
        if (ui.data.debts.isEmpty()) item {
            EmiCard {
                EmptyState(Icons.Outlined.Handshake, "Nothing lent or borrowed yet", "Note down money you lend to friends or family, or borrow from them. Record what comes back (or what you return) bit by bit, and get a reminder on the day it is due.") {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { nav.navigate("debt?dir=lent") }) { Text("I lent money") }
                        OutlinedButton(onClick = { nav.navigate("debt?dir=borrowed") }) { Text("I borrowed money") }
                    }
                }
            }
        } else {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { nav.navigate("debt?dir=lent") }, modifier = Modifier.weight(1f)) { Text("I lent") }
                    OutlinedButton(onClick = { nav.navigate("debt?dir=borrowed") }, modifier = Modifier.weight(1f)) { Text("I borrowed") }
                }
            }
            item { Segmented(listOf("open" to "Open", "lent" to "Lent", "borrowed" to "Borrowed", "settled" to "Settled", "all" to "All"), filter, { filter = it }) }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { cards.take(2).forEach { StatBox(it, Modifier.weight(1f)) } }
                    cards.drop(2).forEach { StatBox(it, Modifier.fillMaxWidth()) }
                }
            }
            if (rows.isEmpty()) item { Text("Nothing here.", style = MaterialTheme.typography.bodySmall, color = p.text3) }
            items(rows, key = { it.first.id }) { (d, s) ->
                val lent = d.direction == "lent"
                EmiCard(padding = 12.dp, onClick = { open = if (open == d.id) null else d.id }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(d.person, style = MaterialTheme.typography.titleSmall, color = p.text)
                            Text("${if (lent) "You lent" else "You borrowed"} ${fmt.money(d.amount)} · ${fmt.date(d.date)}", style = MaterialTheme.typography.bodySmall, color = p.text3)
                            Text("${DEBT_STATUS[s.status]}${d.dueDate?.let { " · return by ${fmt.date(it)}" } ?: ""}${if (s.repaid.toBigDecimal().signum() > 0) " · returned ${fmt.money(s.repaid)}" else ""}",
                                style = MaterialTheme.typography.bodySmall, color = when (s.status) { "overdue" -> p.danger; "due" -> p.warning; "settled" -> p.positive; else -> p.text2 })
                        }
                        Text(fmt.money(s.pending), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold,
                            color = if (s.status == "settled") p.text3 else if (lent) p.positive else p.danger)
                    }
                    Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
                        TextButton(onClick = { nav.navigate("debt?id=${d.id}") }) { Text("Edit") }
                        TextButton(onClick = { del = d }) { Text("Delete", color = p.danger) }
                        if (s.status != "settled") FilledTonalButton(onClick = { repay = d }) { Text(if (lent) "Got money back" else "Paid back") }
                    }
                    if (open == d.id) {
                        if (s.repayments.isEmpty()) Text("Nothing returned yet.", style = MaterialTheme.typography.bodySmall, color = p.text3)
                        s.repayments.forEach { r ->
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 2.dp)) {
                                Text("${fmt.date(r.date)}${if (r.notes.isNotBlank()) " · ${r.notes}" else ""}", style = MaterialTheme.typography.bodySmall, color = p.text2, modifier = Modifier.weight(1f))
                                Text(fmt.money(r.amount), style = MaterialTheme.typography.bodySmall, color = p.text)
                                TextButton(onClick = { vm.act("Repayment removed") { vm.repo.deleteDebtRepayment(r.id) } }) { Text("Undo") }
                            }
                        }
                        if (d.notes.isNotBlank()) Text(d.notes, style = MaterialTheme.typography.bodySmall, color = p.text3)
                    }
                }
            }
        }
    }
    repay?.let { RepayDialog(vm, ui, it) { repay = null } }
    del?.let { d ->
        AlertDialog(onDismissRequest = { del = null }, containerColor = p.surface, title = { Text("Delete this entry for ${d.person}?") },
            text = { Text("The entry and everything returned against it are removed from all your synced devices.") },
            confirmButton = { TextButton(onClick = { del = null; vm.act("Entry deleted") { vm.repo.deleteDebt(d.id) } }) { Text("Delete", color = p.danger) } },
            dismissButton = { TextButton(onClick = { del = null }) { Text("Cancel") } })
    }
}

/** Add or edit an entry; [direction] preselects "lent" or "borrowed" for a new one. */
@Composable
fun DebtFormScreen(vm: AppViewModel, nav: NavHostController, editId: String?, direction: String) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val initial = remember { editId?.let { id -> ui.data.debts.firstOrNull { it.id == id } } }
    var d by remember { mutableStateOf(initial ?: Defaults.debt(ui.asOf, if (direction == "borrowed") "borrowed" else "lent")) }
    var errors by remember { mutableStateOf(emptyMap<String, String>()) }
    val lent = d.direction == "lent"
    fun save() {
        val n = d.copy(person = d.person.trim(), amount = m2(d.amount) ?: d.amount, notes = d.notes.trim())
        errors = Validation.debt(n)
        if (errors.isEmpty()) vm.act(if (initial != null) "Saved" else if (lent) "Lending added" else "Borrowing added", onDone = { nav.popBackStack() }) { vm.repo.saveDebt(n) }
    }
    Screen(if (initial != null) "Edit entry" else if (lent) "Money I lent" else "Money I borrowed", "Not part of monthly expenses", nav, back = true) {
        item {
            EmiCard {
                Segmented(listOf("lent" to "I lent (they owe me)", "borrowed" to "I borrowed (I owe them)"), d.direction, { d = d.copy(direction = it) })
                Field(if (lent) "Lent to" else "Borrowed from", d.person, { d = d.copy(person = it.take(120)) }, error = errors["person"], hint = "Name")
                MoneyField("Amount", d.amount, { d = d.copy(amount = it) }, ui.fmt.currencySymbol, error = errors["amount"])
                DateField(if (lent) "Given on" else "Received on", d.date, { v -> v?.let { d = d.copy(date = it) } }, error = errors["date"])
                DateField("Return by (optional)", d.dueDate, { d = d.copy(dueDate = it) }, error = errors["dueDate"], clearable = true, hint = "Leave empty if there is no fixed date")
                if (d.dueDate != null) SwitchRow("Remind me", d.reminderEnabled, { d = d.copy(reminderEnabled = it) }, "The day before, on the day, and the day after if still pending")
                Field("Notes (optional)", d.notes, { d = d.copy(notes = it.take(2000)) }, hint = "e.g. for hospital bills, via UPI", singleLine = false)
            }
        }
        if (errors.isNotEmpty()) item { Callout("Please fix: " + errors.values.take(3).joinToString(" · "), com.emitracker.app.ui.components.CalloutKind.Danger) }
        item { Button(onClick = { save() }, modifier = Modifier.fillMaxWidth()) { Text(if (initial != null) "Save changes" else "Add entry") } }
    }
}

@Composable
private fun RepayDialog(vm: AppViewModel, ui: UiState, debt: Debt, onDismiss: () -> Unit) {
    val p = LocalPalette.current
    val s = remember(ui) { Debts.summary(debt, ui.data.debtRepayments, ui.asOf) }
    var r by remember { mutableStateOf(Defaults.debtRepayment(debt.id, ui.asOf, s.pending)) }
    var errors by remember { mutableStateOf(emptyMap<String, String>()) }
    val lent = debt.direction == "lent"
    AlertDialog(onDismissRequest = onDismiss, containerColor = p.surface, title = { Text(if (lent) "Money back from ${debt.person}" else "Paid back to ${debt.person}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Callout("Pending ${ui.fmt.money(s.pending)} of ${ui.fmt.money(debt.amount)}. Enter less for a part payment.")
                MoneyField("Amount", r.amount, { r = r.copy(amount = it) }, ui.fmt.currencySymbol, error = errors["amount"])
                DateField("On", r.date, { v -> v?.let { r = r.copy(date = it) } }, error = errors["date"])
                Field("Note (optional)", r.notes, { r = r.copy(notes = it.take(500)) }, hint = "e.g. cash, UPI ref")
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val n = r.copy(amount = m2(r.amount) ?: r.amount)
                errors = Validation.debtRepayment(n).ifEmpty {
                    if (n.amount.toBigDecimal() > s.pending.toBigDecimal()) mapOf("amount" to "Only ${ui.fmt.money(s.pending)} is pending") else emptyMap()
                }
                if (errors.isEmpty()) vm.act(if (n.amount.toBigDecimal().compareTo(s.pending.toBigDecimal()) == 0) "Settled with ${debt.person}" else "Recorded", onDone = onDismiss) { vm.repo.saveDebtRepayment(n) }
            }) { Text("Record") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } })
}

private data class LendingCard(val label: String, val value: String, val tone: Int = 0, val foot: String? = null) // tone: 1 = positive, -1 = negative

/** The totals shown for each filter: open = what is pending, lent / borrowed = that side, settled = what was closed, all = everything. */
private fun lendingCards(filter: String, st: Map<String, com.emitracker.core.DebtSideStats>, fmt: com.emitracker.app.ui.Fmt): List<LendingCard> {
    val lent = st.getValue("lent")
    val borrowed = st.getValue("borrowed")
    fun n(c: Int) = "$c ${if (c == 1) "entry" else "entries"}"
    val net = lent.pending.toBigDecimal() - borrowed.pending.toBigDecimal()
    val netCard = LendingCard("Net still pending", fmt.money(net.abs().toPlainString()), if (net.signum() >= 0) 1 else -1, if (net.signum() >= 0) "in your favour" else "you owe overall")
    return when (filter) {
        "lent" -> listOf(LendingCard("Lent (open)", fmt.money(lent.amount), 0, n(lent.count)), LendingCard("Got back so far", fmt.money(lent.repaid), 1), LendingCard("Still to get back", fmt.money(lent.pending), 1))
        "borrowed" -> listOf(LendingCard("Borrowed (open)", fmt.money(borrowed.amount), 0, n(borrowed.count)), LendingCard("Paid back so far", fmt.money(borrowed.repaid)), LendingCard("Still to pay back", fmt.money(borrowed.pending), -1))
        "settled" -> listOf(LendingCard("Lent & got back", fmt.money(lent.amount), 1, n(lent.count)), LendingCard("Borrowed & paid back", fmt.money(borrowed.amount), 0, n(borrowed.count)),
            LendingCard("Total settled", fmt.money((lent.amount.toBigDecimal() + borrowed.amount.toBigDecimal()).toPlainString()), 0, n(lent.count + borrowed.count)))
        "all" -> listOf(LendingCard("Lent in total", fmt.money(lent.amount), 0, "got back ${fmt.money(lent.repaid)}"), LendingCard("Borrowed in total", fmt.money(borrowed.amount), 0, "paid back ${fmt.money(borrowed.repaid)}"), netCard)
        else -> listOf(LendingCard("You will get back", fmt.money(lent.pending), 1, "${n(lent.count)} open"), LendingCard("You owe", fmt.money(borrowed.pending), -1, "${n(borrowed.count)} open"), netCard)
    }
}

@Composable
private fun StatBox(c: LendingCard, modifier: Modifier) {
    val p = LocalPalette.current
    EmiCard(modifier, padding = 12.dp) {
        Text(c.label, style = MaterialTheme.typography.labelMedium, color = p.text3)
        Text(c.value, style = MaterialTheme.typography.titleMedium, color = when (c.tone) { 1 -> p.positive; -1 -> p.danger; else -> p.text })
        c.foot?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = p.text3) }
    }
}
