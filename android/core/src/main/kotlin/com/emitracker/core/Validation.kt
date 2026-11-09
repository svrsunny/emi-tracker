package com.emitracker.core

/**
 * Input validation — the same rules as the desktop zod schemas (src/shared/validation.ts).
 * Returns field -> message; empty map means valid. Used by forms and to validate every record
 * of an imported backup or sync file before it touches the database.
 */
object Validation {
    private val RATE = Regex("^\\d{1,3}(\\.\\d{1,4})?$")
    private val TIME = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")
    private val COLOR = Regex("^#[0-9a-fA-F]{6}$")

    private fun MutableMap<String, String>.money(field: String, v: String?, label: String, nullable: Boolean = false, positive: Boolean = false) {
        if (v == null) { if (!nullable) put(field, "$label is required"); return }
        if (!Money.isMoney(v)) { put(field, "$label must be a number with up to 2 decimals"); return }
        if (v.toBigDecimal().signum() < 0) put(field, "$label cannot be negative")
        else if (positive && v.toBigDecimal().signum() <= 0) put(field, "$label must be greater than zero")
    }
    private fun MutableMap<String, String>.rate(field: String, v: String?, nullable: Boolean = false) {
        if (v == null) { if (!nullable) put(field, "Rate is required"); return }
        if (!RATE.matches(v) || v.toDouble() > 100) put(field, "Rate must be between 0 and 100 with up to 4 decimals")
    }
    private fun MutableMap<String, String>.date(field: String, v: String?, nullable: Boolean = false) {
        if (v == null) { if (!nullable) put(field, "Enter a valid date"); return }
        if (!Dates.valid(v)) put(field, "Enter a valid date")
    }
    private fun MutableMap<String, String>.len(field: String, v: String?, max: Int) { if (v != null && v.length > max) put(field, "Too long (max $max characters)") }

    fun loan(l: Loan): Map<String, String> {
        val e = linkedMapOf<String, String>()
        if (l.name.isBlank()) e["name"] = "Loan name is required"
        e.len("name", l.name, 80); e.len("category", l.category, 60); e.len("lender", l.lender, 80); e.len("accountRef", l.accountRef, 60); e.len("notes", l.notes, 4000)
        if (l.loanType !in LOAN_TYPES) e["loanType"] = "Unknown loan type"
        if (l.status !in setOf("active", "closed", "foreclosed", "archived")) e["status"] = "Unknown status"
        e.date("sanctionDate", l.sanctionDate, nullable = true); e.date("startDate", l.startDate); e.date("firstEmiDate", l.firstEmiDate); e.date("trackingStartDate", l.trackingStartDate)
        if (l.emiDueDay !in 1..31) e["emiDueDay"] = "Day must be 1–31"
        e.money("sanctionedAmount", l.sanctionedAmount, "Sanctioned amount"); e.money("disbursedAmount", l.disbursedAmount, "Disbursed amount")
        e.money("principal", l.principal, "Principal", positive = true); e.rate("annualRate", l.annualRate); e.rate("penalRate", l.penalRate)
        if (l.rateType !in setOf("fixed", "floating")) e["rateType"] = "Unknown rate type"
        if (l.interestMethod !in setOf("reducing_monthly", "reducing_daily", "flat")) e["interestMethod"] = "Unknown method"
        if (l.frequency !in FREQUENCY_PERIODS) e["frequency"] = "Unknown frequency"
        e.money("emiAmount", l.emiAmount, "EMI", nullable = true)
        if (l.emiRounding !in setOf("paisa", "rupee_nearest", "rupee_up")) e["emiRounding"] = "Unknown rounding"
        if (l.totalInstallments !in 1..1200) e["totalInstallments"] = "Installments must be 1–1200"
        if (l.moratoriumPeriods !in 0..120) e["moratoriumPeriods"] = "Moratorium must be 0–120"
        if (l.moratoriumTreatment !in setOf("capitalize", "interest_only")) e["moratoriumTreatment"] = "Unknown treatment"
        e.money("preEmiInterest", l.preEmiInterest, "Pre-EMI interest"); e.money("processingFee", l.processingFee, "Processing fee")
        e.money("otherCharges", l.otherCharges, "Other charges"); e.money("lateFee", l.lateFee, "Late fee"); e.money("advanceEmiBalance", l.advanceEmiBalance, "Advance EMI balance")
        if (l.gracePeriodDays !in 0..90) e["gracePeriodDays"] = "Grace period must be 0–90 days"
        if (l.prepaymentEffect !in setOf("reduce_tenure", "reduce_emi")) e["prepaymentEffect"] = "Unknown option"
        if (l.allocationOrder !in setOf("interest_principal_fees", "fees_interest_principal")) e["allocationOrder"] = "Unknown option"
        if (l.installmentsPaidBeforeTracking !in 0..1200) e["installmentsPaidBeforeTracking"] = "Must be 0–1200"
        e.money("openingOutstanding", l.openingOutstanding, "Opening outstanding", nullable = true)
        e.money("lenderOutstanding", l.lenderOutstanding, "Lender outstanding", nullable = true); e.date("lenderOutstandingDate", l.lenderOutstandingDate, nullable = true)
        if (l.reminderOffsets != null && (l.reminderOffsets.size > 10 || l.reminderOffsets.any { it !in 0..60 })) e["reminderOffsets"] = "Offsets must be 0–60 days (max 10)"
        if (!COLOR.matches(l.color)) e["color"] = "Invalid colour"
        if (e.isEmpty()) {
            // a chit's first installment is due the day it starts; a loan's first EMI comes after disbursement
            if (if (l.loanType == "chit_fund") l.firstEmiDate < l.startDate else l.firstEmiDate <= l.startDate) e["firstEmiDate"] = "First EMI date must be after the loan start date"
            if (l.sanctionDate != null && l.sanctionDate > l.startDate) e["sanctionDate"] = "Sanction date cannot be after the start date"
            if (l.disbursedAmount.toBigDecimal().signum() > 0 && l.sanctionedAmount.toBigDecimal().signum() > 0 && l.disbursedAmount.toBigDecimal() > l.sanctionedAmount.toBigDecimal())
                e["disbursedAmount"] = "Disbursed amount exceeds the sanctioned amount"
            if (l.installmentsPaidBeforeTracking > l.totalInstallments) e["installmentsPaidBeforeTracking"] = "Cannot exceed total installments"
            if ((l.lenderOutstanding == null) != (l.lenderOutstandingDate == null)) e["lenderOutstandingDate"] = "Lender balance needs both an amount and a date"
        }
        return e
    }

    fun payment(p: Payment): Map<String, String> {
        val e = linkedMapOf<String, String>()
        e.date("txnDate", p.txnDate)
        if (p.type !in PAYMENT_TYPES) e["type"] = "Unknown payment type"
        e.money("amount", p.amount, "Amount")
        listOf("allocPrincipal" to p.allocPrincipal, "allocInterest" to p.allocInterest, "allocFees" to p.allocFees, "allocPenalty" to p.allocPenalty).forEach { (k, v) -> e.money(k, v, "Allocation") }
        e.len("reference", p.reference, 120); e.len("notes", p.notes, 2000)
        if (p.status !in setOf("active", "reversed")) e["status"] = "Unknown status"
        if (p.installmentNo != null && p.installmentNo !in 1..5000) e["installmentNo"] = "Invalid installment"
        if (e.isEmpty()) {
            if (p.type in setOf("emi", "partial", "advance", "missed", "waiver") && p.installmentNo == null) e["installmentNo"] = "Choose the installment"
            val marker = p.type in MARKER_TYPES
            if (!marker && p.amount.toBigDecimal().signum() <= 0) e["amount"] = "Amount must be greater than zero"
            if (marker && p.amount.toBigDecimal().signum() != 0) e["amount"] = "Markers carry no amount"
            if (p.manualAllocation) {
                val total = p.allocPrincipal.toBigDecimal() + p.allocInterest.toBigDecimal() + p.allocFees.toBigDecimal() + p.allocPenalty.toBigDecimal()
                if (total - p.amount.toBigDecimal() > Money.EPS.subtract(java.math.BigDecimal("0.001"))) e["allocPrincipal"] = "Allocation exceeds the payment amount"
            }
        }
        return e
    }

    fun adjustment(a: Adjustment): Map<String, String> {
        val e = linkedMapOf<String, String>()
        e.date("effectiveDate", a.effectiveDate)
        if (a.kind !in setOf("rate", "emi", "restructure")) e["kind"] = "Unknown change"
        e.rate("annualRate", a.annualRate, nullable = true); e.money("emiAmount", a.emiAmount, "EMI", nullable = true)
        if (a.remainingInstallments != null && a.remainingInstallments !in 1..1200) e["remainingInstallments"] = "Must be 1–1200"
        if (a.recalc !in setOf("keep_emi", "recompute_emi")) e["recalc"] = "Unknown option"
        if (e.isEmpty()) {
            if (a.kind == "rate" && a.annualRate.isNullOrBlank()) e["annualRate"] = "Enter the new rate"
            if (a.kind == "emi" && (a.emiAmount == null || a.emiAmount.toBigDecimal().signum() <= 0)) e["emiAmount"] = "Enter the new EMI"
            if (a.kind == "restructure" && a.annualRate.isNullOrBlank() && a.remainingInstallments == null && a.emiAmount.isNullOrBlank()) e["kind"] = "Restructure needs a new rate, EMI or tenure"
        }
        return e
    }

    fun reminder(r: CustomReminder): Map<String, String> {
        val e = linkedMapOf<String, String>()
        if (r.title.isBlank()) e["title"] = "Title is required"
        e.len("title", r.title, 120); e.len("description", r.description, 1000)
        e.date("date", r.date)
        if (!TIME.matches(r.time)) e["time"] = "Use HH:MM"
        if (r.repeat !in setOf("none", "daily", "weekly", "monthly", "yearly")) e["repeat"] = "Unknown repeat"
        return e
    }

    fun bill(b: Bill): Map<String, String> {
        val e = linkedMapOf<String, String>()
        if (b.name.isBlank()) e["name"] = "Bill name is required"
        e.len("name", b.name, 120); e.len("payee", b.payee, 120); e.len("notes", b.notes, 2000)
        if (b.category !in BILL_CATEGORIES) e["category"] = "Unknown category"
        e.money("amount", b.amount, "Amount", positive = true)
        if (b.frequency !in BILL_FREQUENCY_MONTHS) e["frequency"] = "Unknown frequency"
        if (b.dueDay !in 1..31) e["dueDay"] = "Day must be 1–31"
        e.date("startDate", b.startDate); e.date("endDate", b.endDate, nullable = true)
        if (b.endDate != null && Dates.valid(b.endDate) && Dates.valid(b.startDate) && b.endDate < b.startDate) e["endDate"] = "Last due date must be after the first"
        if (b.reminderOffsets != null && (b.reminderOffsets.size > 10 || b.reminderOffsets.any { it !in 0..60 })) e["reminderOffsets"] = "Days must be 0–60"
        return e
    }

    fun billPayment(p: BillPayment): Map<String, String> {
        val e = linkedMapOf<String, String>()
        e.date("dueDate", p.dueDate); e.date("paidDate", p.paidDate); e.money("amount", p.amount, "Amount"); e.len("notes", p.notes, 1000)
        return e
    }

    fun debt(d: Debt): Map<String, String> {
        val e = linkedMapOf<String, String>()
        if (d.direction !in setOf("lent", "borrowed")) e["direction"] = "Unknown direction"
        if (d.person.isBlank()) e["person"] = "Enter who it is"
        e.len("person", d.person, 120); e.len("notes", d.notes, 2000)
        e.money("amount", d.amount, "Amount", positive = true)
        e.date("date", d.date); e.date("dueDate", d.dueDate, nullable = true)
        if (d.dueDate != null && Dates.valid(d.dueDate) && Dates.valid(d.date) && d.dueDate < d.date) e["dueDate"] = "Return date must be on or after the date given"
        return e
    }

    fun debtRepayment(r: DebtRepayment): Map<String, String> {
        val e = linkedMapOf<String, String>()
        e.date("date", r.date); e.money("amount", r.amount, "Amount", positive = true); e.len("notes", r.notes, 500)
        return e
    }

    fun preferences(p: Preferences): Map<String, String> {
        val e = linkedMapOf<String, String>()
        if (!Regex("^[A-Z]{3}$").matches(p.currency)) e["currency"] = "Invalid currency"
        if (p.decimals !in 0..2) e["decimals"] = "0–2"
        if (p.weekStart !in 0..1) e["weekStart"] = "0 or 1"
        if (p.theme !in setOf("system", "dark", "light")) e["theme"] = "Unknown theme"
        if (!COLOR.matches(p.accent)) e["accent"] = "Invalid colour"
        if (p.heatmapThresholds.size != 4 || p.heatmapThresholds.any { it < 0 }) e["heatmapThresholds"] = "Four non-negative thresholds"
        val r = p.reminders
        if (!TIME.matches(r.time) || !TIME.matches(r.quietStart) || !TIME.matches(r.quietEnd)) e["reminders"] = "Times must be HH:MM"
        if (r.weekdays.size != 7) e["reminders.weekdays"] = "Seven weekdays"
        return e
    }

    /** Validate every record of a snapshot; returns the first problem or null. */
    fun snapshot(d: SnapshotData): String? {
        d.loans.forEach { l -> loan(l).entries.firstOrNull()?.let { return "Loan ${l.name}: ${it.key}: ${it.value}" } }
        d.payments.forEach { p -> payment(p).entries.firstOrNull()?.let { return "Payment ${p.id}: ${it.key}: ${it.value}" } }
        d.adjustments.forEach { a -> adjustment(a).entries.firstOrNull()?.let { return "Change ${a.id}: ${it.key}: ${it.value}" } }
        d.customReminders.forEach { r -> reminder(r).entries.firstOrNull()?.let { return "Reminder ${r.id}: ${it.key}: ${it.value}" } }
        d.bills.forEach { b -> bill(b).entries.firstOrNull()?.let { return "Bill ${b.name}: ${it.key}: ${it.value}" } }
        d.billPayments.forEach { p -> billPayment(p).entries.firstOrNull()?.let { return "Bill payment ${p.id}: ${it.key}: ${it.value}" } }
        d.debts.forEach { x -> debt(x).entries.firstOrNull()?.let { return "Lending / borrowing ${x.person}: ${it.key}: ${it.value}" } }
        d.debtRepayments.forEach { r -> debtRepayment(r).entries.firstOrNull()?.let { return "Repayment ${r.id}: ${it.key}: ${it.value}" } }
        preferences(d.preferences.value).entries.firstOrNull()?.let { return "Preferences: ${it.key}: ${it.value}" }
        val loanIds = d.loans.map { it.id }.toSet()
        if ((d.payments.map { it.loanId } + d.adjustments.map { it.loanId }).any { it !in loanIds }) return "Backup contains records that reference a missing loan"
        return null
    }
}
