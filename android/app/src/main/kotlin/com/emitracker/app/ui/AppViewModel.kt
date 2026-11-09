package com.emitracker.app.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.emitracker.app.EmiApp
import com.emitracker.app.data.AppData
import com.emitracker.app.data.DuplicateException
import com.emitracker.app.work.Background
import com.emitracker.app.work.zone
import com.emitracker.core.Engine
import com.emitracker.core.LoanComputation
import com.emitracker.core.Preferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate

/** UI state: records plus engine output derived from the very same records. */
data class UiState(
    val data: AppData = AppData(),
    val comps: Map<String, LoanComputation> = emptyMap(),
    val asOf: String = LocalDate.now().toString(),
    val fmt: Fmt = Fmt(Preferences()),
) {
    val prefs get() = data.preferences
    val inbox get() = data.notifications.filter { it.state == "sent" }
}

sealed interface Msg {
    data class Info(val text: String) : Msg
    data class Error(val text: String) : Msg
}

class AppViewModel(application: Application) : AndroidViewModel(application) {
    private val app = application as EmiApp
    val repo = app.repo
    val backup = app.backup
    val lan = app.lan
    val messages = MutableSharedFlow<Msg>(extraBufferCapacity = 8)
    /** Route requested by a notification tap while the activity is running. */
    val pendingRoute = MutableStateFlow<String?>(null)
    private val today = MutableStateFlow(LocalDate.now().toString())

    val ui: StateFlow<UiState> = combine(repo.state, today) { data, _ ->
        val asOf = LocalDate.now(zone(data.preferences.timeZone)).toString()
        UiState(data, data.loans.associate { it.id to Engine.compute(it, data.adjustments, data.payments, asOf) }, asOf, Fmt(data.preferences))
    }.flowOn(Dispatchers.Default).stateIn(viewModelScope, SharingStarted.Eagerly, UiState())

    val ready: StateFlow<Boolean> = repo.state.map { it.loaded }.stateIn(viewModelScope, SharingStarted.Eagerly, false)

    init {
        // the app lock starts from the saved settings, once per process
        viewModelScope.launch { repo.state.first { it.loaded }.let { com.emitracker.app.security.AppLock.init(it.local) } }
        viewModelScope.launch {
            while (true) { delay(60_000); today.value = LocalDate.now().toString() + System.currentTimeMillis() / 3_600_000 }
        }
    }

    /** Run a write; reports success/failure through [messages]; re-plans reminders afterwards. */
    fun act(success: String? = null, onDuplicate: ((String) -> Unit)? = null, onDone: (() -> Unit)? = null, block: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) { block() } // Room work never runs on the main thread
                success?.let { messages.emit(Msg.Info(it)) }
                Background.runSoon(getApplication())
                onDone?.invoke()
            } catch (e: DuplicateException) {
                if (onDuplicate != null) onDuplicate(e.message ?: "Possible duplicate") else messages.emit(Msg.Error(e.message ?: "Duplicate"))
            } catch (e: Exception) {
                messages.emit(Msg.Error(e.message ?: "Something went wrong"))
            }
        }
    }

    private val _syncing = MutableStateFlow(false)
    /** A Wi-Fi sync started from the app (dashboard or settings) is running. */
    val syncing: StateFlow<Boolean> = _syncing

    /** Wi-Fi sync with the paired PC now; [quiet] skips the error message (used for the PC's own request). */
    fun syncNow(quiet: Boolean = false) {
        if (_syncing.value) return
        _syncing.value = true
        viewModelScope.launch {
            val pc = ui.value.data.local.lanPcName.ifBlank { "your PC" }
            runCatching { Background.exclusive { lan.sync() } }
                .onSuccess { r -> info("Synced with $pc: +${r.added} new · ${r.updated} updated · ${r.deleted} removed") }
                .onFailure { if (!quiet) error("Wi-Fi sync failed: ${it.message}") }
            _syncing.value = false
        }
    }

    private var pcWatch: Job? = null
    /** While the app is on screen, "Sync now" on the PC reaches this phone within a few seconds. */
    fun watchPc(on: Boolean) {
        pcWatch?.cancel()
        pcWatch = if (!on) null else viewModelScope.launch {
            while (true) {
                delay(5_000)
                if (ui.value.data.local.lanKey.isNotBlank() && !_syncing.value && lan.pcAskedToSync()) syncNow(quiet = true)
            }
        }
    }

    fun info(text: String) { messages.tryEmit(Msg.Info(text)) }
    fun error(text: String) { messages.tryEmit(Msg.Error(text)) }
}
