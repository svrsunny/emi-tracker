package com.emitracker.app.work

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.emitracker.app.EmiApp
import com.emitracker.app.MainActivity
import com.emitracker.app.R
import com.emitracker.app.data.Repository
import com.emitracker.app.io.BackupService
import com.emitracker.app.io.LanSync
import com.emitracker.app.io.SafFolder
import com.emitracker.app.io.SecretBox
import com.emitracker.app.ui.Fmt
import com.emitracker.core.Engine
import com.emitracker.core.HistoryItem
import com.emitracker.core.NotificationRecord
import com.emitracker.core.PlannedReminder
import com.emitracker.core.PlannerInput
import com.emitracker.core.Reminders
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Notification channels. On Android 8+ the user controls sound, vibration and importance per
 * channel in system settings; the app respects those choices.
 */
object Notifier {
    const val CH_EMI = "emi"
    const val CH_OVERDUE = "overdue"
    const val CH_SUMMARY = "summary"
    const val CH_BACKUP = "backup"
    const val CH_CUSTOM = "custom"

    fun createChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannels(listOf(
            NotificationChannel(CH_EMI, "EMI reminders", NotificationManager.IMPORTANCE_HIGH).apply { description = "Upcoming and due EMIs" },
            NotificationChannel(CH_OVERDUE, "Overdue & missed EMIs", NotificationManager.IMPORTANCE_HIGH).apply { description = "Repeats until you record the payment" },
            NotificationChannel(CH_SUMMARY, "Summaries & loan events", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "Weekly/monthly summaries, closures and rate changes" },
            NotificationChannel(CH_BACKUP, "Backup reminders", NotificationManager.IMPORTANCE_LOW),
            NotificationChannel(CH_CUSTOM, "Custom reminders", NotificationManager.IMPORTANCE_DEFAULT),
        ))
    }

    fun channelFor(category: String) = when (category) {
        "emi_upcoming", "emi_due" -> CH_EMI
        "emi_overdue", "emi_missed" -> CH_OVERDUE
        "backup" -> CH_BACKUP
        "custom" -> CH_CUSTOM
        else -> CH_SUMMARY
    }

    /** True only when Android will actually show notifications from this app. */
    fun canPost(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    fun channelEnabled(context: Context, channel: String): Boolean =
        context.getSystemService(NotificationManager::class.java).getNotificationChannel(channel)?.importance != NotificationManager.IMPORTANCE_NONE

    /** Posts a notification; returns false if the OS would not show it. */
    fun post(context: Context, r: PlannedReminder, recordId: String, silent: Boolean, priority: String): Boolean {
        val channel = channelFor(r.category)
        if (!canPost(context) || !channelEnabled(context, channel)) return false
        val open = PendingIntent.getActivity(context, recordId.hashCode(),
            Intent(context, MainActivity::class.java).setData(Uri.parse("emitracker://${if (r.loanId != null) "loan/${r.loanId}" else "reminders"}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        fun action(act: String) = PendingIntent.getBroadcast(context, (recordId + act).hashCode(),
            Intent(context, NotificationActionReceiver::class.java).setAction(act).putExtra("id", recordId), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_emi)
            .setContentTitle(r.title)
            .setContentText(r.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(r.body + if (r.late) "\n(Delivered late — the phone was off, asleep or the app was restricted.)" else ""))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setSilent(silent)
            .setPriority(when (priority) { "high" -> NotificationCompat.PRIORITY_HIGH; "low" -> NotificationCompat.PRIORITY_LOW; else -> NotificationCompat.PRIORITY_DEFAULT })
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .addAction(0, "Snooze", action(NotificationActionReceiver.SNOOZE))
            .addAction(0, "Dismiss", action(NotificationActionReceiver.DISMISS))
            .build()
        return try { NotificationManagerCompat.from(context).notify(recordId.hashCode(), n); true } catch (_: SecurityException) { false }
    }
}

/** Snooze / dismiss from the notification shade. Never marks an EMI as paid. */
class NotificationActionReceiver : BroadcastReceiver() {
    companion object { const val SNOOZE = "com.emitracker.SNOOZE"; const val DISMISS = "com.emitracker.DISMISS" }

    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra("id") ?: return
        val pending = goAsync()
        Thread {
            runBlocking {
                val repo = (context.applicationContext as EmiApp).repo
                val n = repo.notifications().firstOrNull { it.id == id }
                if (n != null) {
                    val prefs = repo.preferences().value
                    val now = Reminders.wallTime(LocalDateTime.now(zone(prefs.timeZone)))
                    repo.saveNotification(if (intent.action == SNOOZE) n.copy(state = "snoozed", snoozedUntil = Reminders.addMinutes(now, prefs.reminders.snoozeMinutes.toLong())) else n.copy(state = "dismissed"))
                }
                NotificationManagerCompat.from(context).cancel(id.hashCode())
                if (intent.action == SNOOZE) Background.runSoon(context, delayMinutes = (repo.preferences().value.reminders.snoozeMinutes).toLong())
            }
            pending.finish()
        }.start()
    }
}

fun zone(tz: String): ZoneId = if (tz.isBlank()) ZoneId.systemDefault() else runCatching { ZoneId.of(tz) }.getOrDefault(ZoneId.systemDefault())

/**
 * The single background job: reminders, automatic backup, folder sync and Wi-Fi sync. WorkManager keeps
 * it scheduled across reboots and app updates; Android may defer it (Doze, battery saver), so
 * reminders are never promised to the minute — missed ones are delivered late and flagged.
 */
class BackgroundWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as EmiApp
        Background.tick(applicationContext, app.repo, app.backup, app.lan)
        return Result.success()
    }
}

object Background {
    private const val PERIODIC = "emi-background"
    private const val ONCE = "emi-background-now"

    fun schedule(context: Context) {
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<BackgroundWorker>(15, TimeUnit.MINUTES).build())
    }

    /** Re-plan soon (after data changes, snoozes, or at app start). */
    fun runSoon(context: Context, delayMinutes: Long = 0) {
        WorkManager.getInstance(context).enqueueUniqueWork(ONCE, ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<BackgroundWorker>().setInitialDelay(delayMinutes, TimeUnit.MINUTES).build())
    }

    var lastTick: String? = null
        private set
    var lastDelivered: Int = 0
        private set

    /** Ticks never overlap (app start, the periodic job and "run soon" can fire together), so a reminder is delivered once. */
    private val tickLock = Mutex()

    suspend fun tick(context: Context, repo: Repository, backup: BackupService, lan: LanSync? = null): Int = tickLock.withLock { tickLocked(context, repo, backup, lan) }

    /** Runs a sync started from the UI so it never interleaves with a tick (a merge must not drop a reminder record written meanwhile). */
    suspend fun <T> exclusive(block: suspend () -> T): T = tickLock.withLock { block() }

    private suspend fun tickLocked(context: Context, repo: Repository, backup: BackupService, lan: LanSync?): Int {
        val prefs = repo.preferences().value
        val local = repo.local()
        val wall = Reminders.wallTime(LocalDateTime.now(zone(prefs.timeZone)))
        val asOf = wall.substring(0, 10)
        val fmt = Fmt(prefs)
        val loans = repo.loans(); val adjustments = repo.adjustments(); val payments = repo.payments()
        val comps = loans.associate { it.id to Engine.compute(it, adjustments, payments, asOf, skipBaseline = true) }
        val due = Reminders.due(PlannerInput(wall, prefs.reminders, loans, comps, adjustments, repo.reminders(),
            repo.notifications(20_000).map { HistoryItem(it.key, it.state, it.snoozedUntil) }, local.lastBackupAt?.substring(0, 10), fmt::money, fmt::date, repo.bills(), repo.billPayments(), repo.debts(), repo.debtRepayments()))
        var delivered = 0
        for (r in due) {
            val existing = repo.notificationByKey(r.key)
            val id = existing?.id ?: UUID.randomUUID().toString()
            val shown = prefs.reminders.channels.native && Notifier.post(context, r, id, !prefs.reminders.sound, prefs.reminders.priority)
            val ts = Instant.now().toString()
            repo.saveNotification(NotificationRecord(id, existing?.createdAt ?: ts, ts, r.key, r.category, r.title, r.body, r.loanId, r.at, wall, "sent", null,
                if (shown) "native" else "in_app", r.late, local.deviceId))
            delivered++
        }
        lastTick = wall
        lastDelivered += delivered

        // automatic backup into the user's chosen folder
        if (local.autoBackup && local.backupTreeUri.isNotBlank() && loans.isNotEmpty() &&
            (local.lastBackupAt == null || Instant.parse(local.lastBackupAt).plusSeconds(local.autoBackupHours * 3600L).isBefore(Instant.now()))) {
            runCatching {
                val folder = SafFolder(context, Uri.parse(local.backupTreeUri))
                backup.backupToFolder(folder, kind = "backup", label = "auto")
                backup.pruneAuto(folder, local.backupKeep)
            }
        }
        // automatic sync
        if (local.syncEnabled && local.syncTreeUri.isNotBlank() &&
            (local.lastSyncAt == null || Instant.parse(local.lastSyncAt).plusSeconds(local.syncIntervalMinutes * 60L).isBefore(Instant.now()))) {
            val pass = if (local.syncEncrypted) SecretBox.open(local.syncSecret) else null
            runCatching {
                if (local.syncEncrypted && pass == null) error("Sync passphrase is not set")
                backup.syncNow(SafFolder(context, Uri.parse(local.syncTreeUri)), pass)
            }.onFailure { e -> repo.setLocal { it.copy(lastSyncAt = Instant.now().toString(), lastSyncResult = "Failed: ${e.message}") } }
        }
        // Wi-Fi sync with the paired PC (quietly skipped when the PC is not reachable, e.g. away from home)
        if (lan != null && local.lanKey.isNotBlank() && local.lanAuto) runCatching { lan.sync() }
        repo.refresh()
        return delivered
    }
}
