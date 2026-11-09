package com.emitracker.app.ui.screens

import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import com.emitracker.app.data.LocalSettings
import com.emitracker.app.security.AppLock
import com.emitracker.app.ui.AppViewModel
import com.emitracker.app.ui.LocalPalette
import com.emitracker.app.ui.components.Callout
import com.emitracker.app.ui.components.CalloutKind
import com.emitracker.app.ui.components.Dropdown
import com.emitracker.app.ui.components.EmiCard
import com.emitracker.app.ui.components.Field
import com.emitracker.app.ui.components.SwitchRow

/** Settings → App lock: method, PIN / password, fingerprint, auto-lock delay. */
@Composable
fun AppLockCard(vm: AppViewModel, local: LocalSettings) {
    val p = LocalPalette.current
    val context = LocalContext.current
    val activity = LocalActivity.current as? FragmentActivity
    val canBio = remember { AppLock.canAuthenticate(context, allowDevice = false) }
    val canDevice = remember { AppLock.canAuthenticate(context, allowDevice = true) }
    var method by remember(local.lockMethod) { mutableStateOf(local.lockMethod) }
    var secret by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var current by remember { mutableStateOf("") }
    var bio by remember(local.lockBiometric) { mutableStateOf(local.lockBiometric) }
    var after by remember(local.lockAfterMinutes) { mutableStateOf(local.lockAfterMinutes) }
    var error by remember { mutableStateOf<String?>(null) }
    val isSecret = method == "pin" || method == "password"
    val curIsSecret = local.lockMethod == "pin" || local.lockMethod == "password"
    val needsCurrent = curIsSecret && (method != local.lockMethod || secret.isNotEmpty() || bio != local.lockBiometric)
    val word = if (method == "pin") "PIN" else "password"

    fun commit() {
        val newSecret = secret
        vm.act(if (method == "none") "App lock turned off" else "App lock saved", onDone = { secret = ""; confirm = ""; current = "" }) {
            // runs off the main thread: PBKDF2 takes a moment
            val salt = if (isSecret && newSecret.isNotEmpty()) AppLock.newSalt() else local.lockSalt
            val hash = if (isSecret && newSecret.isNotEmpty()) AppLock.hash(newSecret, salt) else if (isSecret) local.lockHash else ""
            vm.repo.setLocal { it.copy(lockMethod = method, lockHash = hash, lockSalt = if (isSecret) salt else "", lockBiometric = isSecret && bio, lockAfterMinutes = after, lockFailed = 0, lockoutUntil = 0) }
        }
    }
    fun save() {
        error = null
        if (isSecret && (secret.isNotEmpty() || method != local.lockMethod)) {
            if (method == "pin" && !Regex("^\\d{4,12}$").matches(secret)) { error = "PIN must be 4 to 12 digits"; return }
            if (method == "password" && secret.length < 6) { error = "Password must be at least 6 characters"; return }
            if (secret != confirm) { error = "The two ${word}s do not match"; return }
        }
        if (needsCurrent && !AppLock.matches(local, current)) { error = "Current ${if (local.lockMethod == "pin") "PIN" else "password"} is wrong"; return }
        val changingDevice = local.lockMethod == "device" && (method != "device")
        if (changingDevice && activity != null) AppLock.prompt(activity, "Confirm to change the app lock", true) { ok, err -> if (ok) commit() else error = err ?: "Not confirmed" }
        else commit()
    }

    EmiCard(title = "App lock", sub = "Ask for a PIN, password, fingerprint or face before showing your loans") {
        Dropdown("Lock with", method, buildList {
            add("none" to "Off")
            if (canDevice || local.lockMethod == "device") add("device" to "Phone screen lock & fingerprint / face")
            add("pin" to "App PIN (4–12 digits)"); add("password" to "App password")
        }, { method = it; secret = ""; confirm = "" })
        if (isSecret) {
            val kb = if (method == "pin") KeyboardType.NumberPassword else KeyboardType.Password
            Field(if (method == local.lockMethod) "New $word (leave empty to keep)" else word.replaceFirstChar(Char::uppercase), secret,
                { secret = if (method == "pin") it.filter(Char::isDigit).take(12) else it }, keyboard = kb, password = true)
            Field("Repeat it", confirm, { confirm = if (method == "pin") it.filter(Char::isDigit).take(12) else it }, keyboard = kb, password = true)
            if (canBio) SwitchRow("Also unlock with fingerprint / face", bio, { bio = it })
        }
        if (method != "none") Dropdown("Lock again", after, listOf(0 to "As soon as you leave the app", 1 to "After 1 minute", 5 to "After 5 minutes", 15 to "After 15 minutes", 60 to "After 1 hour"), { after = it })
        if (needsCurrent) Field("Current ${if (local.lockMethod == "pin") "PIN" else "password"}", current, { current = it }, keyboard = if (local.lockMethod == "pin") KeyboardType.NumberPassword else KeyboardType.Password, password = true,
            hint = "Needed to change or turn off the lock")
        error?.let { Callout(it, CalloutKind.Danger) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
            Button(onClick = { save() }) { Text("Save app lock") }
            if (local.lockMethod != "none") OutlinedButton(onClick = { AppLock.lockNow(local) }) { Text("Lock now") }
        }
        Spacer(Modifier.height(4.dp))
        Text("Set on this phone only; your PC has its own lock. ${if (canDevice) "If you forget the app PIN or password, the phone's screen lock lets you back in." else "Keep your PIN or password safe."} When the lock is on, the app is hidden in the recent-apps screen.",
            style = MaterialTheme.typography.bodySmall, color = p.text3)
    }
}
