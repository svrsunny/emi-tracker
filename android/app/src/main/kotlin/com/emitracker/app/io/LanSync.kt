package com.emitracker.app.io

import com.emitracker.app.data.Repository
import com.emitracker.core.Lan
import com.emitracker.core.MergeStats
import com.emitracker.core.SnapshotCodec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.io.IOException
import java.net.HttpURLConnection
import java.net.Inet6Address
import java.net.InetAddress
import java.net.URL
import java.time.Instant
import java.util.Base64

class LanException(message: String) : Exception(message)

/**
 * Wi-Fi sync with the Windows app (protocol v1, see core/Lan.kt). The phone always starts the
 * exchange and only ever connects to a home-network address the user entered; every snapshot is
 * encrypted with the key agreed during pairing, and merged with the same record-level merge as
 * folder sync.
 */
class LanSync(private val repo: Repository, private val backup: BackupService) {
    private val lock = Mutex()

    /** Pairs with the PC showing [code]; returns the PC's name. */
    suspend fun pair(address: String, code: String): String = withContext(Dispatchers.IO) {
        lock.withLock {
            val (host, port) = Lan.parseAddress(address) ?: throw LanException("Enter the PC address shown in the Windows app, e.g. 192.168.1.10")
            if (!Regex("^\\d{6}$").matches(code.trim())) throw LanException("The pairing code has 6 digits")
            val base = baseUrl(host, port)
            val local = repo.local()
            val kp = Lan.newKeyPair()
            val start = post(base, "/pair/start", buildJsonObject {
                put("deviceId", local.deviceId); put("deviceName", local.deviceName); put("pub", Base64.getEncoder().encodeToString(kp.pub))
            })
            val pcPub = Base64.getDecoder().decode(start.str("pub"))
            val key = Lan.deriveKey(kp.private, pcPub, code.trim(), kp.pub, pcPub)
            val fin = post(base, "/pair/finish", buildJsonObject { put("deviceId", local.deviceId); put("proof", Lan.proof(key, "phone")) })
            if (!Lan.proofMatches(key, "pc", fin.str("proof"))) throw LanException("The PC could not prove it knows the code. Pair again.")
            val pcName = start.str("deviceName").ifBlank { "Windows PC" }
            repo.setLocal {
                it.copy(lanHost = address.trim(), lanPcName = pcName, lanPcId = start.str("deviceId"), lanKey = SecretBox.seal(Base64.getEncoder().encodeToString(key)),
                    lastLanSyncAt = null, lastLanSyncResult = "Paired")
            }
            repo.addAuditEntry("sync", null, "pair", "Paired with “$pcName” for Wi-Fi sync")
            pcName
        }
    }

    suspend fun unpair() {
        repo.setLocal { it.copy(lanKey = "", lanPcName = "", lanPcId = "", lastLanSyncAt = null, lastLanSyncResult = "") }
    }

    /** Sends this phone's data, merges the PC's data back. Records the outcome either way. */
    suspend fun sync(): MergeStats = withContext(Dispatchers.IO) {
        lock.withLock {
            try {
                val stats = exchange()
                repo.setLocal { it.copy(lastLanSyncAt = Instant.now().toString(), lastLanSyncResult = "OK — +${stats.added} new, ${stats.updated} updated, ${stats.deleted} deleted") }
                stats
            } catch (e: Exception) {
                val msg = when (e) {
                    is LanException -> e.message
                    is java.net.SocketTimeoutException, is java.net.ConnectException, is java.net.NoRouteToHostException -> "PC not reachable — is it on, with EMI Tracker running, on the same Wi-Fi?"
                    else -> e.message
                } ?: "Sync failed"
                repo.setLocal { it.copy(lastLanSyncAt = Instant.now().toString(), lastLanSyncResult = "Failed: $msg") }
                throw LanException(msg)
            } finally {
                repo.refresh()
            }
        }
    }

    /** True when "Sync now" was pressed on the PC; checked every few seconds while the app is open. Never throws. */
    suspend fun pcAskedToSync(): Boolean = withContext(Dispatchers.IO) {
        runCatching {
            val local = repo.local()
            val (host, port) = Lan.parseAddress(local.lanHost) ?: return@runCatching false
            if (local.lanKey.isBlank()) return@runCatching false
            val c = URL(baseUrl(host, port) + "/hello").openConnection() as HttpURLConnection
            try {
                c.connectTimeout = 2_000; c.readTimeout = 3_000; c.instanceFollowRedirects = false; c.useCaches = false
                if (c.responseCode != 200) return@runCatching false
                val json = SnapshotCodec.json.parseToJsonElement(c.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }).jsonObject
                json["syncRequested"]?.jsonPrimitive?.booleanOrNull == true
            } finally { c.disconnect() }
        }.getOrDefault(false)
    }

    private suspend fun exchange(): MergeStats {
        val local = repo.local()
        val keyB64 = SecretBox.open(local.lanKey) ?: throw LanException("Not paired with a PC")
        val key = Base64.getDecoder().decode(keyB64)
        val (host, port) = Lan.parseAddress(local.lanHost) ?: throw LanException("PC address is not valid")
        val (_, text) = backup.buildText("sync", null)
        val sealed = Lan.seal(key, text, Lan.requestAad(local.deviceId))
        val res = post(baseUrl(host, port), "/sync", buildJsonObject { put("deviceId", local.deviceId); put("iv", sealed.iv); put("data", sealed.data) })
        val plain = try { Lan.open(key, Lan.Sealed(res.str("iv"), res.str("data")), Lan.responseAad(local.deviceId)) } catch (_: Exception) {
            throw LanException("The PC's reply could not be decrypted. Pair again.")
        }
        val snap = SnapshotCodec.parse(plain)
        if (snap.kind != "sync") throw LanException("Unexpected reply from the PC")
        val (merged, stats) = SnapshotCodec.merge(SnapshotCodec.normalizeData(repo.snapshotData()), snap.data)
        if (stats.added + stats.updated + stats.deleted > 0 || stats.preferencesUpdated) {
            repo.applyMerged(merged)
            repo.addAuditEntry("sync", null, "merge", "Wi-Fi sync with ${snap.deviceName}: +${stats.added} new, ${stats.updated} updated, ${stats.deleted} deleted")
        }
        return stats
    }

    /** Resolves the host and refuses anything outside the home network; connects to the checked address. */
    private fun baseUrl(host: String, port: Int): String {
        val addr = try { InetAddress.getByName(host) } catch (_: IOException) { throw LanException("Could not find “$host” on this network") }
        if (!Lan.isLocalNetwork(addr)) throw LanException("$host is not a home-network address. Wi-Fi sync only connects inside your network.")
        val h = if (addr is Inet6Address) "[${addr.hostAddress?.substringBefore('%')}]" else addr.hostAddress
        return "http://$h:$port/emi-sync"
    }

    private fun post(base: String, route: String, body: JsonObject): JsonObject {
        val c = URL(base + route).openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"
            c.connectTimeout = 5_000
            c.readTimeout = 60_000
            c.instanceFollowRedirects = false
            c.useCaches = false
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = c.responseCode
            val text = (if (status in 200..299) c.inputStream else c.errorStream)?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
            val json = runCatching { SnapshotCodec.json.parseToJsonElement(text).jsonObject }.getOrNull()
            if (status !in 200..299) throw LanException(json?.get("error")?.jsonPrimitive?.content ?: "The PC answered with error $status")
            return json ?: throw LanException("Unexpected reply from the PC")
        } finally {
            c.disconnect()
        }
    }

    private fun JsonObject.str(k: String) = this[k]?.jsonPrimitive?.content ?: throw LanException("Unexpected reply from the PC")
}
