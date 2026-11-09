package com.emitracker.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Wifi
import androidx.compose.material3.Icon
import androidx.compose.ui.Alignment
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.emitracker.app.data.LocalSettings
import com.emitracker.app.ui.AppViewModel
import com.emitracker.app.ui.LocalPalette
import com.emitracker.app.ui.components.Callout
import com.emitracker.app.ui.components.EmiCard
import com.emitracker.app.ui.components.Field
import com.emitracker.app.ui.components.SwitchRow
import com.emitracker.app.work.Background
import kotlinx.coroutines.launch

/** Pair with the Windows app once (address + 6-digit code), then sync over the home Wi-Fi. */
@Composable
fun WifiSyncCard(vm: AppViewModel, local: LocalSettings) {
    val p = LocalPalette.current
    val scope = rememberCoroutineScope()
    var address by remember(local.lanHost) { mutableStateOf(local.lanHost) }
    var code by remember { mutableStateOf("") }
    var editing by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val paired = local.lanKey.isNotBlank()
    val syncing by vm.syncing.collectAsStateWithLifecycle()

    EmiCard(title = "Wi-Fi sync with your PC", sub = "Direct and encrypted, when this phone and your PC are on the same Wi-Fi") {
        if (!paired || editing) {
            Text("On the PC open EMI Tracker → Backup, Sync & Restore → Wi-Fi sync, turn it on and click “Pair a phone”. Then enter the address and code shown there.",
                style = MaterialTheme.typography.bodySmall, color = p.text2)
            Spacer(Modifier.height(8.dp))
            Field("PC address", address, { address = it.trim() }, hint = "For example 192.168.1.10", keyboard = KeyboardType.Uri)
            Field("Pairing code", code, { v -> code = v.filter(Char::isDigit).take(6) }, keyboard = KeyboardType.NumberPassword)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                Button(enabled = !busy && address.isNotBlank() && code.length == 6, onClick = {
                    scope.launch {
                        busy = true
                        runCatching { vm.lan.pair(address, code) }
                            .onSuccess { name -> code = ""; editing = false; vm.info("Paired with $name"); runCatching { Background.exclusive { vm.lan.sync() } }.onSuccess { vm.info("Synced with $name") } }
                            .onFailure { vm.error("Pairing failed: ${it.message}") }
                        busy = false
                    }
                }) { Text(if (busy) "Pairing…" else "Pair with PC") }
                if (editing) TextButton(onClick = { editing = false; address = local.lanHost }) { Text("Cancel") }
            }
        } else {
            Text("Paired with ${local.lanPcName} at ${local.lanHost}", style = MaterialTheme.typography.titleSmall, color = p.text)
            SwitchRow("Sync automatically", local.lanAuto, { v -> vm.act { vm.repo.setLocal { it.copy(lanAuto = v) } } },
                "When you open the app, after changes, and about every 15 minutes in the background on the same Wi-Fi")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 4.dp)) {
                Button(enabled = !syncing, onClick = { vm.syncNow() }) { Text(if (syncing) "Syncing…" else "Sync now") }
                OutlinedButton(onClick = { editing = true }) { Text("Pair again") }
            }
            Text(local.lastLanSyncAt?.let { "Last sync ${localTime(it)} — ${local.lastLanSyncResult}" } ?: "Not synced yet",
                style = MaterialTheme.typography.bodySmall, color = if (local.lastLanSyncResult.startsWith("Failed")) p.warning else p.text3)
            TextButton(onClick = { vm.act("Unpaired from ${local.lanPcName}") { vm.lan.unpair() } }) { Text("Unpair", color = p.danger) }
        }
        Spacer(Modifier.height(4.dp))
        Callout("Only connects to addresses on your home network, never the internet. Each record's newest edit wins and deletions carry over — the same as folder sync.")
    }
}

/** Dashboard: Wi-Fi sync status with a Sync now button (or Set up when no PC is paired). */
@Composable
fun SyncNowCard(vm: AppViewModel, local: LocalSettings, onSetUp: () -> Unit) {
    val p = LocalPalette.current
    val syncing by vm.syncing.collectAsStateWithLifecycle()
    val paired = local.lanKey.isNotBlank()
    EmiCard(padding = 12.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Wifi, null, tint = p.accent)
            Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                Text(if (paired) "Wi-Fi sync · ${local.lanPcName}" else "Wi-Fi sync with your PC", style = MaterialTheme.typography.titleSmall, color = p.text)
                Text(when {
                    !paired -> "Not set up"
                    syncing -> "Syncing…"
                    else -> local.lastLanSyncAt?.let { "Last ${localTime(it)}${if (local.lastLanSyncResult.startsWith("Failed")) " — failed" else ""}" } ?: "Not synced yet"
                }, style = MaterialTheme.typography.bodySmall, color = if (paired && local.lastLanSyncResult.startsWith("Failed")) p.warning else p.text3)
            }
            Spacer(Modifier.width(4.dp))
            if (paired) Button(enabled = !syncing, onClick = { vm.syncNow() }) { Text(if (syncing) "Syncing…" else "Sync now") }
            else OutlinedButton(onClick = onSetUp) { Text("Set up") }
        }
    }
}

private fun localTime(instant: String): String = runCatching {
    java.time.Instant.parse(instant).atZone(java.time.ZoneId.systemDefault()).format(java.time.format.DateTimeFormatter.ofPattern("d MMM, HH:mm"))
}.getOrDefault(instant)
