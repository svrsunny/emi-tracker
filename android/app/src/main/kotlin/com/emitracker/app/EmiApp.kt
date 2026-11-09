package com.emitracker.app

import android.app.Application
import android.os.Build
import com.emitracker.app.data.AppDatabase
import com.emitracker.app.data.Repository
import com.emitracker.app.io.BackupService
import com.emitracker.app.io.LanSync
import com.emitracker.app.work.Background
import com.emitracker.app.work.Notifier
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.util.UUID

open class EmiApp : Application() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    lateinit var repo: Repository
        private set
    lateinit var backup: BackupService
        private set
    lateinit var lan: LanSync
        private set

    override fun onCreate() {
        super.onCreate()
        repo = Repository(AppDatabase.build(this))
        backup = BackupService(this, repo)
        lan = LanSync(repo, backup)
        Notifier.createChannels(this)
        scope.launch {
            if (repo.local().deviceId.isBlank()) {
                repo.setLocal { it.copy(deviceId = UUID.randomUUID().toString(), deviceName = "${Build.MANUFACTURER} ${Build.MODEL} (Android)".trim()) }
            }
            repo.refresh()
        }
        startBackground()
    }

    /** Schedules the periodic WorkManager job; tests substitute the test WorkManager. */
    protected open fun startBackground() {
        Background.schedule(this)
        Background.runSoon(this)
    }
}
