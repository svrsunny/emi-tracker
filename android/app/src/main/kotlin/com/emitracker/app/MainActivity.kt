package com.emitracker.app

import android.os.Bundle
import android.view.WindowManager
import androidx.fragment.app.FragmentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.emitracker.app.ui.AppRoot
import com.emitracker.app.ui.AppViewModel
import com.emitracker.app.ui.EmiTheme

/** A FragmentActivity so the fingerprint / face prompt of the app lock can attach to it. */
class MainActivity : FragmentActivity() {
    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val deepLink = intent?.data?.let { "${it.host}${it.path ?: ""}" }
        setContent {
            val ui by vm.ui.collectAsStateWithLifecycle()
            val dark = when (ui.prefs.theme) { "light" -> false; "dark" -> true; else -> isSystemInDarkTheme() }
            // status / navigation bar icons follow the app theme, not the system theme
            DisposableEffect(dark) {
                val style = if (dark) SystemBarStyle.dark(android.graphics.Color.TRANSPARENT) else SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT)
                enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
                onDispose {}
            }
            // with the app lock on, hide the app's content from the recent-apps screen and screenshots
            val secure = ui.data.local.lockMethod != "none"
            DisposableEffect(secure) {
                if (secure) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE) else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                onDispose {}
            }
            EmiTheme(ui.prefs.theme, ui.prefs.accent) { AppRoot(vm, deepLink) }
        }
    }

    /** Opening the app is a good moment to sync with the PC and re-plan reminders. */
    override fun onStart() {
        super.onStart()
        com.emitracker.app.security.AppLock.cameToForeground(vm.ui.value.data.local)
        if (vm.ui.value.data.local.lanKey.isNotBlank()) com.emitracker.app.work.Background.runSoon(this)
        vm.watchPc(true)
    }

    /** Every file / folder picker starts here (Activity Result API); returning from one does not re-lock the app. */
    @Deprecated("Activity Result API entry point")
    override fun startActivityForResult(intent: android.content.Intent, requestCode: Int, options: Bundle?) {
        com.emitracker.app.security.AppLock.openingSystemPicker()
        @Suppress("DEPRECATION") super.startActivityForResult(intent, requestCode, options)
    }

    override fun onStop() {
        super.onStop()
        vm.watchPc(false)
        if (!isChangingConfigurations) com.emitracker.app.security.AppLock.wentToBackground()
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.data?.let { vm.pendingRoute.value = "${it.host}${it.path ?: ""}" }
    }
}
