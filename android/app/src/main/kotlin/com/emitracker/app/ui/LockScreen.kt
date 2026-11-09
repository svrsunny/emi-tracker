package com.emitracker.app.ui

import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Backspace
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity
import com.emitracker.app.data.LocalSettings
import com.emitracker.app.security.AppLock
import kotlinx.coroutines.launch

/** Shown instead of the app while it is locked. */
@Composable
fun LockScreen(vm: AppViewModel, local: LocalSettings) {
    val p = LocalPalette.current
    val activity = LocalActivity.current as? FragmentActivity
    val scope = rememberCoroutineScope()
    var secret by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val pin = local.lockMethod == "pin"
    val biometric = local.lockMethod == "device" || local.lockBiometric
    val context = LocalContext.current
    val canDevice = remember { AppLock.canAuthenticate(context, allowDevice = true) }

    fun prompt(allowDevice: Boolean) {
        activity ?: return
        AppLock.prompt(activity, "Unlock EMI Tracker", allowDevice) { ok, err -> if (ok) AppLock.unlocked() else if (err != null) error = err }
    }
    fun submit() {
        if (secret.isEmpty()) return
        scope.launch { AppLock.tryUnlock(vm.repo, secret)?.let { error = it; secret = "" } }
    }
    LaunchedEffect(Unit) { if (biometric) prompt(allowDevice = local.lockMethod == "device") }

    Box(Modifier.fillMaxSize().background(p.bg).statusBarsPadding().semantics { contentDescription = "EMI Tracker is locked" }, contentAlignment = Alignment.Center) {
        Column(Modifier.widthIn(max = 360.dp).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(60.dp).clip(RoundedCornerShape(18.dp)).background(Brush.linearGradient(listOf(p.accent, Color(0xFF6D3AE0)))), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Lock, null, tint = Color.White)
            }
            Spacer(Modifier.height(14.dp))
            Text("EMI Tracker is locked", style = MaterialTheme.typography.titleLarge, color = p.text)
            Text(when (local.lockMethod) { "pin" -> "Enter your PIN"; "password" -> "Enter your password"; else -> "Unlock with your fingerprint, face or screen lock" },
                style = MaterialTheme.typography.bodyMedium, color = p.text2)
            Spacer(Modifier.height(18.dp))
            when (local.lockMethod) {
                "pin" -> {
                    Text(if (secret.isEmpty()) " " else "●".repeat(secret.length), fontSize = 26.sp, letterSpacing = 6.sp, color = p.text, modifier = Modifier.semantics { contentDescription = "${secret.length} digits entered" })
                    Spacer(Modifier.height(12.dp))
                    listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("bio", "0", "del")).forEach { row ->
                        Row(horizontalArrangement = Arrangement.spacedBy(18.dp), modifier = Modifier.padding(vertical = 6.dp)) {
                            row.forEach { k ->
                                when (k) {
                                    "del" -> IconButton(onClick = { secret = secret.dropLast(1) }, modifier = Modifier.size(68.dp)) { Icon(Icons.AutoMirrored.Outlined.Backspace, "Delete digit", tint = p.text2) }
                                    "bio" -> if (biometric) IconButton(onClick = { prompt(false) }, modifier = Modifier.size(68.dp)) { Icon(Icons.Outlined.Fingerprint, "Use fingerprint or face", tint = p.accent) } else Spacer(Modifier.size(68.dp))
                                    else -> FilledTonalButton(onClick = { if (secret.length < 12) secret += k; error = null }, shape = CircleShape, modifier = Modifier.size(68.dp)) { Text(k, fontSize = 22.sp) }
                                }
                            }
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Button(onClick = { submit() }, enabled = secret.length >= 4, modifier = Modifier.fillMaxWidth()) { Text("Unlock") }
                }
                "password" -> {
                    OutlinedTextField(secret, { secret = it; error = null }, label = { Text("Password") }, singleLine = true, visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(10.dp))
                    Button(onClick = { submit() }, enabled = secret.isNotEmpty(), modifier = Modifier.fillMaxWidth()) { Text("Unlock") }
                    if (biometric) OutlinedButton(onClick = { prompt(false) }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) { Icon(Icons.Outlined.Fingerprint, null); Text("  Use fingerprint or face") }
                }
                else -> Button(onClick = { prompt(true) }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Fingerprint, null); Text("  Unlock") }
            }
            error?.let { Text(it, color = p.danger, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 10.dp)) }
            if ((pin || local.lockMethod == "password") && canDevice) {
                TextButton(onClick = { prompt(true) }, modifier = Modifier.padding(top = 8.dp)) {
                    Text("Forgot your ${if (pin) "PIN" else "password"}? Use the phone's screen lock", style = MaterialTheme.typography.bodySmall, color = p.text3, textAlign = TextAlign.Center)
                }
            }
        }
    }
}
