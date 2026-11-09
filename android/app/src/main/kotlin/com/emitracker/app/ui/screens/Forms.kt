package com.emitracker.app.ui.screens

import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.FilterChip
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.FactCheck
import androidx.compose.material.icons.outlined.ReceiptLong
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
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import com.emitracker.app.data.Defaults
import com.emitracker.app.ui.AppViewModel
import com.emitracker.app.ui.LocalPalette
import com.emitracker.app.ui.Screen
import com.emitracker.app.ui.UiState
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
import com.emitracker.app.ui.components.Segmented
import com.emitracker.app.ui.components.StatusChip
import com.emitracker.app.ui.components.SwitchRow
import com.emitracker.app.ui.components.Tag
import com.emitracker.app.ui.parseColor
import com.emitracker.app.ui.rememberCsvExporter
import com.emitracker.core.Csv
import com.emitracker.core.Dates
import com.emitracker.core.Engine
import com.emitracker.core.Loan
import com.emitracker.core.Money
import com.emitracker.core.OPEN_STATUSES
import com.emitracker.core.PAYMENT_TYPES
import com.emitracker.core.Payment
import com.emitracker.core.Validation

val PAYMENT_TYPE_LABEL = mapOf("emi" to "EMI", "partial" to "Partial EMI", "advance" to "Advance EMI", "prepayment" to "Prepayment", "foreclosure" to "Foreclosure",
    "fee" to "Fee / charge", "penalty" to "Penalty", "missed" to "Missed (marker)", "waiver" to "Waiver (marker)")

private val OPEN_ROW_STATES = setOf(com.emitracker.core.RowStatus.upcoming, com.emitracker.core.RowStatus.due, com.emitracker.core.RowStatus.overdue, com.emitracker.core.RowStatus.partially_paid)
private val STEPS = listOf("Basics", "Amount & rate", "Schedule", "Charges & rules", "History", "Reminders", "Review")
private val REVIEW = STEPS.size - 1
private val OFFSET_CHOICES = listOf(1, 2, 3, 5, 7, 10, 15)

/** m2: money string normalised to 2 decimals (locale-independent), or null when blank/invalid. */
fun m2(s: String?): String? = s?.trim()?.takeIf { it.isNotEmpty() }?.toBigDecimalOrNull()?.let { Money.money(it) }

@Composable
fun LoanWizardScreen(vm: AppViewModel, nav: NavHostController, editId: String?) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val p = LocalPalette.current
    val fmt = ui.fmt
    val initial = remember { editId?.let { id -> ui.data.loans.firstOrNull { it.id == id } } }
    var l by remember { mutableStateOf(initial ?: Defaults.loan(ui.asOf, ui.data.loans.size)) }
    var step by rememberSaveable { mutableStateOf(if (initial != null) REVIEW else 0) }
    var emiManual by rememberSaveable { mutableStateOf(initial?.emiAmount != null) }
    var errors by remember { mutableStateOf(emptyMap<String, String>()) }
    val sym = fmt.currencySymbol
    val chit = l.loanType == "chit_fund"
    /** Chit value or installment changed: suggest the number of months (value ÷ installment). */
    fun setChit(value: String = l.principal, inst: String? = l.emiAmount) {
        val v = value.toDoubleOrNull() ?: 0.0; val i = inst?.toDoubleOrNull() ?: 0.0
        l = l.copy(principal = value, emiAmount = inst, totalInstallments = if (v > 0 && i > 0) maxOf(1, kotlin.math.ceil(v / i - 1e-9).toInt()) else l.totalInstallments)
    }

    // a chit fund has no interest: the installment is entered, nothing is calculated
    fun normalized(): Loan = if (chit) l.copy(
        principal = m2(l.principal) ?: l.principal, sanctionedAmount = m2(l.principal) ?: "", disbursedAmount = m2(l.principal) ?: "",
        annualRate = "0", rateType = "fixed", interestMethod = "flat", emiAmount = m2(l.emiAmount), emiRounding = "paisa", frequency = "monthly",
        startDate = l.firstEmiDate, sanctionDate = null, moratoriumPeriods = 0, preEmiInterest = "0.00", processingFee = "0.00", otherCharges = "0.00",
        lateFee = m2(l.lateFee) ?: "0.00", penalRate = "0", advanceEmiBalance = "0.00", prepaymentEffect = "reduce_tenure",
        openingOutstanding = m2(l.openingOutstanding), lenderOutstanding = null, lenderOutstandingDate = null,
    ) else l.copy(
        principal = m2(l.principal) ?: l.principal, sanctionedAmount = m2(l.sanctionedAmount.ifBlank { l.principal }) ?: "", disbursedAmount = m2(l.disbursedAmount.ifBlank { l.principal }) ?: "",
        emiAmount = if (emiManual) m2(l.emiAmount) else null, preEmiInterest = m2(l.preEmiInterest) ?: "0.00", processingFee = m2(l.processingFee) ?: "0.00",
        otherCharges = m2(l.otherCharges) ?: "0.00", lateFee = m2(l.lateFee) ?: "0.00", advanceEmiBalance = m2(l.advanceEmiBalance) ?: "0.00", penalRate = l.penalRate.ifBlank { "0" },
        openingOutstanding = m2(l.openingOutstanding), lenderOutstanding = m2(l.lenderOutstanding), lenderOutstandingDate = if (m2(l.lenderOutstanding) != null) l.lenderOutstandingDate else null,
    )
    val autoEmi = remember(l.principal, l.annualRate, l.totalInstallments, l.frequency, l.interestMethod, l.emiRounding) {
        val pr = l.principal.toDoubleOrNull(); val r = l.annualRate.toDoubleOrNull()
        if (pr == null || pr <= 0 || r == null || l.totalInstallments <= 0) null else Engine.calculateEmi(l.principal, l.annualRate, l.totalInstallments, l.frequency, l.interestMethod, l.emiRounding)
    }
    val stepFields = listOf(
        setOf("name", "category", "lender", "accountRef", "loanType", "status", "color"),
        setOf("principal", "sanctionedAmount", "disbursedAmount", "annualRate", "emiAmount", "rateType", "interestMethod"),
        setOf("startDate", "firstEmiDate", "emiDueDay", "totalInstallments", "sanctionDate", "moratoriumPeriods", "frequency"),
        setOf("processingFee", "otherCharges", "preEmiInterest", "lateFee", "penalRate", "gracePeriodDays", "advanceEmiBalance"),
        setOf("installmentsPaidBeforeTracking", "openingOutstanding", "trackingStartDate", "lenderOutstanding", "lenderOutstandingDate", "notes"),
        setOf("reminderOffsets", "firstEmiDate", "emiDueDay"),
    )
    fun validate(s: Int): Boolean {
        val all = Validation.loan(normalized()).toMutableMap()
        if (s >= 1 && (emiManual || chit) && (m2(l.emiAmount)?.toDouble() ?: 0.0) <= 0) all["emiAmount"] = if (chit) "Enter the monthly installment" else "Enter the EMI from your loan statement, or choose Calculate"
        errors = if (s == REVIEW) all else all.filterKeys { it in stepFields[s] }
        return errors.isEmpty()
    }
    val pastDue = remember(l.firstEmiDate, l.totalInstallments, l.moratoriumPeriods, l.emiDueDay, l.frequency) {
        if (!Dates.valid(l.firstEmiDate)) 0 else (0 until minOf(1500, l.moratoriumPeriods + l.totalInstallments)).count { Engine.dueDateFor(l, it) < ui.asOf }.minus(l.moratoriumPeriods).coerceAtLeast(0)
    }

    Screen(if (initial != null) "Edit loan" else "Add a loan", "Step ${step + 1} of ${STEPS.size} · ${if (chit && step == 1) "Amount" else STEPS[step]}", nav, back = true) {
        item { Segmented(STEPS.mapIndexed { i, s -> i to if (chit && i == 1) "Amount" else s }, step, { if (it < step || initial != null || validate(step)) step = it }) }
        when (step) {
            0 -> item {
                EmiCard {
                    Field("Loan name", l.name, { l = l.copy(name = it) }, error = errors["name"])
                    Dropdown("Loan type", l.loanType, LOAN_TYPE_LABEL.toList(), { t -> l = l.copy(loanType = t, category = if (t == "chit_fund" && (l.category.isBlank() || l.category == Defaults.loan(ui.asOf, 0).category)) "Chit fund" else l.category); if (t == "chit_fund") emiManual = true })
                    Field("Category", l.category, { l = l.copy(category = it) }, hint = "e.g. Home, Vehicle, Family", error = errors["category"])
                    Field(if (chit) "Foreman / organiser" else "Lender / bank", l.lender, { l = l.copy(lender = it) }, error = errors["lender"])
                    Field("Loan account reference (optional)", l.accountRef, { l = l.copy(accountRef = it) }, hint = "Stored only on this phone")
                    SwitchRow("Mask account reference", l.maskAccountRef, { l = l.copy(maskAccountRef = it) }, "Show only the last 4 digits")
                    Dropdown("Status", l.status, listOf("active" to "Active", "closed" to "Closed", "foreclosed" to "Foreclosed", "archived" to "Archived"), { l = l.copy(status = it) })
                    Text("Colour", style = MaterialTheme.typography.labelMedium, color = p.text2, modifier = Modifier.padding(top = 6.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
                        com.emitracker.app.data.LOAN_COLORS.forEach { c ->
                            Box(Modifier.width(30.dp).height(30.dp).clip(RoundedCornerShape(8.dp)).background(parseColor(c)).clickable { l = l.copy(color = c) }
                                .then(if (l.color == c) Modifier.padding(3.dp) else Modifier))
                        }
                    }
                }
            }
            1 -> if (chit) item {
                EmiCard {
                    MoneyField("Chit value", l.principal, { setChit(value = it) }, sym, error = errors["principal"], hint = "The total amount of the chit, e.g. 1,00,000")
                    MoneyField("Monthly installment", l.emiAmount, { setChit(inst = it) }, sym, error = errors["emiAmount"], hint = "The full installment, before any dividend")
                    Spacer(Modifier.height(8.dp))
                    Callout("No interest is needed for a chit fund. Each month you record what you actually paid; if it is less than the full installment, the difference is counted as your dividend.")
                }
            } else item {
                EmiCard {
                    MoneyField("Original principal", l.principal, { l = l.copy(principal = it) }, sym, error = errors["principal"], hint = "The amount your EMI schedule is based on")
                    MoneyField("Sanctioned amount", l.sanctionedAmount, { l = l.copy(sanctionedAmount = it) }, sym, error = errors["sanctionedAmount"], hint = "Defaults to the principal")
                    MoneyField("Amount actually disbursed", l.disbursedAmount, { l = l.copy(disbursedAmount = it) }, sym, error = errors["disbursedAmount"], hint = "Defaults to the principal")
                    Field("Annual interest rate", l.annualRate, { l = l.copy(annualRate = it.filter { c -> c.isDigit() || c == '.' }) }, error = errors["annualRate"], suffix = "%", keyboard = androidx.compose.ui.text.input.KeyboardType.Decimal)
                    Dropdown("Rate type", l.rateType, listOf("floating" to "Floating", "fixed" to "Fixed"), { l = l.copy(rateType = it) }, hint = "Record revisions on the loan page")
                    Dropdown("Interest calculation", l.interestMethod, listOf("reducing_monthly" to "Reducing balance — monthly (standard)", "reducing_daily" to "Reducing balance — daily (actual/365)", "flat" to "Flat rate"), { l = l.copy(interestMethod = it) })
                    Segmented(listOf(false to "Calculate EMI", true to "Enter from lender"), emiManual, { emiManual = it; if (it && l.emiAmount.isNullOrBlank()) l = l.copy(emiAmount = autoEmi) })
                    Spacer(Modifier.height(8.dp))
                    if (emiManual) MoneyField("EMI per installment", l.emiAmount, { l = l.copy(emiAmount = it) }, sym, error = errors["emiAmount"])
                    else Row(verticalAlignment = Alignment.CenterVertically) { Text("Calculated EMI  ", color = p.text2); Text(autoEmi?.let { fmt.money(it) } ?: "—", style = MaterialTheme.typography.titleLarge, color = p.text); Spacer(Modifier.width(6.dp)); EstimateTag() }
                    Dropdown("EMI rounding", l.emiRounding, listOf("rupee_nearest" to "Nearest rupee", "rupee_up" to "Round up to rupee", "paisa" to "Exact to paisa"), { l = l.copy(emiRounding = it) })
                    if (emiManual && autoEmi != null && (l.emiAmount?.toDoubleOrNull() ?: 0.0).let { kotlin.math.abs(it - autoEmi.toDouble()) > 1 && it > 0 })
                        Callout("Your EMI differs from the calculated ${fmt.money(autoEmi)}. That's normal if the lender uses a different method; the schedule follows your EMI.", CalloutKind.Warn)
                }
            }
            2 -> if (chit) item {
                EmiCard {
                    DateField("First installment date", l.firstEmiDate, { d -> d?.let { l = l.copy(firstEmiDate = it, emiDueDay = it.substring(8).toInt()) } }, error = errors["firstEmiDate"])
                    IntField("Installment day of month", l.emiDueDay, { l = l.copy(emiDueDay = (it ?: 1).coerceIn(1, 31)) }, error = errors["emiDueDay"], hint = "31 = last day of shorter months")
                    val v = l.principal.toDoubleOrNull() ?: 0.0; val i = l.emiAmount?.toDoubleOrNull() ?: 0.0
                    IntField("Number of months", l.totalInstallments, { l = l.copy(totalInstallments = it ?: 0) }, error = errors["totalInstallments"],
                        hint = if (v > 0 && i > 0) "Chit value ÷ installment = ${kotlin.math.ceil(v / i - 1e-9).toInt()} months" else "How many installments the chit runs for")
                }
            } else item {
                EmiCard {
                    DateField("Sanction date (optional)", l.sanctionDate, { l = l.copy(sanctionDate = it) }, error = errors["sanctionDate"], clearable = true)
                    DateField("Loan start / disbursement date", l.startDate, { l = l.copy(startDate = it ?: l.startDate) }, error = errors["startDate"], hint = "Interest accrues from this date")
                    DateField("First EMI date", l.firstEmiDate, { d -> d?.let { l = l.copy(firstEmiDate = it, emiDueDay = it.substring(8).toInt()) } }, error = errors["firstEmiDate"])
                    IntField("EMI due day of month", l.emiDueDay, { l = l.copy(emiDueDay = (it ?: 1).coerceIn(1, 31)) }, error = errors["emiDueDay"], hint = "31 = last day of shorter months")
                    Dropdown("Repayment frequency", l.frequency, listOf("monthly" to "Monthly", "quarterly" to "Quarterly", "half_yearly" to "Half-yearly", "yearly" to "Yearly", "fortnightly" to "Fortnightly", "weekly" to "Weekly"), { l = l.copy(frequency = it) })
                    IntField("Total EMI installments", l.totalInstallments, { l = l.copy(totalInstallments = it ?: 0) }, error = errors["totalInstallments"], hint = if (l.frequency == "monthly") "%.1f years".format(l.totalInstallments / 12.0) else "Excludes moratorium")
                    IntField("Moratorium periods", l.moratoriumPeriods, { l = l.copy(moratoriumPeriods = it ?: 0) }, error = errors["moratoriumPeriods"])
                    Dropdown("During moratorium", l.moratoriumTreatment, listOf("capitalize" to "Interest added to principal", "interest_only" to "Pay interest only (pre-EMI)"), { l = l.copy(moratoriumTreatment = it) })
                }
            }
            3 -> if (chit) item {
                EmiCard {
                    Callout("Chit funds have no processing fees or interest. Add a late fee only if your foreman charges one.")
                    MoneyField("Late payment fee (per late installment)", l.lateFee, { l = l.copy(lateFee = it) }, sym, error = errors["lateFee"])
                    IntField("Grace period", l.gracePeriodDays, { l = l.copy(gracePeriodDays = it ?: 0) }, error = errors["gracePeriodDays"], suffix = "days")
                }
            } else item {
                EmiCard {
                    MoneyField("Processing fee paid", l.processingFee, { l = l.copy(processingFee = it) }, sym, error = errors["processingFee"])
                    MoneyField("Other upfront charges", l.otherCharges, { l = l.copy(otherCharges = it) }, sym, error = errors["otherCharges"], hint = "Insurance, stamp duty, legal…")
                    MoneyField("Pre-EMI / broken-period interest paid", l.preEmiInterest, { l = l.copy(preEmiInterest = it) }, sym, error = errors["preEmiInterest"])
                    MoneyField("Late payment fee (per late EMI)", l.lateFee, { l = l.copy(lateFee = it) }, sym, error = errors["lateFee"], hint = "Used to estimate charges on late EMIs")
                    Field("Penal interest on overdue amount", l.penalRate, { l = l.copy(penalRate = it.filter { c -> c.isDigit() || c == '.' }) }, error = errors["penalRate"], suffix = "% p.a.", keyboard = androidx.compose.ui.text.input.KeyboardType.Decimal)
                    IntField("Grace period", l.gracePeriodDays, { l = l.copy(gracePeriodDays = it ?: 0) }, error = errors["gracePeriodDays"], suffix = "days")
                    MoneyField("Advance EMI balance with lender", l.advanceEmiBalance, { l = l.copy(advanceEmiBalance = it) }, sym, error = errors["advanceEmiBalance"])
                    Dropdown("When you prepay", l.prepaymentEffect, listOf("reduce_tenure" to "Keep EMI, reduce tenure", "reduce_emi" to "Keep tenure, reduce EMI"), { l = l.copy(prepaymentEffect = it) })
                    Dropdown("Payment allocation order", l.allocationOrder, listOf("interest_principal_fees" to "Interest → principal → charges", "fees_interest_principal" to "Charges → interest → principal"), { l = l.copy(allocationOrder = it) })
                }
            }
            4 -> {
                if (pastDue > 0 && initial == null) item {
                    EmiCard {
                        Callout("$pastDue EMI(s) were due before today. If you already paid them, mark them as paid before tracking — they'll show as “assumed paid” estimates.")
                        TextButton(onClick = { l = l.copy(installmentsPaidBeforeTracking = pastDue, trackingStartDate = ui.asOf) }) { Text("Assume $pastDue EMI(s) were paid") }
                    }
                }
                item {
                    EmiCard {
                        IntField("Installments paid before tracking", l.installmentsPaidBeforeTracking, { l = l.copy(installmentsPaidBeforeTracking = it ?: 0) }, error = errors["installmentsPaidBeforeTracking"], hint = "Assumed paid on schedule; shown as estimates")
                        MoneyField("Outstanding principal after those (optional)", l.openingOutstanding, { l = l.copy(openingOutstanding = it.ifBlank { null }) }, sym, error = errors["openingOutstanding"], hint = "From the lender statement")
                        DateField("Tracking start date", l.trackingStartDate, { l = l.copy(trackingStartDate = it ?: l.trackingStartDate) }, error = errors["trackingStartDate"], hint = "Before this, missing records show as “no data”, not missed")
                        MoneyField("Lender's current outstanding (optional)", l.lenderOutstanding, { l = l.copy(lenderOutstanding = it.ifBlank { null }, lenderOutstandingDate = l.lenderOutstandingDate ?: ui.asOf) }, sym, error = errors["lenderOutstanding"], hint = "For reconciliation only")
                        DateField("As of date", l.lenderOutstandingDate, { l = l.copy(lenderOutstandingDate = it) }, error = errors["lenderOutstandingDate"], clearable = true)
                        Field("Notes", l.notes, { l = l.copy(notes = it.take(4000)) }, singleLine = false)
                    }
                }
            }
            5 -> {
                val defaults = ui.prefs.reminders.offsets
                val offsets = l.reminderOffsets ?: defaults
                item {
                    EmiCard {
                        Text(if (chit) "Do you want reminders for this chit's installments?" else "Do you want reminders for this loan's EMIs?", style = MaterialTheme.typography.titleMedium, color = p.text)
                        Text("Notifications before each ${if (chit) "installment" else "EMI"} and on its due date.", style = MaterialTheme.typography.bodySmall, color = p.text2)
                        Spacer(Modifier.height(8.dp))
                        Segmented(listOf(true to "Yes, remind me", false to "No reminders"), l.reminderEnabled, { l = l.copy(reminderEnabled = it) })
                    }
                }
                if (l.reminderEnabled) {
                    if (!ui.prefs.reminders.enabled) item { Callout("All reminders are switched off in Reminders → Settings. Turn them on there too.", CalloutKind.Warn) }
                    item {
                        EmiCard(title = "Remind me before each ${if (chit) "installment" else "EMI"}") {
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OFFSET_CHOICES.forEach { d ->
                                    FilterChip(selected = d in offsets, onClick = {
                                        val next = if (d in offsets) offsets - d else offsets + d
                                        l = l.copy(reminderOffsets = next.sortedDescending().take(10))
                                    }, label = { Text("$d day${if (d == 1) "" else "s"} before") })
                                }
                            }
                            Text("Plus a reminder on the due date itself, at ${ui.prefs.reminders.time} (change the time in Reminders → Settings).", style = MaterialTheme.typography.bodySmall, color = p.text3)
                            if (l.reminderOffsets != null) TextButton(onClick = { l = l.copy(reminderOffsets = null) }) { Text("Use my default (${defaults.joinToString(", ")})") }
                            errors["reminderOffsets"]?.let { Text(it, color = p.danger, style = MaterialTheme.typography.bodySmall) }
                        }
                    }
                    item {
                        EmiCard(title = "Due date") {
                            DateField(if (chit) "First installment date" else "First EMI date", l.firstEmiDate, { d -> d?.let { l = l.copy(firstEmiDate = it, emiDueDay = it.substring(8).toInt()) } }, error = errors["firstEmiDate"])
                            IntField(if (chit) "Installment day of month" else "EMI due day of month", l.emiDueDay, { l = l.copy(emiDueDay = (it ?: 1).coerceIn(1, 31)) }, error = errors["emiDueDay"], hint = "31 = last day of shorter months")
                        }
                    }
                    val n = normalized()
                    val next = if (Validation.loan(n).isEmpty()) Engine.compute(n, ui.data.adjustments, ui.data.payments, ui.asOf).rows
                        .filter { it.dueDate >= ui.asOf && it.status in OPEN_ROW_STATES }.take(3).map { it.dueDate } else emptyList()
                    if (next.isNotEmpty()) item {
                        EmiCard(title = "Your next reminders") {
                            next.forEach { due ->
                                Text("${if (chit) "Installment" else "EMI"} due ${fmt.date(due)}: " + (offsets.sortedDescending().map { fmt.date(Dates.addDays(due, -it.toLong())) } + fmt.date(due)).joinToString(", ") + " at ${ui.prefs.reminders.time}",
                                    style = MaterialTheme.typography.bodySmall, color = p.text2, modifier = Modifier.padding(vertical = 3.dp))
                            }
                        }
                    }
                }
            }
            REVIEW -> {
                if (errors.isNotEmpty()) item { Callout("Please fix: " + errors.values.take(3).joinToString(" · "), CalloutKind.Danger) }
                val n = normalized()
                val preview = if (Validation.loan(n).isEmpty()) Engine.compute(n, ui.data.adjustments, ui.data.payments, ui.asOf) else null
                item {
                    EmiCard(title = l.name.ifBlank { "Unnamed loan" }) {
                        KvRow(if (chit) "Foreman" else "Lender", l.lender.ifBlank { "—" }); KvRow(if (chit) "Chit value" else "Principal", fmt.money(m2(l.principal)))
                        if (chit) KvRow("Monthly installment", fmt.money(m2(l.emiAmount)))
                        else { KvRow("Rate", "${l.annualRate}% ${l.rateType}"); KvRow("EMI", if (emiManual) fmt.money(m2(l.emiAmount)) else "${fmt.money(autoEmi)} (calculated)") }
                        KvRow("Installments", "${l.totalInstallments} × ${l.frequency}"); KvRow(if (chit) "First installment" else "First EMI", fmt.date(l.firstEmiDate))
                        KvRow("Reminders", if (l.reminderEnabled) "${(l.reminderOffsets ?: ui.prefs.reminders.offsets).joinToString(", ")} day(s) before and on the due date" else "Off")
                    }
                }
                item {
                    EmiCard(title = "Calculated preview") {
                        if (preview == null) Text("Complete the required fields to see the schedule.", color = p.text3)
                        else {
                            val s = preview.summary
                            if (!chit) KvRow("Total interest (contract)", fmt.money(s.baselineTotalInterest))
                            KvRow("Projected closure", fmt.date(s.closureDate))
                            KvRow("Outstanding today", fmt.money(s.outstandingPrincipal)); KvRow("Installments paid", "${s.installmentsPaid} of ${s.totalInstallments}")
                            s.nextDue?.let { KvRow("Next due", "${fmt.date(it.date)} · ${fmt.money(it.amount)}") }
                            if (s.isEstimate) { Spacer(Modifier.height(6.dp)); EstimateTag("Contains estimates") }
                        }
                    }
                }
                preview?.summary?.warnings?.forEach { w -> item { Callout(w, CalloutKind.Warn) } }
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (step > 0) OutlinedButton(onClick = { step-- }, modifier = Modifier.weight(1f)) { Text("Back") }
                if (step < REVIEW) Button(onClick = { if (validate(step)) step++ }, modifier = Modifier.weight(1f)) { Text("Continue") }
                else Button(onClick = {
                    if (validate(REVIEW)) vm.act(if (initial != null) "Loan updated" else "Loan created", onDone = { nav.popBackStack() }) { vm.repo.saveLoan(normalized()) }
                }, modifier = Modifier.weight(1f)) { Text(if (initial != null) "Save changes" else "Create loan") }
            }
        }
    }
}

private val TYPE_HELP = mapOf("emi" to "Regular EMI against an installment", "partial" to "Part of an installment", "advance" to "EMI paid before its due date",
    "prepayment" to "Extra principal on the transaction date", "foreclosure" to "Closes the loan: interest to date + all principal", "fee" to "Bounce charge or other fee",
    "penalty" to "Penal interest or late fee", "missed" to "Mark an installment as missed (no amount)", "waiver" to "Lender waived this installment (no amount)")

@Composable
fun PaymentFormScreen(vm: AppViewModel, nav: NavHostController, loanId: String?, inst: Int?, type: String?, editId: String?) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val p = LocalPalette.current
    val fmt = ui.fmt
    val active = ui.data.loans.filter { it.status == "active" || it.id == loanId }
    val initial = remember { editId?.let { id -> ui.data.payments.firstOrNull { it.id == id } } }
    var pay by remember {
        mutableStateOf(initial ?: run {
            val lid = loanId ?: active.firstOrNull()?.id ?: ""
            val r = inst?.let { n -> ui.comps[lid]?.rows?.firstOrNull { it.no == n } }
            val marker = type == "missed" || type == "waiver"
            Defaults.payment(lid, ui.asOf).copy(installmentNo = inst, type = type ?: if (r != null && r.dueDate > ui.asOf) "advance" else "emi",
                amount = if (marker) "0.00" else r?.let { if (it.shortfall.toDouble() > 0) it.shortfall else it.scheduledAmount } ?: "")
        })
    }
    var errors by remember { mutableStateOf(emptyMap<String, String>()) }
    var dup by remember { mutableStateOf<String?>(null) }
    if (active.isEmpty()) { Screen("Record a payment", nav = nav, back = true) { item { Callout("Add an active loan first.") } }; return }
    val comp = ui.comps[pay.loanId]
    val needsInst = pay.type in setOf("emi", "partial", "advance", "missed", "waiver")
    val marker = pay.type == "missed" || pay.type == "waiver"
    val openRows = comp?.rows?.filter { it.status in OPEN_STATUSES || it.no == pay.installmentNo } ?: emptyList()
    val row = comp?.rows?.firstOrNull { it.no == pay.installmentNo }

    fun submit(allowDuplicate: Boolean) {
        val fixed = pay.copy(amount = if (marker) "0.00" else m2(pay.amount) ?: pay.amount, installmentNo = if (needsInst) pay.installmentNo else null,
            allocPrincipal = m2(pay.allocPrincipal) ?: "0.00", allocInterest = m2(pay.allocInterest) ?: "0.00", allocFees = m2(pay.allocFees) ?: "0.00", allocPenalty = m2(pay.allocPenalty) ?: "0.00")
        errors = Validation.payment(fixed).toMutableMap().apply { if (fixed.txnDate > ui.asOf) put("txnDate", "Transaction date cannot be in the future") }
        if (errors.isNotEmpty()) return
        vm.act(if (initial != null) "Payment updated" else if (marker) "Installment marked" else "Payment recorded", onDuplicate = { dup = it }, onDone = { nav.popBackStack() }) {
            vm.repo.savePayment(fixed, allowDuplicate)
        }
    }

    Screen(if (initial != null) "Edit payment" else "Record a payment", "Transaction date is tracked separately from the due date", nav, back = true) {
        item {
            EmiCard {
                Dropdown("Loan", pay.loanId, active.map { it.id to it.name }, { pay = pay.copy(loanId = it, installmentNo = null) })
                Dropdown("Type", pay.type, PAYMENT_TYPES.map { it to PAYMENT_TYPE_LABEL.getValue(it) }, { t ->
                    pay = pay.copy(type = t, amount = when (t) { "missed", "waiver" -> "0.00"; "foreclosure" -> comp?.summary?.payoffEstimate ?: pay.amount; else -> pay.amount })
                }, hint = TYPE_HELP[pay.type])
                if (needsInst) {
                    Dropdown("Installment", pay.installmentNo ?: 0, listOf(0 to "Choose…") + openRows.map { r -> r.no to "${r.emiNo?.let { "#$it" } ?: "M${r.no}"} · due ${fmt.date(r.dueDate)} · ${fmt.money(if (r.shortfall.toDouble() > 0) r.shortfall else r.scheduledAmount)}" }, { n ->
                        val r = comp?.rows?.firstOrNull { it.no == n }
                        pay = pay.copy(installmentNo = n.takeIf { it > 0 }, amount = if (marker || initial != null || r == null) pay.amount else if (r.shortfall.toDouble() > 0) r.shortfall else r.scheduledAmount)
                    })
                    errors["installmentNo"]?.let { Text(it, color = p.danger, style = MaterialTheme.typography.bodySmall) }
                }
                DateField("Transaction date", pay.txnDate, { pay = pay.copy(txnDate = it ?: pay.txnDate) }, error = errors["txnDate"])
                val isChit = ui.data.loans.firstOrNull { it.id == pay.loanId }?.loanType == "chit_fund"
                if (!marker) MoneyField(if (isChit && needsInst) "Amount you paid" else "Amount", pay.amount, { pay = pay.copy(amount = it) }, fmt.currencySymbol, error = errors["amount"],
                    hint = if (isChit && needsInst) "After any dividend. Less than the full installment? The difference is recorded as your dividend." else null)
                Field("Reference (optional)", pay.reference, { pay = pay.copy(reference = it.take(120)) }, hint = "UTR / cheque / transaction id")
            }
        }
        row?.takeIf { needsInst }?.let { r ->
            item {
                EmiCard(padding = 12.dp) {
                    Row(verticalAlignment = Alignment.CenterVertically) { Text("Due ${fmt.date(r.dueDate)}  ", style = MaterialTheme.typography.bodySmall, color = p.text2); StatusChip(r.status) }
                    Text("Scheduled ${fmt.money(r.scheduledAmount)} = interest ${fmt.money(r.interest)} + principal ${fmt.money(r.principalDue)}", style = MaterialTheme.typography.bodySmall, color = p.text2)
                    if (r.shortfall.toDouble() > 0) Text("Unpaid ${fmt.money(r.shortfall)}", style = MaterialTheme.typography.bodySmall, color = p.warning)
                    if (Dates.valid(pay.txnDate) && Dates.diffDays(r.dueDate, pay.txnDate) > 0) Text("${Dates.diffDays(r.dueDate, pay.txnDate)} days after the due date", style = MaterialTheme.typography.bodySmall, color = p.danger)
                }
            }
        }
        if (pay.type == "foreclosure" && comp != null) item {
            Callout("Estimated payoff today: ${fmt.money(comp.summary.payoffEstimate)} (principal + accrued interest + arrears + charges − advance EMI). This is an estimate — enter the exact amount from your lender's foreclosure letter.")
        }
        if (!marker && ui.data.loans.firstOrNull { it.id == pay.loanId }?.loanType != "chit_fund") item {
            EmiCard {
                SwitchRow("Enter the lender's allocation", pay.manualAllocation, { pay = pay.copy(manualAllocation = it) }, "Use the principal / interest split from your statement")
                if (pay.manualAllocation) {
                    MoneyField("Principal", pay.allocPrincipal, { pay = pay.copy(allocPrincipal = it) }, fmt.currencySymbol, error = errors["allocPrincipal"])
                    MoneyField("Interest", pay.allocInterest, { pay = pay.copy(allocInterest = it) }, fmt.currencySymbol)
                    MoneyField("Fees", pay.allocFees, { pay = pay.copy(allocFees = it) }, fmt.currencySymbol)
                    MoneyField("Penalty", pay.allocPenalty, { pay = pay.copy(allocPenalty = it) }, fmt.currencySymbol)
                }
            }
        }
        item {
            EmiCard {
                Field("Notes", pay.notes, { pay = pay.copy(notes = it.take(2000)) }, singleLine = false)
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { pay = pay.copy(reconciled = !pay.reconciled) }) {
                    Checkbox(pay.reconciled, { pay = pay.copy(reconciled = it) }); Text("Reconciled with lender statement", color = p.text)
                }
            }
        }
        item { Button(onClick = { submit(false) }, modifier = Modifier.fillMaxWidth().height(50.dp)) { Text(if (initial != null) "Save changes" else "Record") } }
    }
    dup?.let { msg -> ConfirmDialog("Possible duplicate", "$msg. Record this payment anyway?", "Record anyway", onConfirm = { dup = null; submit(true) }, onDismiss = { dup = null }) }
}

@Composable
fun PaymentsScreen(vm: AppViewModel, nav: NavHostController, loan: String?, month: String?, date: String?) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val p = LocalPalette.current
    val ledger = rememberLedger(loan, month, date)
    var reverse by remember { mutableStateOf<Payment?>(null) }
    val attention = ui.data.loans.filter { it.status == "active" }.flatMap { l -> ui.comps[l.id]!!.rows.filter { it.dueDate <= ui.asOf && it.status.name in setOf("overdue", "missed", "partially_paid", "due") }.map { l to it } }
    Screen("Payment tracker", "Corrections are edits or reversals — history is never deleted", nav, back = true, actions = {
        TextButton(onClick = { nav.navigate("payment") }) { Text("Record") }
    }) {
        if (attention.isNotEmpty()) item {
            EmiCard(title = "Needs attention (${attention.size})", sub = "Due or past due without a full payment record") {
                attention.take(10).forEach { (l, r) ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Text("${l.name} · EMI #${r.emiNo ?: r.no}", style = MaterialTheme.typography.bodyMedium, color = p.text); Text("due ${ui.fmt.date(r.dueDate)} · ${ui.fmt.money(r.shortfall)}", style = MaterialTheme.typography.bodySmall, color = p.text3) }
                        StatusChip(r.status); Spacer(Modifier.width(8.dp))
                        FilledTonalButton(onClick = { nav.navigate("payment?loanId=${l.id}&inst=${r.no}") }) { Text("Pay") }
                    }
                }
            }
        }
        item { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { nav.navigate("payment?type=prepayment") }) { Text("Prepayment") }
            OutlinedButton(onClick = { nav.navigate("payment?type=missed") }) { Text("Mark missed") }
        } }
        paymentLedger(this, ui, vm, nav, ledger, loan) { reverse = it }
    }
    reverse?.let { x -> ReverseDialog(vm, ui, x) { reverse = null } }
}

/** Ledger filters; kept by the screen so the rows below can be lazy list items. */
data class LedgerQuery(val loan: String?, val type: String? = null, val state: String = "all", val from: String? = null, val to: String? = null, val min: String = "", val q: String = "")

private val LedgerSaver = listSaver<MutableState<LedgerQuery>, String?>(
    save = { val v = it.value; listOf(v.loan, v.type, v.state, v.from, v.to, v.min, v.q) },
    restore = { mutableStateOf(LedgerQuery(it[0], it[1], it[2] ?: "all", it[3], it[4], it[5] ?: "", it[6] ?: "")) },
)

@Composable
fun rememberLedger(fixedLoan: String?, month: String?, date: String?): MutableState<LedgerQuery> = rememberSaveable(saver = LedgerSaver) {
    mutableStateOf(LedgerQuery(fixedLoan, from = month?.let { "$it-01" } ?: date, to = month?.let { Dates.endOfMonth("$it-01") } ?: date))
}

private fun ledgerRows(ui: UiState, f: LedgerQuery): List<Payment> {
    val loansById = ui.data.loans.associateBy { it.id }
    return ui.data.payments.filter { x ->
        (f.loan == null || x.loanId == f.loan) && (f.type == null || x.type == f.type) && (f.state == "all" || x.status == f.state) &&
            (f.from == null || x.txnDate >= f.from) && (f.to == null || x.txnDate <= f.to) && (f.min.isBlank() || x.amount.toDouble() >= (f.min.toDoubleOrNull() ?: 0.0)) &&
            (f.q.isBlank() || "${x.reference} ${x.notes} ${loansById[x.loanId]?.name} ${x.amount}".contains(f.q, ignoreCase = true))
    }.sortedWith(compareByDescending<Payment> { it.txnDate }.thenByDescending { it.createdAt })
}

/** Filterable ledger shared by the payments screen and the loan detail screen; each payment is its own lazy item. */
fun paymentLedger(scope: LazyListScope, ui: UiState, vm: AppViewModel, nav: NavHostController, query: MutableState<LedgerQuery>, fixedLoan: String?, onReverse: (Payment) -> Unit) = with(scope) {
    val rows = ledgerRows(ui, query.value)
    item(key = "ledger-filters") { LedgerFilters(ui, vm, query, fixedLoan, rows) }
    if (rows.isEmpty()) item(key = "ledger-empty") {
        EmiCard { EmptyState(Icons.Outlined.ReceiptLong, "No transactions", if (ui.data.payments.isEmpty()) "Record your first EMI payment to start tracking." else "No payments match these filters.") }
    }
    items(rows.take(1000), key = { "pay-${it.id}" }) { x -> PaymentCard(ui, vm, nav, x, fixedLoan, onReverse) }
    if (rows.size > 1000) item(key = "ledger-more") { Text("Showing the latest 1000 — narrow the filters or export CSV for all.", style = MaterialTheme.typography.bodySmall, color = LocalPalette.current.text3) }
}

@Composable
private fun LedgerFilters(ui: UiState, vm: AppViewModel, query: MutableState<LedgerQuery>, fixedLoan: String?, rows: List<Payment>) {
    val p = LocalPalette.current
    val fmt = ui.fmt
    val f = query.value
    fun set(change: (LedgerQuery) -> LedgerQuery) { query.value = change(query.value) }
    val loansById = ui.data.loans.associateBy { it.id }
    val total = rows.filter { it.status == "active" }.sumOf { it.amount.toDouble() }
    val exporter = rememberCsvExporter(vm)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (fixedLoan == null && ui.data.loans.size > 1) Segmented(listOf<Pair<String?, String>>(null to "All loans") + ui.data.loans.map { it.id to it.name }, f.loan, { v -> set { it.copy(loan = v) } })
        Segmented(listOf<Pair<String?, String>>(null to "All types") + PAYMENT_TYPES.map { it to PAYMENT_TYPE_LABEL.getValue(it) }, f.type, { v -> set { it.copy(type = v) } })
        Segmented(listOf("all" to "Active + reversed", "active" to "Active", "reversed" to "Reversed"), f.state, { v -> set { it.copy(state = v) } })
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            DateField("From", f.from, { v -> set { it.copy(from = v) } }, Modifier.weight(1f), clearable = true)
            DateField("To", f.to, { v -> set { it.copy(to = v) } }, Modifier.weight(1f), clearable = true)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Field("Min amount", f.min, { v -> set { it.copy(min = v.filter { c -> c.isDigit() || c == '.' }) } }, Modifier.weight(1f), keyboard = androidx.compose.ui.text.input.KeyboardType.Decimal)
            Field("Search", f.q, { v -> set { it.copy(q = v) } }, Modifier.weight(1.4f))
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("${rows.size} transaction(s) · ${fmt.money(total)}", style = MaterialTheme.typography.titleSmall, color = p.text, modifier = Modifier.weight(1f))
            IconButton(onClick = {
                exporter("payment-history.csv", Csv.write(listOf(listOf("Date", "Loan", "Type", "Installment", "Amount", "Principal", "Interest", "Fees", "Penalty", "Reference", "Status", "Notes")) +
                    rows.map { x -> val a = ui.comps[x.loanId]?.allocations?.get(x.id); listOf(x.txnDate, loansById[x.loanId]?.name, PAYMENT_TYPE_LABEL[x.type], x.installmentNo, x.amount, a?.principal?.toPlainString(), a?.interest?.toPlainString(), a?.fees?.toPlainString(), a?.penalty?.toPlainString(), x.reference, x.status, x.notes) }))
            }) { Icon(Icons.Outlined.Download, "Export CSV", tint = p.text2) }
        }
    }
}

@Composable
private fun PaymentCard(ui: UiState, vm: AppViewModel, nav: NavHostController, x: Payment, fixedLoan: String?, onReverse: (Payment) -> Unit) {
    val p = LocalPalette.current
    val fmt = ui.fmt
    val a = ui.comps[x.loanId]?.allocations?.get(x.id)
    val r = ui.comps[x.loanId]?.rows?.firstOrNull { it.no == x.installmentNo }
    val loansById = ui.data.loans.associateBy { it.id }
    val reversed = x.status == "reversed"
    EmiCard(padding = 12.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(PAYMENT_TYPE_LABEL[x.type] ?: x.type, style = MaterialTheme.typography.titleSmall, color = if (reversed) p.text3 else p.text, textDecoration = if (reversed) TextDecoration.LineThrough else null)
                    if (x.manualAllocation) { Spacer(Modifier.width(6.dp)); Tag("Lender split", p.text2) }
                    if (x.reconciled) { Spacer(Modifier.width(6.dp)); Tag("Reconciled", p.positive) }
                }
                Text("${fmt.date(x.txnDate)}${if (fixedLoan == null) " · " + (loansById[x.loanId]?.name ?: "") else ""}${r?.let { " · #${it.emiNo ?: "M${it.no}"} due ${fmt.date(it.dueDate)}" } ?: ""}", style = MaterialTheme.typography.bodySmall, color = p.text3)
            }
            Text(fmt.money(x.amount), style = MaterialTheme.typography.titleSmall, color = if (reversed) p.text3 else p.text, fontWeight = FontWeight.SemiBold, textDecoration = if (reversed) TextDecoration.LineThrough else null)
        }
        if (a != null && !reversed && x.type !in setOf("missed", "waiver")) Text("Principal ${fmt.money(a.principal.toPlainString())} · Interest ${fmt.money(a.interest.toPlainString())}${if ((a.fees + a.penalty).signum() > 0) " · Fees ${fmt.money((a.fees + a.penalty).toPlainString())}" else ""}${if (a.unapplied.signum() > 0) " · Unapplied ${fmt.money(a.unapplied.toPlainString())}" else ""}",
            style = MaterialTheme.typography.bodySmall, color = p.text2, modifier = Modifier.padding(top = 4.dp))
        if (reversed) Text("Reversed: ${x.reversalReason}", style = MaterialTheme.typography.bodySmall, color = p.danger)
        if (x.reference.isNotBlank() || x.notes.isNotBlank()) Text(listOf(x.reference, x.notes).filter { it.isNotBlank() }.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = p.text3)
        if (!reversed) Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
            TextButton(onClick = { vm.act(if (x.reconciled) "Marked unreconciled" else "Marked reconciled") { vm.repo.savePayment(x.copy(reconciled = !x.reconciled), true) } }) { Icon(Icons.Outlined.FactCheck, null); Text(if (x.reconciled) " Unreconcile" else " Reconcile") }
            TextButton(onClick = { nav.navigate("payment?edit=${x.id}") }) { Icon(Icons.Outlined.Edit, null); Text(" Edit") }
            TextButton(onClick = { onReverse(x) }) { Icon(Icons.Outlined.Block, null); Text(" Reverse") }
        }
    }
}

@Composable
fun ReverseDialog(vm: AppViewModel, ui: UiState, x: Payment, onDismiss: () -> Unit) {
    var reason by remember { mutableStateOf("") }
    AlertDialog(onDismissRequest = onDismiss, containerColor = LocalPalette.current.surface, title = { Text("Reverse payment") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("${PAYMENT_TYPE_LABEL[x.type]} · ${ui.fmt.money(x.amount)} · ${ui.fmt.date(x.txnDate)}", color = LocalPalette.current.text2)
                Text("The record stays in your history, marked reversed, with an audit entry.", style = MaterialTheme.typography.bodySmall, color = LocalPalette.current.text3)
                Field("Reason", reason, { reason = it }, hint = "e.g. Entered twice, bounced cheque")
            }
        },
        confirmButton = { FilledTonalButton(onClick = { vm.act("Payment reversed", onDone = onDismiss) { vm.repo.reversePayment(x.id, reason) } }, enabled = reason.isNotBlank()) { Text("Reverse") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } })
}

