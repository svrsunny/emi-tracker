package com.emitracker.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Instant
import java.util.Base64
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * Portable snapshot format shared with the desktop app (docs/BACKUP_AND_RESTORE.md).
 *  - Canonical JSON: keys sorted recursively, no whitespace, JS-compatible string escaping.
 *  - Checksum: SHA-256 of the canonical JSON of `data` with every table sorted by id.
 *  - Encryption: AES-256-GCM, key = PBKDF2-HMAC-SHA256(passphrase, 16-byte salt, 210,000 iterations).
 */
class BackupException(val code: String, message: String) : Exception(message)

data class MergeStats(var added: Int = 0, var updated: Int = 0, var deleted: Int = 0, var unchanged: Int = 0, var preferencesUpdated: Boolean = false)

object SnapshotCodec {
    const val PBKDF2_ITERATIONS = 210_000
    val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = true; prettyPrint = false }
    private val pretty = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = true; prettyPrint = true }
    private val TABLES = listOf("loans", "adjustments", "payments", "customReminders", "notifications", "audit", "categories", "bills", "billPayments", "debts", "debtRepayments")

    // ------------------------------------------------------------ canonical JSON
    fun canonical(e: JsonElement): String = StringBuilder().also { write(e, it) }.toString()

    private fun write(e: JsonElement, sb: StringBuilder) {
        when (e) {
            is JsonNull -> sb.append("null")
            is JsonPrimitive -> if (e.isString) quote(e.content, sb) else sb.append(e.content)
            is JsonArray -> { sb.append('['); e.forEachIndexed { i, x -> if (i > 0) sb.append(','); write(x, sb) }; sb.append(']') }
            is JsonObject -> {
                sb.append('{')
                e.keys.sorted().forEachIndexed { i, k -> if (i > 0) sb.append(','); quote(k, sb); sb.append(':'); write(e.getValue(k), sb) }
                sb.append('}')
            }
        }
    }

    /** Exactly JavaScript's JSON.stringify escaping. */
    private fun quote(s: String, sb: StringBuilder) {
        sb.append('"')
        for (ch in s) {
            when {
                ch == '"' -> sb.append("\\\"")
                ch == '\\' -> sb.append("\\\\")
                ch == '\b' -> sb.append("\\b")
                ch == '\u000C' -> sb.append("\\f")
                ch == '\n' -> sb.append("\\n")
                ch == '\r' -> sb.append("\\r")
                ch == '\t' -> sb.append("\\t")
                ch < ' ' -> sb.append("\\u").append(String.format("%04x", ch.code))
                else -> sb.append(ch)
            }
        }
        sb.append('"')
    }

    /** Sort every table of a data object by id (tombstones by table:id). */
    fun normalize(data: JsonObject): JsonObject {
        val m = data.toMutableMap()
        for (t in TABLES) m[t]?.let { arr -> m[t] = JsonArray((arr as JsonArray).sortedBy { it.jsonObject["id"]!!.jsonPrimitive.content }) }
        m["tombstones"]?.let { arr ->
            m["tombstones"] = JsonArray((arr as JsonArray).sortedBy { it.jsonObject["table"]!!.jsonPrimitive.content + ":" + it.jsonObject["id"]!!.jsonPrimitive.content })
        }
        return JsonObject(m)
    }

    fun sha256(s: String): String = MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    fun checksumOf(data: JsonObject): String = sha256(canonical(normalize(data)))
    fun checksumOf(data: SnapshotData): String = checksumOf(json.encodeToJsonElement(data).jsonObject)

    fun counts(d: SnapshotData) = linkedMapOf(
        "loans" to d.loans.size, "adjustments" to d.adjustments.size, "payments" to d.payments.size, "customReminders" to d.customReminders.size,
        "notifications" to d.notifications.size, "audit" to d.audit.size, "categories" to d.categories.size, "bills" to d.bills.size,
        "billPayments" to d.billPayments.size, "debts" to d.debts.size, "debtRepayments" to d.debtRepayments.size, "tombstones" to d.tombstones.size,
    )

    fun normalizeData(d: SnapshotData) = d.copy(
        loans = d.loans.sortedBy { it.id }, adjustments = d.adjustments.sortedBy { it.id }, payments = d.payments.sortedBy { it.id },
        customReminders = d.customReminders.sortedBy { it.id }, notifications = d.notifications.sortedBy { it.id }, audit = d.audit.sortedBy { it.id },
        categories = d.categories.sortedBy { it.id }, bills = d.bills.sortedBy { it.id }, billPayments = d.billPayments.sortedBy { it.id },
        debts = d.debts.sortedBy { it.id }, debtRepayments = d.debtRepayments.sortedBy { it.id },
        tombstones = d.tombstones.sortedBy { "${it.table}:${it.id}" },
    )

    fun build(data: SnapshotData, kind: String, app: AppInfo, deviceId: String, deviceName: String): Snapshot {
        val n = normalizeData(data)
        return Snapshot(SNAPSHOT_FORMAT, SNAPSHOT_FORMAT_VERSION, SCHEMA_VERSION, kind, Instant.now().toString(), app, deviceId, deviceName, counts(n), checksumOf(n), n)
    }

    // ------------------------------------------------------------ encryption
    fun encrypt(plaintext: String, passphrase: String, kind: String): EncryptedEnvelope {
        if (passphrase.length < 8) throw BackupException("invalid", "Passphrase must be at least 8 characters")
        val rnd = SecureRandom()
        val salt = ByteArray(16).also(rnd::nextBytes)
        val iv = ByteArray(12).also(rnd::nextBytes)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key(passphrase, salt, PBKDF2_ITERATIONS), GCMParameterSpec(128, iv))
        val ct = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8)) // ciphertext || 16-byte tag, same layout as the desktop
        val b64 = Base64.getEncoder()
        return EncryptedEnvelope(ENCRYPTED_FORMAT, 1, "PBKDF2-HMAC-SHA256", PBKDF2_ITERATIONS, b64.encodeToString(salt), b64.encodeToString(iv), "AES-256-GCM", b64.encodeToString(ct), Instant.now().toString(), kind)
    }

    fun decrypt(env: EncryptedEnvelope, passphrase: String): String {
        val dec = Base64.getDecoder()
        val all = dec.decode(env.ciphertext)
        if (all.size < 17) throw BackupException("corrupt", "Encrypted backup is truncated")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(passphrase, dec.decode(env.salt), env.iterations), GCMParameterSpec(128, dec.decode(env.iv)))
        return try { String(cipher.doFinal(all), Charsets.UTF_8) } catch (_: AEADBadTagException) {
            throw BackupException("bad_passphrase", "Wrong passphrase, or the encrypted file was modified")
        }
    }

    private fun key(passphrase: String, salt: ByteArray, iterations: Int): SecretKeySpec {
        val f = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val bytes = f.generateSecret(PBEKeySpec(passphrase.toCharArray(), salt, iterations, 256)).encoded
        return SecretKeySpec(bytes, "AES")
    }

    // ------------------------------------------------------------ serialize / parse
    fun serialize(s: Snapshot, passphrase: String? = null): String {
        val text = pretty.encodeToString(Snapshot.serializer(), s)
        return if (passphrase.isNullOrEmpty()) text else pretty.encodeToString(EncryptedEnvelope.serializer(), encrypt(text, passphrase, s.kind))
    }

    fun isEncrypted(text: String): Boolean = runCatching { json.parseToJsonElement(text).jsonObject["format"]?.jsonPrimitive?.contentOrNull == ENCRYPTED_FORMAT }.getOrDefault(false)

    /** Parse, decrypt, migrate and fully validate a backup or sync file. */
    fun parse(text: String, passphrase: String? = null): Snapshot {
        var obj: JsonObject = try { json.parseToJsonElement(text).jsonObject } catch (_: Exception) {
            throw BackupException("corrupt", "File is not valid JSON — it may be truncated or corrupted")
        }
        if (obj["format"]?.jsonPrimitive?.contentOrNull == ENCRYPTED_FORMAT) {
            if (passphrase.isNullOrEmpty()) throw BackupException("needs_passphrase", "This backup is encrypted. Enter its passphrase.")
            val env = runCatching { json.decodeFromJsonElement<EncryptedEnvelope>(obj) }.getOrElse { throw BackupException("corrupt", "Encrypted envelope is damaged") }
            if (env.formatVersion != 1 || env.cipher != "AES-256-GCM") throw BackupException("unsupported_version", "Unsupported encryption format")
            obj = try { json.parseToJsonElement(decrypt(env, passphrase)).jsonObject } catch (e: BackupException) { throw e } catch (_: Exception) {
                throw BackupException("corrupt", "Decrypted content is not valid JSON")
            }
        }
        if (obj["format"]?.jsonPrimitive?.contentOrNull != SNAPSHOT_FORMAT) throw BackupException("not_a_backup", "This file is not an EMI Tracker backup")
        val v = runCatching { obj["formatVersion"]!!.jsonPrimitive.int }.getOrElse { throw BackupException("invalid", "Missing format version") }
        if (v > SNAPSHOT_FORMAT_VERSION) throw BackupException("unsupported_version", "Backup format v$v is newer than this app supports (v$SNAPSHOT_FORMAT_VERSION). Update the app first.")
        // v1 is current; future migrations go here in order.
        val dataEl = obj["data"] as? JsonObject ?: throw BackupException("invalid", "Backup has no data section")
        val snap = try { json.decodeFromJsonElement<Snapshot>(obj) } catch (e: Exception) {
            throw BackupException("invalid", "Backup failed validation: ${e.message?.lineSequence()?.firstOrNull()}")
        }
        // verify against the file's own JSON so the result is independent of this app's model
        if (checksumOf(dataEl) != snap.checksum) throw BackupException("checksum_mismatch", "Checksum mismatch — the backup was modified or is corrupted")
        Validation.snapshot(snap.data)?.let { throw BackupException("invalid", "Backup failed validation: $it") }
        return snap
    }

    // ------------------------------------------------------------ sync merge
    private fun <T> canon(x: T, ser: kotlinx.serialization.KSerializer<T>) = canonical(json.encodeToJsonElement(ser, x))

    /** Deterministic last-writer-wins merge; commutative and idempotent (port of mergeData). */
    fun merge(local: SnapshotData, remote: SnapshotData): Pair<SnapshotData, MergeStats> {
        val stats = MergeStats()
        val tomb = linkedMapOf<String, Tombstone>()
        for (t in local.tombstones + remote.tombstones) {
            val k = "${t.table}:${t.id}"
            val cur = tomb[k]
            if (cur == null || t.deletedAt > cur.deletedAt) tomb[k] = t
        }
        fun <T> table(name: String, a: List<T>, b: List<T>, id: (T) -> String, upd: (T) -> String, ser: kotlinx.serialization.KSerializer<T>): List<T> {
            val map = linkedMapOf<String, T>()
            a.forEach { map[id(it)] = it }
            for (r in b) {
                val cur = map[id(r)]
                if (cur == null) { map[id(r)] = r; stats.added++; continue }
                val win = when {
                    upd(cur) != upd(r) -> if (upd(cur) > upd(r)) cur else r
                    else -> if (canon(cur, ser) >= canon(r, ser)) cur else r
                }
                if (win !== cur) { map[id(r)] = win; stats.updated++ } else stats.unchanged++
            }
            val localIds = a.map(id).toSet()
            return map.values.filter { r ->
                val t = tomb["$name:${id(r)}"]
                if (t != null && t.deletedAt >= upd(r)) { if (id(r) in localIds) stats.deleted++; false } else true
            }.sortedBy(id)
        }
        val prefs = if (local.preferences.updatedAt >= remote.preferences.updatedAt) local.preferences else remote.preferences
        stats.preferencesUpdated = prefs !== local.preferences
        var data = SnapshotData(
            loans = table("loans", local.loans, remote.loans, { it.id }, { it.updatedAt }, Loan.serializer()),
            adjustments = table("adjustments", local.adjustments, remote.adjustments, { it.id }, { it.updatedAt }, Adjustment.serializer()),
            payments = table("payments", local.payments, remote.payments, { it.id }, { it.updatedAt }, Payment.serializer()),
            customReminders = table("customReminders", local.customReminders, remote.customReminders, { it.id }, { it.updatedAt }, CustomReminder.serializer()),
            notifications = table("notifications", local.notifications, remote.notifications, { it.id }, { it.updatedAt }, NotificationRecord.serializer()),
            audit = table("audit", local.audit, remote.audit, { it.id }, { it.updatedAt }, AuditEntry.serializer()),
            categories = table("categories", local.categories, remote.categories, { it.id }, { it.updatedAt }, Category.serializer()),
            bills = table("bills", local.bills, remote.bills, { it.id }, { it.updatedAt }, Bill.serializer()),
            billPayments = table("billPayments", local.billPayments, remote.billPayments, { it.id }, { it.updatedAt }, BillPayment.serializer()),
            debts = table("debts", local.debts, remote.debts, { it.id }, { it.updatedAt }, Debt.serializer()),
            debtRepayments = table("debtRepayments", local.debtRepayments, remote.debtRepayments, { it.id }, { it.updatedAt }, DebtRepayment.serializer()),
            tombstones = tomb.values.sortedBy { "${it.table}:${it.id}" },
            preferences = prefs,
        )
        val loanIds = data.loans.map { it.id }.toSet()
        data = data.copy(
            adjustments = data.adjustments.filter { it.loanId in loanIds },
            payments = data.payments.filter { it.loanId in loanIds },
            customReminders = data.customReminders.map { if (it.loanId != null && it.loanId !in loanIds) it.copy(loanId = null) else it },
            billPayments = data.billPayments.filter { p -> data.bills.any { it.id == p.billId } },
            debtRepayments = data.debtRepayments.filter { r -> data.debts.any { it.id == r.debtId } },
        )
        return data to stats
    }
}
