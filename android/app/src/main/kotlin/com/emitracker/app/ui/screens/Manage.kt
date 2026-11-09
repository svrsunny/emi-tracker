package com.emitracker.app.ui.screens

import android.Manifest
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Switch
import androidx.compose.material.icons.outlined.NotificationAdd
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Assessment
import androidx.compose.material.icons.outlined.Handshake
import androidx.compose.material.icons.outlined.Backup
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.HelpOutline
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.ShowChart
import androidx.compose.material.icons.outlined.TableRows
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import com.emitracker.app.BuildConfig
import com.emitracker.app.data.Defaults
import com.emitracker.app.data.DemoData
import com.emitracker.app.io.FileFolder
import com.emitracker.app.io.RestorePreview
import com.emitracker.app.io.SafFolder
import com.emitracker.app.io.SecretBox
import com.emitracker.app.ui.AppViewModel
import com.emitracker.app.ui.LocalPalette
import com.emitracker.app.ui.PdfReports
import com.emitracker.app.ui.Screen
import com.emitracker.app.ui.TableReport
import com.emitracker.app.ui.UiState
import com.emitracker.app.ui.components.Callout
import com.emitracker.app.ui.components.CalloutKind
import com.emitracker.app.ui.components.ConfirmDialog
import com.emitracker.app.ui.components.DateField
import com.emitracker.app.ui.components.Dropdown
import com.emitracker.app.ui.components.EmiCard
import com.emitracker.app.ui.components.EmptyState
import com.emitracker.app.ui.components.Field
import com.emitracker.app.ui.components.HEAT_PALETTES
import com.emitracker.app.ui.components.IntField
import com.emitracker.app.ui.components.KvRow
import com.emitracker.app.ui.components.PassphraseDialog
import com.emitracker.app.ui.components.Segmented
import com.emitracker.app.ui.components.SwitchRow
import com.emitracker.app.ui.components.TimeField
import com.emitracker.app.ui.parseColor
import com.emitracker.app.ui.rememberCsvExporter
import com.emitracker.app.ui.rememberDocumentWriter
import com.emitracker.app.ui.rememberPdfWriter
import com.emitracker.app.work.Background
import com.emitracker.app.work.Notifier
import com.emitracker.app.work.zone
import com.emitracker.core.Aggregate
import com.emitracker.core.BackupException
import com.emitracker.core.CustomReminder
import com.emitracker.core.Filters
import com.emitracker.core.HistoryItem
import com.emitracker.core.NotificationRecord
import com.emitracker.core.PlannedReminder
import com.emitracker.core.PlannerInput
import com.emitracker.core.ReminderSettings
import com.emitracker.core.Reminders
import com.emitracker.core.RowStatus
import com.emitracker.core.SnapshotCodec
import com.emitracker.core.Validation
import kotlinx.coroutines.launch
import java.time.LocalDateTime

@Composable
fun MoreScreen(vm: AppViewModel, nav: NavHostController) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val p = LocalPalette.current
    val lastBackupDays = ui.data.local.lastBackupAt?.let { java.time.Duration.between(java.time.Instant.parse(it), java.time.Instant.now()).toDays() }
    Screen("More") {
        item {
            EmiCard {
                listOf(
                    Triple(Icons.Outlined.Handshake, "Lending & borrowing", "lending"), Triple(Icons.Outlined.ReceiptLong, "Payment history", "payments"), Triple(Icons.Outlined.GridView, "Repayment heatmaps", "heatmaps"),
                    Triple(Icons.Outlined.CalendarMonth, "Calendar (EMIs & bills)", "calendar"), Triple(Icons.Outlined.TableRows, "Amortization schedules", "schedules"),
                    Triple(Icons.Outlined.ShowChart, "What-if calculator", "whatif"), Triple(Icons.Outlined.Notifications, "Reminders & notifications${if (ui.inbox.isNotEmpty()) " (${ui.inbox.size})" else ""}", "reminders"),
                    Triple(Icons.Outlined.Assessment, "Reports", "reports"), Triple(Icons.Outlined.Backup, "Backup, sync & restore", "backup"),
                    Triple(Icons.Outlined.Settings, "Settings", "settings"), Triple(Icons.Outlined.HelpOutline, "Help & diagnostics", "help"),
                ).forEach { (icon, label, route) -> MenuRow(icon, label) { nav.navigate(route) } }
            }
        }
        item {
            Callout(when {
                lastBackupDays == null -> "No backup yet. Back up to a folder you choose so your records are safe."
                lastBackupDays > 7 -> "Last backup was $lastBackupDays days ago."
                else -> "Last backup ${if (lastBackupDays == 0L) "today" else "$lastBackupDays day(s) ago"}."
            }, if (lastBackupDays == null || lastBackupDays > 7) CalloutKind.Warn else CalloutKind.Ok)
        }
        item { Text("Offline · data stored only on this device · v${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall, color = p.text3) }
    }
}

@Composable
private fun MenuRow(icon: ImageVector, label: String, onClick: () -> Unit) {
    val p = LocalPalette.current
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable(onClick = onClick).padding(vertical = 14.dp, horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = p.accent); Spacer(Modifier.width(14.dp))
        Text(label, style = MaterialTheme.typography.bodyLarge, color = p.text, modifier = Modifier.weight(1f))
        Icon(Icons.AutoMirrored.Outlined.ArrowForward, null, tint = p.text3, modifier = Modifier.size(18.dp))
    }
}

// ------------------------------------------------------------------------------------- reminders
private val CATEGORY_LABEL = listOf("emi_upcoming" to "Upcoming EMI", "emi_due" to "EMI due today", "emi_overdue" to "EMI overdue (repeats)", "emi_missed" to "Missed EMI",
    "loan_closure" to "Upcoming loan closure", "summary_monthly" to "Monthly summary", "summary_weekly" to "Weekly summary", "backup" to "Backup reminder",
    "custom" to "Custom reminders", "rate_change" to "Rate / loan changes", "bill" to "Bills", "debt" to "Lending & borrowing")

@Composable
fun RemindersScreen(vm: AppViewModel, nav: NavHostController) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val p = LocalPalette.current
    val fmt = ui.fmt
    val context = LocalContext.current
    var tab by rememberSaveable { mutableStateOf(if (ui.inbox.isNotEmpty()) "inbox" else "custom") }
    var edit by remember { mutableStateOf<CustomReminder?>(null) }
    val askPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { vm.info(if (it) "Notifications allowed" else "Notifications are off — reminders stay in the app inbox") }
    val canPost = Notifier.canPost(context)
    val now = Reminders.wallTime(LocalDateTime.now(zone(ui.prefs.timeZone)))
    val upcoming = remember(ui) {
        Reminders.upcoming(PlannerInput(now, ui.prefs.reminders, ui.data.loans, ui.comps, ui.data.adjustments, ui.data.customReminders,
            ui.data.notifications.map { HistoryItem(it.key, it.state, it.snoozedUntil) }, ui.data.local.lastBackupAt?.substring(0, 10), fmt::money, fmt::date, ui.data.bills, ui.data.billPayments, ui.data.debts, ui.data.debtRepayments), 45)
    }
    Screen("Reminders", "Your own reminders, EMI reminders and the inbox", nav, back = true, actions = {
        IconButton(onClick = { edit = Defaults.reminder(ui.asOf) }) { Icon(Icons.Outlined.NotificationAdd, "Add reminder", tint = p.accent) }
    }) {
        if (!canPost) item {
            EmiCard {
                Callout("Android notifications are off for EMI Tracker, so reminders only appear in this inbox when you open the app.", CalloutKind.Warn)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                    if (Build.VERSION.SDK_INT >= 33) Button(onClick = { askPermission.launch(Manifest.permission.POST_NOTIFICATIONS) }) { Text("Allow notifications") }
                    OutlinedButton(onClick = { context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)) }) { Text("Open settings") }
                }
            }
        }
        item { Segmented(listOf("custom" to "My reminders (${ui.data.customReminders.size})", "inbox" to "Inbox (${ui.inbox.size})", "upcoming" to "Upcoming (${upcoming.size})", "history" to "History", "settings" to "Settings", "diagnostics" to "Diagnostics"), tab, { tab = it }) }
        when (tab) {
            "inbox" -> notificationItems(vm, ui, ui.inbox, true, nav)
            "history" -> notificationItems(vm, ui, ui.data.notifications, false, nav)
            "upcoming" -> {
                if (upcoming.isEmpty()) item { EmiCard { Text("No reminders in the next 45 days with the current settings.", color = p.text3) } }
                items(upcoming.take(200), key = { it.key }) { r -> EmiCard(padding = 12.dp) { UpcomingRow(r, fmt) } }
            }
            "custom" -> {
                item {
                    Button(onClick = { edit = Defaults.reminder(ui.asOf) }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Outlined.NotificationAdd, null); Spacer(Modifier.width(6.dp)); Text("Add a reminder")
                    }
                }
                if (ui.data.customReminders.isEmpty()) item {
                    EmiCard { EmptyState(Icons.Outlined.Notifications, "No reminders yet", "Add a reminder for anything — rent, insurance renewal, a chit auction day, a bill. It doesn't need a loan.") }
                }
                items(ui.data.customReminders, key = { it.id }) { r ->
                    EmiCard(padding = 12.dp, onClick = { edit = r }) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(r.title, style = MaterialTheme.typography.titleSmall, color = p.text)
                                Text("${fmt.date(r.date)} ${r.time} · ${REPEAT_LABEL[r.repeat] ?: r.repeat}${r.loanId?.let { id -> " · " + (ui.data.loans.firstOrNull { it.id == id }?.name ?: "") } ?: ""}", style = MaterialTheme.typography.bodySmall, color = p.text3)
                                if (r.description.isNotBlank()) Text(r.description, style = MaterialTheme.typography.bodySmall, color = p.text2, maxLines = 2)
                            }
                            Switch(r.enabled, { v -> vm.act { vm.repo.saveReminder(r.copy(enabled = v)) } })
                            IconButton(onClick = { vm.act("Reminder deleted") { vm.repo.deleteReminder(r.id) } }) { Icon(Icons.Outlined.DeleteOutline, "Delete reminder", tint = p.text3) }
                        }
                    }
                }
            }
            "settings" -> item { ReminderSettingsForm(vm, ui) }
            "diagnostics" -> item { ReminderDiagnostics(vm, ui) }
        }
    }
    edit?.let { r -> CustomReminderDialog(vm, ui, r) { edit = null } }
}

@Composable
private fun UpcomingRow(r: PlannedReminder, fmt: com.emitracker.app.ui.Fmt) {
    val p = LocalPalette.current
    Column(Modifier.padding(vertical = 5.dp)) {
        Text(r.title, style = MaterialTheme.typography.bodyMedium, color = p.text)
        Text("${fmt.date(r.at.substring(0, 10))} ${r.at.substring(11)} · ${r.body}", style = MaterialTheme.typography.bodySmall, color = p.text3)
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.notificationItems(vm: AppViewModel, ui: UiState, items: List<NotificationRecord>, actions: Boolean, nav: NavHostController) {
    if (items.isEmpty()) { item { EmiCard { EmptyState(Icons.Outlined.Notifications, if (actions) "You're all caught up" else "No notifications yet", "Reminders appear here even if Android notifications are off.") } }; return }
    items.take(300).forEach { n ->
        item(key = n.id) {
            val p = LocalPalette.current
            EmiCard(padding = 12.dp) {
                Text(n.title, style = MaterialTheme.typography.titleSmall, color = p.text)
                Text(n.body, style = MaterialTheme.typography.bodySmall, color = p.text2)
                Text("${n.deliveredAt.replace('T', ' ')} · ${if (n.channel == "native") "notification + inbox" else "inbox only"} · ${n.state}${if (n.late) " · delivered late" else ""}${n.snoozedUntil?.let { " until ${it.replace('T', ' ')}" } ?: ""}",
                    style = MaterialTheme.typography.bodySmall, color = if (n.late) p.warning else p.text3)
                Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
                    n.loanId?.let { id -> TextButton(onClick = { nav.navigate("loan/$id") }) { Text("Open loan") } }
                    if (actions && n.state == "sent") {
                        TextButton(onClick = { vm.act("Snoozed") { vm.repo.saveNotification(n.copy(state = "snoozed", snoozedUntil = Reminders.addMinutes(Reminders.wallTime(LocalDateTime.now(zone(ui.prefs.timeZone))), ui.prefs.reminders.snoozeMinutes.toLong()))); Background.runSoon(vm.getApplication(), ui.prefs.reminders.snoozeMinutes.toLong()) } }) { Text("Snooze") }
                        TextButton(onClick = { vm.act { vm.repo.saveNotification(n.copy(state = "dismissed")) } }) { Text("Dismiss") }
                    }
                }
            }
        }
    }
    if (actions) item { Text("Dismissing a reminder never marks an EMI as paid — record the payment to update your loan.", style = MaterialTheme.typography.bodySmall, color = LocalPalette.current.text3) }
}

@Composable
private fun ReminderSettingsForm(vm: AppViewModel, ui: UiState) {
    var s by remember(ui.prefs.reminders) { mutableStateOf(ui.prefs.reminders) }
    var offsets by remember(ui.prefs.reminders) { mutableStateOf(ui.prefs.reminders.offsets.joinToString(", ")) }
    val p = LocalPalette.current
    val days = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        EmiCard(title = "Categories") {
            SwitchRow("Reminders enabled", s.enabled, { s = s.copy(enabled = it) })
            CATEGORY_LABEL.forEach { (k, label) ->
                SwitchRow(label, s.categories.enabled(k), { v ->
                    val c = s.categories
                    s = s.copy(categories = when (k) {
                        "emi_upcoming" -> c.copy(emi_upcoming = v); "emi_due" -> c.copy(emi_due = v); "emi_overdue" -> c.copy(emi_overdue = v); "emi_missed" -> c.copy(emi_missed = v)
                        "loan_closure" -> c.copy(loan_closure = v); "summary_monthly" -> c.copy(summary_monthly = v); "summary_weekly" -> c.copy(summary_weekly = v)
                        "backup" -> c.copy(backup = v); "custom" -> c.copy(custom = v); "bill" -> c.copy(bill = v); "debt" -> c.copy(debt = v); else -> c.copy(rate_change = v)
                    })
                })
            }
        }
        EmiCard(title = "Timing") {
            Field("Days before EMI", offsets, { offsets = it }, hint = "Comma-separated, e.g. 7, 3, 1")
            TimeField("Notification time", s.time, { s = s.copy(time = it) })
            IntField("Repeat overdue every", s.overdueRepeatDays, { s = s.copy(overdueRepeatDays = (it ?: 1).coerceIn(1, 30)) }, suffix = "days")
            IntField("Maximum overdue repeats", s.maxRepeats, { s = s.copy(maxRepeats = (it ?: 1).coerceIn(1, 30)) })
            IntField("Snooze duration", s.snoozeMinutes, { s = s.copy(snoozeMinutes = (it ?: 5).coerceIn(5, 10080)) }, suffix = "min")
            IntField("Closure reminder lead", s.closureLeadDays, { s = s.copy(closureLeadDays = (it ?: 1).coerceIn(1, 365)) }, suffix = "days")
            IntField("Backup reminder after", s.backupIntervalDays, { s = s.copy(backupIntervalDays = (it ?: 1).coerceIn(1, 365)) }, suffix = "days")
            Dropdown("Weekly summary on", s.weeklySummaryDay, days.mapIndexed { i, d -> i to d }, { s = s.copy(weeklySummaryDay = it) })
            IntField("Deliver missed reminders up to", s.catchUpDays, { s = s.copy(catchUpDays = (it ?: 0).coerceIn(0, 30)) }, suffix = "days late")
        }
        EmiCard(title = "Quiet hours & days") {
            SwitchRow("Quiet hours", s.quietEnabled, { s = s.copy(quietEnabled = it) }, "Reminders inside are delivered when quiet hours end")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { TimeField("From", s.quietStart, { s = s.copy(quietStart = it) }, Modifier.weight(1f)); TimeField("To", s.quietEnd, { s = s.copy(quietEnd = it) }, Modifier.weight(1f)) }
            Text("Deliver on", style = MaterialTheme.typography.labelMedium, color = p.text2)
            FlowRow { days.forEachIndexed { i, d -> Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(s.weekdays[i], { v -> s = s.copy(weekdays = s.weekdays.mapIndexed { j, x -> if (j == i) v else x }) }); Text(d, color = p.text) } } }
        }
        EmiCard(title = "Delivery") {
            SwitchRow("Android notifications", s.channels.native, { s = s.copy(channels = s.channels.copy(native = it)) })
            SwitchRow("In-app inbox", s.channels.inApp, { s = s.copy(channels = s.channels.copy(inApp = it)) }, "Always used when notifications are unavailable")
            SwitchRow("Sound", s.sound, { s = s.copy(sound = it) }, "Per-channel sound and vibration are controlled in Android settings")
            SwitchRow("Vibration", s.vibrate, { s = s.copy(vibrate = it) })
            Dropdown("Priority", s.priority, listOf("high" to "High", "normal" to "Normal", "low" to "Low"), { s = s.copy(priority = it) })
        }
        Button(onClick = {
            val offs = offsets.split(",").mapNotNull { it.trim().toIntOrNull() }.filter { it in 0..60 }.distinct().sortedDescending().take(10)
            vm.act("Reminder settings saved") { vm.repo.setPreferences(ui.prefs.copy(reminders = s.copy(offsets = offs))) }
        }, modifier = Modifier.fillMaxWidth()) { Text("Save reminder settings") }
    }
}

@Composable
private fun ReminderDiagnostics(vm: AppViewModel, ui: UiState) {
    val context = LocalContext.current
    val p = LocalPalette.current
    val scope = rememberCoroutineScope()
    val pm = context.getSystemService(android.os.PowerManager::class.java)
    val ignoringBattery = pm.isIgnoringBatteryOptimizations(context.packageName)
    EmiCard(title = "Test & diagnostics") {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = {
                scope.launch {
                    val now = Reminders.wallTime(LocalDateTime.now(zone(ui.prefs.timeZone)))
                    val id = Defaults.id()
                    val r = PlannedReminder("test:$now:$id", "test", "EMI Tracker test notification", "Notifications are working. Android may still delay scheduled reminders to save battery.", null, now, false)
                    val shown = Notifier.post(context, r, id, !ui.prefs.reminders.sound, ui.prefs.reminders.priority)
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { vm.repo.saveNotification(NotificationRecord(id, Defaults.ts(), Defaults.ts(), r.key, "test", r.title, r.body, null, now, now, "sent", null, if (shown) "native" else "in_app", false, ui.data.local.deviceId)) }
                    if (shown) vm.info("Test notification sent") else vm.error("Android did not show it: notifications are off or blocked for this app. It is in the inbox.")
                }
            }) { Text("Send test") }
            OutlinedButton(onClick = { scope.launch { val n = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { Background.tick(context, vm.repo, vm.backup) }; vm.info("Checked: $n reminder(s) delivered") } }) { Text("Check now") }
        }
        Spacer(Modifier.height(10.dp))
        KvRow("Notification permission", if (Notifier.canPost(context)) "Allowed" else "Not allowed", if (Notifier.canPost(context)) p.positive else p.danger)
        listOf(Notifier.CH_EMI to "EMI channel", Notifier.CH_OVERDUE to "Overdue channel", Notifier.CH_SUMMARY to "Summary channel").forEach { (ch, l) -> KvRow(l, if (Notifier.channelEnabled(context, ch)) "On" else "Off by user") }
        KvRow("Battery optimisation", if (ignoringBattery) "Unrestricted" else "Optimised (may delay)")
        KvRow("Background check", "Every ~15 min via WorkManager")
        KvRow("Last check (this process)", Background.lastTick?.replace('T', ' ') ?: "Not yet")
        KvRow("Notification history", "${ui.data.notifications.size} record(s)")
        Spacer(Modifier.height(8.dp))
        Callout("WorkManager runs reminders even when the app is closed and after a reboot, but Android may defer them during Doze or battery saver — exact-minute delivery is not guaranteed. Missed reminders (within the catch-up window) are delivered late and marked so. Nothing is delivered while the phone is off.")
        if (!ignoringBattery) TextButton(onClick = { context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }) { Text("Battery optimisation settings") }
        TextButton(onClick = { context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)) }) { Text("Notification channel settings") }
    }
}

private val REPEAT_LABEL = mapOf("none" to "Once", "daily" to "Daily", "weekly" to "Weekly", "monthly" to "Monthly", "yearly" to "Yearly")

/** Add / edit one of your own reminders; a loan is optional. */
@Composable
fun CustomReminderDialog(vm: AppViewModel, ui: UiState, initial: CustomReminder, onDismiss: () -> Unit) {
    var r by remember { mutableStateOf(initial) }
    var errors by remember { mutableStateOf(emptyMap<String, String>()) }
    AlertDialog(onDismissRequest = onDismiss, containerColor = LocalPalette.current.surface, title = { Text(if (initial.title.isBlank()) "New reminder" else "Edit reminder") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Field("Title", r.title, { r = r.copy(title = it) }, error = errors["title"])
                Field("Note (shown in the notification)", r.description, { r = r.copy(description = it) })
                DateField("Date", r.date, { r = r.copy(date = it ?: r.date) }, error = errors["date"])
                TimeField("Time", r.time, { r = r.copy(time = it) })
                Dropdown("Repeat", r.repeat, listOf("none" to "Once", "daily" to "Daily", "weekly" to "Weekly", "monthly" to "Monthly", "yearly" to "Yearly"), { r = r.copy(repeat = it) })
                Dropdown("Linked loan (optional)", r.loanId ?: "", listOf("" to "None — standalone reminder") + ui.data.loans.map { it.id to it.name }, { r = r.copy(loanId = it.ifBlank { null }) })
            }
        },
        confirmButton = { FilledTonalButton(onClick = { errors = Validation.reminder(r); if (errors.isEmpty()) vm.act("Reminder saved", onDone = onDismiss) { vm.repo.saveReminder(r) } }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } })
}

// ------------------------------------------------------------------------------------- reports
@Composable
fun ReportsScreen(vm: AppViewModel, nav: NavHostController) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val p = LocalPalette.current
    val fmt = ui.fmt
    val context = LocalContext.current
    var id by rememberSaveable { mutableStateOf("summary") }
    var loanId by rememberSaveable { mutableStateOf<String?>(null) }
    var from by rememberSaveable { mutableStateOf<String?>(null) }
    var to by rememberSaveable { mutableStateOf<String?>(null) }
    val csv = rememberCsvExporter(vm)
    val pdf = rememberPdfWriter(vm)
    val report = remember(ui, id, loanId, from, to) { buildReport(ui, id, loanId, from, to) }
    Screen("Reports", "CSV, PDF and print — generated on this phone", nav, back = true) {
        item { Segmented(REPORTS.map { it.first to it.second }, id, { id = it }) }
        item { LoanFilterRow(ui, loanId) { loanId = it } }
        item { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { DateField("From", from, { from = it }, Modifier.weight(1f), clearable = true); DateField("To", to, { to = it }, Modifier.weight(1f), clearable = true) } }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { csv("${report.title}.csv", com.emitracker.core.Csv.write(listOf(report.head) + report.rows)) }) { Text("CSV") }
                OutlinedButton(onClick = { pdf(report) }) { Text("PDF") }
                OutlinedButton(onClick = { PdfReports.print(context, report, fmt) }) { Text("Print") }
            }
        }
        if (id == "tax") item { Callout("Totals of principal and interest you actually paid per Indian financial year (April–March), for reference. Tax treatment depends on your situation and current law — this is not tax advice. Use your lender's interest certificate for filing.", CalloutKind.Warn) }
        if (id == "schedule" && loanId == null && ui.data.loans.size > 1) item { Callout("Showing the first loan. Choose a loan above for its schedule.") }
        report.note?.let { item { Callout(it) } }
        item {
            EmiCard(title = report.title, sub = report.subtitle) {
                if (report.rows.isEmpty()) Text("No data for these filters.", color = p.text3)
                else Text("${report.rows.size} row(s) — the PDF lays them out as a table.", style = MaterialTheme.typography.bodySmall, color = p.text3)
            }
        }
        items(report.rows.take(1000).withIndex().toList(), key = { it.index }) { (_, r) ->
            Column(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 2.dp)) {
                Text(PdfReports.cell(r.first(), fmt), style = MaterialTheme.typography.bodyMedium, color = p.text)
                Text(report.head.drop(1).zip(r.drop(1)).filter { it.second.isNotBlank() }.joinToString(" · ") { (h, v) -> "$h ${PdfReports.cell(v, fmt)}" },
                    style = MaterialTheme.typography.bodySmall, color = p.text2)
            }
        }
    }
}

private val REPORTS = listOf("summary" to "Loan summary", "payments" to "Payment ledger", "schedule" to "Amortization", "annual" to "Annual totals", "interest" to "Interest paid",
    "principal" to "Principal repaid", "late" to "Missed & late", "commitments" to "Future EMIs", "closures" to "Closure dates", "savings" to "Prepayment savings", "tax" to "Financial years")

private fun buildReport(ui: UiState, id: String, loanId: String?, from: String?, to: String?): TableReport {
    val loans = ui.data.loans.filter { loanId == null || it.id == loanId }
    val pf = portfolio(ui)
    val f = Filters(loanId?.let { listOf(it) }, from, to)
    val name = { lid: String -> ui.data.loans.firstOrNull { it.id == lid }?.name ?: "" }
    val title = REPORTS.first { it.first == id }.second
    val sub = "Generated ${ui.fmt.date(ui.asOf)}${loanId?.let { " · " + name(it) } ?: ""}${if (from != null || to != null) " · ${from?.let(ui.fmt::date) ?: "…"} to ${to?.let(ui.fmt::date) ?: "…"}" else ""}"
    fun inRange(d: String) = (from == null || d >= from) && (to == null || d <= to)
    return when (id) {
        "summary" -> TableReport(title, sub, listOf("Loan", "Status", "Principal", "Principal repaid", "Interest paid", "Fees", "Total paid", "Outstanding", "Left", "Remaining outflow", "Closure"),
            loans.map { l -> val s = ui.comps[l.id]!!.summary; listOf(l.name, l.status.replaceFirstChar(Char::uppercase), s.principal, s.principalRepaid, s.interestPaid, com.emitracker.core.Money.money((s.feesPaid.toBigDecimal() + s.penaltiesPaid.toBigDecimal())), s.totalPaid, s.outstandingPrincipal, "${s.installmentsRemaining}", s.remainingCashOutflow, s.closureDate ?: "") })
        "payments" -> TableReport(title, sub, listOf("Date", "Loan", "Type", "Amount", "Principal", "Interest", "Fees", "Reference", "Status"),
            ui.data.payments.filter { (loanId == null || it.loanId == loanId) && inRange(it.txnDate) }.sortedBy { it.txnDate }.map { x -> val a = ui.comps[x.loanId]?.allocations?.get(x.id)
                listOf(x.txnDate, name(x.loanId), PAYMENT_TYPE_LABEL[x.type] ?: x.type, x.amount, a?.principal?.let { com.emitracker.core.Money.money(it) } ?: "", a?.interest?.let { com.emitracker.core.Money.money(it) } ?: "", a?.let { com.emitracker.core.Money.money(it.fees + it.penalty) } ?: "", x.reference, x.status) })
        "schedule" -> {
            val l = loans.firstOrNull()
            TableReport("$title${l?.let { " — " + it.name } ?: ""}", sub, listOf("#", "Due", "EMI", if (l?.loanType == "chit_fund") "Dividend" else "Interest", "Principal", "Paid", "Closing", "Status"),
                l?.let { ui.comps[it.id]!!.rows.map { r -> listOf(r.emiNo?.toString() ?: "M${r.no}", r.dueDate, r.scheduledAmount, if (l.loanType == "chit_fund") r.dividend else r.interest, r.principalDue, if (r.paidAmount.toDouble() > 0) r.paidAmount else "", r.closingPrincipal, r.status.label) } } ?: emptyList())
        }
        "annual" -> TableReport(title, sub, listOf("Year", "Payments", "Total paid", "Principal", "Interest", "Fees"), Aggregate.annualSummary(pf, f).map { listOf("${it.year}", "${it.count}", it.paid, it.principal, it.interest, it.fees) })
        "interest", "principal" -> TableReport(title, sub, listOf("Month", "Loan", if (id == "interest") "Interest paid" else "Principal repaid"),
            Aggregate.activity(pf, f).groupBy { it.date.substring(0, 7) + "|" + it.loanId }.toSortedMap().map { (k, v) -> listOf(k.substringBefore('|'), name(k.substringAfter('|')), com.emitracker.core.Money.money(v.fold(java.math.BigDecimal.ZERO) { s, a -> s + if (id == "interest") a.interest else a.principal })) })
        "late" -> TableReport(title, sub, listOf("Loan", "Installment", "Due", "Status", "Paid on", "Scheduled", "Unpaid", "Charges (est.)"),
            loans.flatMap { l -> ui.comps[l.id]!!.rows.filter { r -> r.dueDate <= ui.asOf && (r.late || r.status in setOf(RowStatus.overdue, RowStatus.missed, RowStatus.partially_paid)) && inRange(r.dueDate) }
                .map { r -> listOf(l.name, "${r.emiNo ?: r.no}", r.dueDate, r.status.label + if (r.late && r.status == RowStatus.paid) " (late)" else "", r.lastPaymentDate ?: "", r.scheduledAmount, r.shortfall, r.feesCharged) } })
        "commitments" -> TableReport(title, sub, listOf("Month", "Loan", "Projected EMI"),
            loans.filter { it.status == "active" }.flatMap { l -> ui.comps[l.id]!!.rows.filter { it.dueDate > ui.asOf && inRange(it.dueDate) }.map { r -> Triple(r.dueDate.substring(0, 7), l.name, r.projectedAmount.toBigDecimal() + r.paidAmount.toBigDecimal()) } }
                .groupBy { it.first + "|" + it.second }.toSortedMap().map { (k, v) -> listOf(k.substringBefore('|'), k.substringAfter('|'), com.emitracker.core.Money.money(v.fold(java.math.BigDecimal.ZERO) { s, t -> s + t.third })) }, "Projection assuming every EMI is paid on schedule.")
        "closures" -> TableReport(title, sub, listOf("Loan", "Outstanding", "EMI", "Left", "Remaining interest", "Remaining outflow", "Projected closure", "Contract closure"),
            loans.filter { it.status == "active" }.map { l -> val s = ui.comps[l.id]!!.summary; listOf(l.name, s.outstandingPrincipal, s.currentEmi, "${s.installmentsRemaining}", s.remainingInterest, s.remainingCashOutflow, s.closureDate ?: if (s.nonConverging) "never" else "", s.baselineClosureDate ?: "") }, "Projection assuming every EMI is paid on schedule.")
        "savings" -> TableReport(title, sub, listOf("Loan", "Extra principal paid", "Contract interest", "Lifetime interest now", "Interest saved", "Installments saved"),
            loans.map { l -> val c = ui.comps[l.id]!!; listOf(l.name, com.emitracker.core.Money.money(c.rows.fold(java.math.BigDecimal.ZERO) { s, r -> s + r.extraPrincipal.toBigDecimal() }), c.summary.baselineTotalInterest, c.summary.lifetimeInterest, c.summary.interestSaved, "${c.summary.periodsSaved}") }, "Estimate versus the original contract.")
        else -> TableReport(title, sub, listOf("Financial year", "Loan", "Type", "Principal repaid", "Interest paid", "Total paid"),
            loans.flatMap { l -> Aggregate.financialYears(pf, f.copy(loanIds = listOf(l.id))).map { listOf(it.fy, l.name, LOAN_TYPE_LABEL[l.loanType] ?: l.loanType, it.principal, it.interest, it.paid) } }.sortedBy { it[0] })
    }.let { r -> reportExtras(ui, id, loans, r) }
}

/** Summary boxes on the PDF's first page; the schedule has no totals row. */
private fun reportExtras(ui: UiState, id: String, loans: List<com.emitracker.core.Loan>, r: TableReport): TableReport {
    val fmt = ui.fmt
    fun sum(f: (com.emitracker.core.LoanSummary) -> String) = fmt.money(loans.fold(java.math.BigDecimal.ZERO) { s, l -> s + f(ui.comps[l.id]!!.summary).toBigDecimal() }.toPlainString())
    return when (id) {
        "summary" -> if (loans.isEmpty()) r else r.copy(summary = listOf("Loans" to "${loans.size}", "Principal" to sum { it.principal }, "Total paid" to sum { it.totalPaid },
            "Outstanding" to sum { it.outstandingPrincipal }, "Still to pay" to sum { it.remainingCashOutflow }))
        "schedule" -> loans.firstOrNull()?.let { l ->
            val s = ui.comps[l.id]!!.summary
            r.copy(totals = false, summary = listOf("Principal" to fmt.money(s.principal), "Current EMI" to fmt.money(s.currentEmi), "Outstanding" to fmt.money(s.outstandingPrincipal),
                "Paid" to "${s.installmentsPaid} of ${s.totalInstallments}", "Closure" to fmt.date(s.closureDate)))
        } ?: r.copy(totals = false)
        else -> r
    }
}

// ------------------------------------------------------------------------------------- backup / sync / restore
@Composable
fun BackupScreen(vm: AppViewModel, nav: NavHostController) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val p = LocalPalette.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val local = ui.data.local
    var passFor by remember { mutableStateOf<String?>(null) } // "backup" | "sync"
    var pendingPass by remember { mutableStateOf<String?>(null) }
    var restoreText by remember { mutableStateOf<String?>(null) }
    var restorePass by remember { mutableStateOf("") }
    var preview by remember { mutableStateOf<RestorePreview?>(null) }
    var confirmRestore by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val history by androidx.compose.runtime.produceState(emptyList<com.emitracker.app.data.BackupHistoryEntity>(), ui) { value = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { vm.repo.backupHistory(50) } }

    val onBackupUri: (Uri?) -> Unit = { uri ->
        val pass = pendingPass; pendingPass = null
        if (uri != null) scope.launch {
            busy = true
            runCatching { vm.backup.backupTo(uri, pass) }.onSuccess { vm.info("Backup saved and verified (${it.counts["loans"]} loans, ${it.counts["payments"]} payments)") }.onFailure { vm.error("Backup failed: ${it.message}") }
            busy = false
        }
    }
    val createDoc = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json"), onBackupUri)
    // a binary type, so the file picker keeps the .emibackup name instead of adding ".json"
    val createEncryptedDoc = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream"), onBackupUri)
    val openDoc = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            runCatching { vm.backup.readUri(uri) }.onSuccess { text ->
                restoreText = text; preview = null; restorePass = ""
                if (!SnapshotCodec.isEncrypted(text)) runCatching { vm.backup.preview(text, null) }.onSuccess { preview = it }.onFailure { vm.error(it.message ?: "Invalid backup") }
            }.onFailure { vm.error("Could not read file: ${it.message}") }
        }
    }
    val treeForBackup = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri != null) {
            context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            vm.act("Automatic backup folder set") { vm.repo.setLocal { it.copy(backupTreeUri = uri.toString(), autoBackup = true) } }
        }
    }
    val treeForSync = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri != null) {
            context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            vm.act("Sync folder set") { vm.repo.setLocal { it.copy(syncTreeUri = uri.toString()) } }
        }
    }
    val exportJson = rememberDocumentWriter(vm, "application/json")
    val exportCsv = rememberCsvExporter(vm)
    val lastAge = local.lastBackupAt?.let { java.time.Duration.between(java.time.Instant.parse(it), java.time.Instant.now()).toDays() }

    Screen("Backup, sync & restore", "Your data exists only on your devices", nav, back = true) {
        item {
            EmiCard(hero = lastAge != null && lastAge <= 7) {
                Text("Last successful backup", style = MaterialTheme.typography.labelMedium, color = p.text2)
                Text(when (lastAge) { null -> "Never"; 0L -> "Today"; else -> "$lastAge day(s) ago" }, style = MaterialTheme.typography.titleLarge, color = when { lastAge == null -> p.danger; lastAge > 7 -> p.warning; else -> p.positive })
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(enabled = !busy, onClick = { pendingPass = null; createDoc.launch(vm.backup.fileName("backup", false)) }) { Text("Back up now") }
                    OutlinedButton(enabled = !busy, onClick = { passFor = "backup" }) { Text("Encrypted backup") }
                }
                Text("You choose where the file goes: Documents, SD card, USB storage or any installed document provider.", style = MaterialTheme.typography.bodySmall, color = p.text3, modifier = Modifier.padding(top = 6.dp))
            }
        }
        item {
            EmiCard(title = "Automatic backups") {
                SwitchRow("Back up automatically", local.autoBackup, { v -> vm.act { vm.repo.setLocal { it.copy(autoBackup = v) } } }, if (local.backupTreeUri.isBlank()) "Choose a folder first" else "Into ${runCatching { SafFolder(context, Uri.parse(local.backupTreeUri)).label }.getOrDefault("chosen folder")}")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    IntField("Every", local.autoBackupHours, { v -> vm.act { vm.repo.setLocal { it.copy(autoBackupHours = (v ?: 24).coerceIn(1, 720)) } } }, Modifier.weight(1f), suffix = "hours")
                    IntField("Keep latest", local.backupKeep, { v -> vm.act { vm.repo.setLocal { it.copy(backupKeep = (v ?: 30).coerceIn(1, 500)) } } }, Modifier.weight(1f), suffix = "files")
                }
                OutlinedButton(onClick = { treeForBackup.launch(null) }) { Text(if (local.backupTreeUri.isBlank()) "Choose folder" else "Change folder") }
            }
        }
        item {
            EmiCard(title = "Restore", sub = "Replace all current data with a backup") {
                Callout("Restoring overwrites current loans and payments. A recovery backup is saved inside the app first, and the restore is rolled back if verification fails.", CalloutKind.Warn)
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = { openDoc.launch(arrayOf("*/*")) }) { Text("Choose backup to restore…") }
                if (restoreText != null && preview == null && SnapshotCodec.isEncrypted(restoreText!!)) {
                    Field("Backup passphrase", restorePass, { restorePass = it }, password = true)
                    FilledTonalButton(onClick = { scope.launch { runCatching { vm.backup.preview(restoreText!!, restorePass) }.onSuccess { preview = it }.onFailure { vm.error(it.message ?: "Could not open backup") } } }, enabled = restorePass.isNotEmpty()) { Text("Unlock & validate") }
                }
                preview?.let { pv ->
                    Spacer(Modifier.height(8.dp))
                    Callout("Backup is valid: structure, checksum and references verified.", CalloutKind.Ok)
                    KvRow("Created", pv.snapshot.createdAt.replace('T', ' ').take(16)); KvRow("From", "${pv.snapshot.deviceName.ifBlank { "Unknown device" }} · ${pv.snapshot.app.platform} v${pv.snapshot.app.version}")
                    KvRow("Format", "v${pv.snapshot.formatVersion} · schema ${pv.snapshot.schemaVersion}${if (pv.encrypted) " · encrypted" else ""}")
                    listOf("loans" to "Loans", "payments" to "Payments", "adjustments" to "Rate / EMI changes", "customReminders" to "Custom reminders", "notifications" to "Notifications", "audit" to "Audit entries").forEach { (k, l) ->
                        KvRow(l, "${pv.snapshot.counts[k] ?: 0}  (now ${pv.current[k] ?: 0})")
                    }
                    Button(onClick = { confirmRestore = true }, enabled = !busy) { Text("Restore this backup…") }
                }
            }
        }
        item { WifiSyncCard(vm, local) }
        item {
            EmiCard(title = "Folder sync", sub = "Through a folder or USB — works without Wi-Fi") {
                SwitchRow("Automatic sync", local.syncEnabled, { v -> vm.act { vm.repo.setLocal { it.copy(syncEnabled = v) } } }, "In the background when the folder is available (every ${local.syncIntervalMinutes} min or later)")
                Text(if (local.syncTreeUri.isBlank()) "No sync folder chosen" else "Folder: ${runCatching { SafFolder(context, Uri.parse(local.syncTreeUri)).label }.getOrDefault("unavailable")}", style = MaterialTheme.typography.bodySmall, color = p.text2)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 6.dp)) {
                    OutlinedButton(onClick = { treeForSync.launch(null) }) { Text(if (local.syncTreeUri.isBlank()) "Choose folder" else "Change folder") }
                    Button(enabled = local.syncTreeUri.isNotBlank() && !busy, onClick = {
                        scope.launch {
                            busy = true
                            val pass = if (local.syncEncrypted) SecretBox.open(local.syncSecret) else null
                            runCatching {
                                if (local.syncEncrypted && pass == null) error("Set the sync passphrase again")
                                vm.backup.syncNow(SafFolder(context, Uri.parse(local.syncTreeUri)), pass)
                            }.onSuccess { r -> vm.info("Sync complete: +${r.totals.added} · ${r.totals.updated} updated · ${r.totals.deleted} removed${r.peers.count { !it.ok }.let { if (it > 0) " · $it file(s) unreadable" else "" }}") }
                                .onFailure { e -> kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { vm.repo.setLocal { it.copy(lastSyncAt = java.time.Instant.now().toString(), lastSyncResult = "Failed: ${e.message}") } }; vm.error("Sync failed: ${e.message}") }
                            busy = false
                        }
                    }) { Text("Sync now") }
                }
                IntField("Sync every", local.syncIntervalMinutes, { v -> vm.act { vm.repo.setLocal { it.copy(syncIntervalMinutes = (v ?: 60).coerceIn(15, 1440)) } } }, suffix = "min")
                Field("This device's name", local.deviceName, { v -> vm.act { vm.repo.setLocal { it.copy(deviceName = v.take(100)) } } })
                SwitchRow("Encrypt sync files", local.syncEncrypted, { v -> if (v) passFor = "sync" else vm.act("Sync encryption off") { vm.repo.setLocal { it.copy(syncEncrypted = false, syncSecret = "") } } },
                    if (local.syncEncrypted) "Passphrase protected by the Android Keystore" else "Use the same passphrase on every device")
                Text(local.lastSyncAt?.let { "Last sync ${it.replace('T', ' ').take(16)} — ${local.lastSyncResult}" } ?: "Never synced", style = MaterialTheme.typography.bodySmall, color = p.text3)
                Spacer(Modifier.height(6.dp))
                Callout("Each device writes emi-tracker-sync-<device>.json into the folder and merges the files written by your other devices; the newest edit of each record wins and deletions carry over. On Windows, choose the same folder in EMI Tracker → Backup, Sync & Restore. Move the files yourself (USB cable, SD card) or use a folder your own sync tool mirrors. At home, Wi-Fi sync above is simpler.")
            }
        }
        item {
            EmiCard(title = "Export", sub = "Portable formats — unencrypted, keep them private") {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { scope.launch { val (_, text) = vm.backup.buildText("export", null); exportJson("emi-tracker-export.json", text) } }) { Text("Full JSON") }
                    OutlinedButton(onClick = {
                        exportCsv("emi-tracker-loans.csv", com.emitracker.core.Csv.write(listOf(listOf("id", "name", "lender", "category", "type", "status", "principal", "annual_rate", "installments", "emi", "start_date", "first_emi_date", "outstanding_calculated", "closure_projected")) +
                            ui.data.loans.map { l -> val s = ui.comps[l.id]!!.summary; listOf(l.id, l.name, l.lender, l.category, l.loanType, l.status, l.principal, l.annualRate, l.totalInstallments, l.emiAmount ?: s.currentEmi, l.startDate, l.firstEmiDate, s.outstandingPrincipal, s.closureDate ?: "") }))
                    }) { Text("Loans CSV") }
                    OutlinedButton(onClick = {
                        exportCsv("emi-tracker-payments.csv", com.emitracker.core.Csv.write(listOf(listOf("id", "loan", "date", "type", "installment", "amount", "principal", "interest", "fees", "penalty", "reference", "status", "notes")) +
                            ui.data.payments.map { x -> val a = ui.comps[x.loanId]?.allocations?.get(x.id); listOf(x.id, ui.data.loans.firstOrNull { it.id == x.loanId }?.name, x.txnDate, x.type, x.installmentNo, x.amount, a?.principal?.toPlainString(), a?.interest?.toPlainString(), a?.fees?.toPlainString(), a?.penalty?.toPlainString(), x.reference, x.status, x.notes) }))
                    }) { Text("Payments CSV") }
                }
            }
        }
        item {
            EmiCard(title = "Backup history", sub = "Each backup is verified by reading it back and checking its SHA-256") {
                if (history.isEmpty()) Text("No backups yet.", color = p.text3, style = MaterialTheme.typography.bodySmall)
                history.forEach { h ->
                    Column(Modifier.padding(vertical = 4.dp)) {
                        Text("${h.createdAt.replace('T', ' ').take(16)} · ${h.kind}${if (h.encrypted) " · encrypted" else ""}", style = MaterialTheme.typography.bodyMedium, color = p.text)
                        Text("${h.path.takeLast(60)} · ${h.size / 1024} KB · ${if (h.ok) "verified" else h.message}", style = MaterialTheme.typography.bodySmall, color = if (h.ok) p.text3 else p.danger)
                    }
                }
            }
        }
    }

    passFor?.let { which ->
        PassphraseDialog(if (which == "backup") "Encrypted backup" else "Sync passphrase",
            if (which == "backup") "The passphrase is never stored. Without it this backup cannot be restored." else "Stored encrypted with the Android Keystore so background sync can run. Use the same passphrase on your PC.",
            if (which == "backup") "Choose location" else "Turn on encryption",
            onConfirm = { pass ->
                passFor = null
                if (which == "backup") { pendingPass = pass; createEncryptedDoc.launch(vm.backup.fileName("backup", true)) }
                else vm.act("Sync files will be encrypted") { vm.repo.setLocal { it.copy(syncEncrypted = true, syncSecret = SecretBox.seal(pass)) } }
            }, onDismiss = { passFor = null })
    }
    if (confirmRestore) ConfirmDialog("Replace all current data?", "Current loans, payments, reminders and settings will be replaced by the backup. A recovery backup is saved first.", "Restore", danger = true, typeToConfirm = "RESTORE",
        onConfirm = {
            confirmRestore = false
            scope.launch {
                busy = true
                runCatching { vm.backup.restore(restoreText!!, restorePass.ifEmpty { null }) }
                    .onSuccess { r -> vm.info("Restored and verified: ${r.restored["loans"]} loans, ${r.restored["payments"]} payments. Integrity ${r.integrity}"); preview = null; restoreText = null; Background.runSoon(context) }
                    .onFailure { e -> vm.error(if (e is BackupException) e.message ?: "Restore failed" else "Restore failed — your data is unchanged: ${e.message}") }
                busy = false
            }
        }, onDismiss = { confirmRestore = false })
}

// ------------------------------------------------------------------------------------- settings
@Composable
fun SettingsScreen(vm: AppViewModel, nav: NavHostController) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val p = LocalPalette.current
    var prefs by remember(ui.prefs) { mutableStateOf(ui.prefs) }
    var thr by remember(ui.prefs) { mutableStateOf(ui.prefs.heatmapThresholds.joinToString(", ")) }
    var reset by remember { mutableStateOf(false) }
    var cat by remember { mutableStateOf("") }
    val dirty = prefs != ui.prefs || thr != ui.prefs.heatmapThresholds.joinToString(", ")
    val accents = listOf("#4f8cff", "#34c38f", "#a78bfa", "#f1b44c", "#f46a6a", "#22b8cf", "#e879f9", "#94a3b8")
    Screen("Settings", "Preferences sync to your other devices", nav, back = true, actions = {
        TextButton(enabled = dirty, onClick = {
            val t = thr.split(",").mapNotNull { it.trim().toDoubleOrNull()?.let { d -> Math.round(d) } }.filter { it >= 0 }.sorted()
            if (t.size != 4) vm.error("Enter exactly four ascending heatmap thresholds")
            else vm.act("Settings saved") { vm.repo.setPreferences(prefs.copy(heatmapThresholds = t)) }
        }) { Text("Save") }
    }) {
        item { AppLockCard(vm, ui.data.local) }
        item {
            EmiCard(title = "Appearance") {
                Segmented(listOf("dark" to "Dark", "light" to "Light", "system" to "System"), prefs.theme, { prefs = prefs.copy(theme = it) })
                Spacer(Modifier.height(10.dp))
                Text("Accent colour", style = MaterialTheme.typography.labelMedium, color = p.text2)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
                    accents.forEach { a -> Box(Modifier.size(30.dp).clip(RoundedCornerShape(8.dp)).background(parseColor(a)).clickable { prefs = prefs.copy(accent = a) }.padding(if (prefs.accent == a) 8.dp else 0.dp).background(if (prefs.accent == a) androidx.compose.ui.graphics.Color.White.copy(alpha = 0.8f) else androidx.compose.ui.graphics.Color.Transparent, RoundedCornerShape(4.dp))) }
                }
            }
        }
        item {
            EmiCard(title = "Currency & formats", sub = "Preview: ${com.emitracker.app.ui.Fmt(prefs).money("1234567.89")} · ${com.emitracker.app.ui.Fmt(prefs).date("2025-03-09")}") {
                Dropdown("Currency", prefs.currency, listOf("INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD", "JPY").map { it to it }, { prefs = prefs.copy(currency = it) })
                Dropdown("Number grouping", prefs.locale, listOf("en-IN" to "Indian (12,34,567)", "en-US" to "International (1,234,567)", "de-DE" to "European (1.234.567)"), { prefs = prefs.copy(locale = it) })
                Dropdown("Decimal places", prefs.decimals, listOf(2 to "2", 0 to "0", 1 to "1"), { prefs = prefs.copy(decimals = it) }, hint = "Display only — calculations always use paisa precision")
                Dropdown("Date format", prefs.dateFormat, listOf("DD MMM YYYY" to "09 Mar 2025", "DD/MM/YYYY" to "09/03/2025", "MM/DD/YYYY" to "03/09/2025", "YYYY-MM-DD" to "2025-03-09"), { prefs = prefs.copy(dateFormat = it) })
                Dropdown("First day of week", prefs.weekStart, listOf(1 to "Monday", 0 to "Sunday"), { prefs = prefs.copy(weekStart = it) })
                Dropdown("Time zone", prefs.timeZone, listOf("" to "System (${java.time.ZoneId.systemDefault()})", "Asia/Kolkata" to "Asia/Kolkata", "Asia/Dubai" to "Asia/Dubai", "Asia/Singapore" to "Asia/Singapore", "Europe/London" to "Europe/London", "America/New_York" to "America/New_York", "UTC" to "UTC"), { prefs = prefs.copy(timeZone = it) }, hint = "Decides what “today” is for due dates and reminders")
            }
        }
        item {
            EmiCard(title = "Heatmaps") {
                Segmented(HEAT_PALETTES.keys.map { it to it.replaceFirstChar(Char::uppercase) }, prefs.heatmapPalette, { prefs = prefs.copy(heatmapPalette = it) })
                Spacer(Modifier.height(8.dp))
                Field("Intensity thresholds (daily amount)", thr, { thr = it }, hint = "Four ascending amounts, e.g. 0, 5000, 25000, 75000. Monthly views scale ×4.")
            }
        }
        item {
            EmiCard(title = "Dashboard & lists") {
                Dropdown("Default dashboard range", prefs.dashboardRange, listOf("3m" to "Last 3 months", "6m" to "Last 6 months", "12m" to "Last 12 months", "ytd" to "Year to date", "all" to "All time"), { prefs = prefs.copy(dashboardRange = it) })
                Dropdown("Default loan sorting", prefs.loanSort, listOf("next_due" to "Next due date", "outstanding" to "Outstanding", "closure" to "Closure date", "rate" to "Interest rate", "name" to "Name"), { prefs = prefs.copy(loanSort = it) })
                Dropdown("Default loan filter", prefs.loanFilter, listOf("active" to "Active", "closed" to "Closed", "archived" to "Archived", "all" to "All"), { prefs = prefs.copy(loanFilter = it) })
                Text("Arrange dashboard widgets with the tune button on the Dashboard.", style = MaterialTheme.typography.bodySmall, color = p.text3)
            }
        }
        item {
            EmiCard(title = "Categories") {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    ui.data.categories.forEach { c -> TextButton(onClick = { vm.act("Category removed") { vm.repo.deleteCategory(c.id) } }) { Text("${c.name} ✕") } }
                    if (ui.data.categories.isEmpty()) Text("No custom categories.", color = p.text3, style = MaterialTheme.typography.bodySmall)
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Field("New category", cat, { cat = it.take(60) }, Modifier.weight(1f))
                    TextButton(enabled = cat.isNotBlank(), onClick = { val ts = Defaults.ts(); vm.act("Category added") { vm.repo.saveCategory(com.emitracker.core.Category(Defaults.id(), ts, ts, cat.trim(), prefs.accent)) }; cat = "" }) { Text("Add") }
                }
            }
        }
        item {
            EmiCard(title = "Privacy & storage") {
                Callout("No accounts, analytics, ads, crash reporting or update checks, and no cloud. The only network use is optional Wi-Fi sync with your own PC, limited to your home network. Android cloud backup is disabled for its data.", CalloutKind.Ok)
                KvRow("Database", "App-private storage")
                KvRow("Reminders & backups", "Reminders, Backup & sync screens")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { OutlinedButton(onClick = { nav.navigate("backup") }) { Text("Backup & export") }; OutlinedButton(onClick = { nav.navigate("help") }) { Text("Diagnostics") } }
            }
        }
        item {
            EmiCard(title = "About") {
                Text("EMI Tracker v${BuildConfig.VERSION_NAME} for Android. No online update checker — install newer APKs yourself; data is kept across updates.", style = MaterialTheme.typography.bodySmall, color = p.text2)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                    OutlinedButton(onClick = { vm.act("Demo loans added") { DemoData.load(vm.repo, ui.asOf) } }) { Text("Add demo loans") }
                    OutlinedButton(onClick = { reset = true }) { Text("Erase all data…", color = p.danger) }
                }
            }
        }
    }
    if (reset) ConfirmDialog("Erase all loan data?", "Removes every loan, payment, reminder and notification on this phone. A recovery backup is saved in the app first. If sync is on, data returns from your other devices on the next sync.",
        "Erase everything", danger = true, typeToConfirm = "DELETE ALL DATA", onConfirm = {
            reset = false
            vm.act("All data erased — a recovery backup was saved") {
                vm.backup.backupToFolder(FileFolder(vm.backup.recoveryDir), kind = "recovery", label = "before-reset")
                vm.repo.replaceAll(com.emitracker.core.SnapshotData(preferences = vm.repo.preferences()))
                vm.repo.addAuditEntry("system", null, "reset", "All loan data was erased by the user")
            }
        }, onDismiss = { reset = false })
}

// ------------------------------------------------------------------------------------- help & diagnostics
@Composable
fun HelpScreen(vm: AppViewModel, nav: NavHostController) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val p = LocalPalette.current
    val context = LocalContext.current
    var integrity by remember { mutableStateOf<Pair<Boolean, String>?>(null) }
    LaunchedEffect(ui) { integrity = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { vm.repo.integrity() } }
    val perms = remember { context.packageManager.getPackageInfo(context.packageName, android.content.pm.PackageManager.GET_PERMISSIONS).requestedPermissions?.toList() ?: emptyList() }
    var tab by rememberSaveable { mutableStateOf("guide") }
    val audit = if (tab == "audit") rememberAudit(vm) else emptyList()
    Screen("Help & diagnostics", nav = nav, back = true) {
        item { Segmented(listOf("guide" to "Guide", "diagnostics" to "Diagnostics", "audit" to "Audit log"), tab, { tab = it }) }
        when (tab) {
            "guide" -> {
                item {
                    EmiCard(title = "Getting started") {
                        listOf("Add each loan with the wizard (Loans → +). Enter the EMI from your statement for exact figures.",
                            "If EMIs were paid before you started tracking, mark them “paid before tracking” — they show as estimates.",
                            "Record each payment (+ on the dashboard). Use the lender's principal/interest split when you have it.",
                            "Enter the lender's outstanding balance now and then to reconcile.",
                            "Turn on reminders, back up regularly, and optionally sync with the Windows app.").forEachIndexed { i, s -> Text("${i + 1}. $s", style = MaterialTheme.typography.bodyMedium, color = p.text2, modifier = Modifier.padding(vertical = 3.dp)) }
                    }
                }
                item {
                    EmiCard(title = "How figures are calculated") {
                        listOf("Outstanding principal comes from your recorded payments — never copied from the lender.",
                            "Total paid = principal + interest + fees & penalties + any unapplied excess (upfront fees and pre-EMI interest included).",
                            "Future cash outflow = remaining EMIs (final EMI adjusted) + overdue amounts + estimated charges. It exceeds outstanding principal because it includes future interest.",
                            "Closure dates run the amortization forward from the actual balance — not balance ÷ EMI.",
                            "Money uses decimal arithmetic (40 digits) rounded half-up to the paisa when posted.",
                            "“Estimate” = assumed or incomplete data. “Projected” = future or hypothetical.").forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium, color = p.text2, modifier = Modifier.padding(vertical = 3.dp)) }
                    }
                }
                item { EmiCard(title = "Accessibility") { Text("All controls have labels for TalkBack, heatmap cells are individually readable, and text follows your system font size.", style = MaterialTheme.typography.bodyMedium, color = p.text2) } }
            }
            "diagnostics" -> {
                item {
                    EmiCard(title = "Database") {
                        KvRow("Integrity check", integrity?.let { if (it.first) "OK" else "Problem" } ?: "Checking…", integrity?.let { if (it.first) p.positive else p.danger })
                        integrity?.let { Text(it.second, style = MaterialTheme.typography.bodySmall, color = p.text3) }
                        KvRow("Schema version", "${com.emitracker.core.SCHEMA_VERSION}")
                        KvRow("Loans / payments", "${ui.data.loans.size} / ${ui.data.payments.size}")
                        KvRow("Database size", "${context.getDatabasePath(com.emitracker.app.data.AppDatabase.NAME).length() / 1024} KB")
                    }
                }
                item {
                    EmiCard(title = "Offline & privacy") {
                        KvRow("Internet permission", if ("android.permission.INTERNET" in perms) "PRESENT" else "Not requested", if ("android.permission.INTERNET" in perms) p.danger else p.positive)
                        Text("Declared permissions: " + perms.joinToString { it.substringAfterLast('.') }, style = MaterialTheme.typography.bodySmall, color = p.text3)
                        KvRow("Android cloud backup", "Disabled for app data")
                    }
                }
                item {
                    EmiCard(title = "Financial consistency", sub = "Total paid = principal + interest + fees + unapplied") {
                        ui.data.loans.forEach { l ->
                            val s = ui.comps[l.id]!!.summary
                            val ok = com.emitracker.core.Money.money(s.principalRepaid.toBigDecimal() + s.interestPaid.toBigDecimal() + s.feesPaid.toBigDecimal() + s.penaltiesPaid.toBigDecimal() + s.unapplied.toBigDecimal()) == s.totalPaid
                            KvRow(l.name, if (ok) "OK" else "Mismatch", if (ok) p.positive else p.danger)
                        }
                        if (ui.data.loans.isEmpty()) Text("No loans.", color = p.text3)
                    }
                }
            }
            "audit" -> auditItems(vm, null, audit)
        }
    }
}
