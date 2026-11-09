package com.emitracker.app.security

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.emitracker.app.data.LocalSettings
import com.emitracker.app.data.Repository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.StateFlow
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * App lock. Methods: the phone's own screen lock with fingerprint / face ("device"), an app PIN,
 * or an app password (both optionally with fingerprint / face). The app starts locked and locks
 * again after it has been in the background for the chosen time. PIN and password are kept only
 * as a salted PBKDF2 hash in this phone's settings (never synced). The lock guards the app's
 * screens; the phone's own encryption protects the data at rest.
 */
object AppLock {
    private val _locked = MutableStateFlow(false)
    val locked: StateFlow<Boolean> = _locked
    private val _ready = MutableStateFlow(false)
    /** False until the saved settings were read once in this process (the UI shows nothing until then). */
    val ready: StateFlow<Boolean> = _ready
    private var backgroundAt: Long? = null
    /** The system prompt (and the phone's own lock screen) briefly hides the app; that must not re-lock it. */
    private var prompting = false
    /** A system picker (choose folder / file) briefly hides the app; coming back from it within 10 minutes does not re-lock. */
    private var pickerAt: Long? = null

    fun enabled(l: LocalSettings) = l.lockMethod != "none"

    /** Once per process, when the settings are first loaded: the app starts locked. */
    fun init(l: LocalSettings) {
        if (_ready.value) return
        _locked.value = enabled(l)
        _ready.value = true
    }
    fun lockNow(l: LocalSettings) { if (enabled(l)) _locked.value = true }
    fun unlocked() { _locked.value = false }

    fun wentToBackground() { if (!prompting && backgroundAt == null) backgroundAt = System.currentTimeMillis() }
    fun openingSystemPicker() { pickerAt = System.currentTimeMillis() }

    fun cameToForeground(l: LocalSettings) {
        if (prompting) return
        val at = backgroundAt
        backgroundAt = null
        val picker = pickerAt
        pickerAt = null
        if (picker != null && System.currentTimeMillis() - picker < 10 * 60_000L) return
        if (enabled(l) && at != null && System.currentTimeMillis() - at >= l.lockAfterMinutes * 60_000L) _locked.value = true
    }

    // ------------------------------------------------------------------ PIN / password
    fun hash(secret: String, saltB64: String): String {
        val spec = PBEKeySpec(secret.toCharArray(), Base64.getDecoder().decode(saltB64), 120_000, 256)
        return Base64.getEncoder().encodeToString(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded)
    }

    fun newSalt(): String = Base64.getEncoder().encodeToString(ByteArray(16).also { SecureRandom().nextBytes(it) })

    fun matches(l: LocalSettings, secret: String): Boolean =
        l.lockHash.isNotBlank() && MessageDigest.isEqual(Base64.getDecoder().decode(hash(secret, l.lockSalt)), Base64.getDecoder().decode(l.lockHash))

    /** Checks a PIN / password; repeated mistakes make you wait (30 s, doubling, up to 15 min). */
    suspend fun tryUnlock(repo: Repository, secret: String): String? = withContext(Dispatchers.IO) { checkSecret(repo, secret) } // database + PBKDF2 off the main thread

    private suspend fun checkSecret(repo: Repository, secret: String): String? {
        val l = repo.local()
        val now = System.currentTimeMillis()
        if (now < l.lockoutUntil) return "Too many attempts. Try again in ${(l.lockoutUntil - now) / 1000 + 1} seconds."
        if (matches(l, secret)) {
            repo.setLocal { it.copy(lockFailed = 0, lockoutUntil = 0) }
            unlocked()
            return null
        }
        val n = l.lockFailed + 1
        val wait = if (n >= 5) minOf(15 * 60_000L, 30_000L shl (n - 5).coerceAtMost(5)) else 0L
        repo.setLocal { it.copy(lockFailed = n, lockoutUntil = if (wait > 0) now + wait else 0) }
        val what = if (l.lockMethod == "pin") "PIN" else "password"
        return if (wait > 0) "Wrong $what. Try again in ${wait / 1000} seconds." else "Wrong $what"
    }

    // ------------------------------------------------------------------ fingerprint / face / phone screen lock
    /** True when the phone can confirm the user with biometrics, or with its own screen lock if [allowDevice]. */
    fun canAuthenticate(context: Context, allowDevice: Boolean): Boolean =
        BiometricManager.from(context).canAuthenticate(if (allowDevice) BIOMETRIC_WEAK or DEVICE_CREDENTIAL else BIOMETRIC_WEAK) == BiometricManager.BIOMETRIC_SUCCESS

    /**
     * Shows the system prompt. With [allowDevice] the phone's PIN / pattern / password is offered too
     * (this is also how you get back in if you forget the app PIN).
     */
    fun prompt(activity: FragmentActivity, title: String, allowDevice: Boolean, onResult: (Boolean, String?) -> Unit) {
        val info = BiometricPrompt.PromptInfo.Builder().setTitle(title).setSubtitle("EMI Tracker")
            .apply { if (allowDevice) setAllowedAuthenticators(BIOMETRIC_WEAK or DEVICE_CREDENTIAL) else { setAllowedAuthenticators(BIOMETRIC_WEAK); setNegativeButtonText("Cancel") } }
            .build()
        prompting = true
        BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { prompting = false; onResult(true, null) }
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) { prompting = false; onResult(false, errString.toString()) }
        }).authenticate(info)
    }
}
