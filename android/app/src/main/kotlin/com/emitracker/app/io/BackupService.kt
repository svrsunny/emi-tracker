package com.emitracker.app.io

import android.content.Context
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.documentfile.provider.DocumentFile
import com.emitracker.app.BuildConfig
import com.emitracker.app.data.BackupHistoryEntity
import com.emitracker.app.data.Repository
import com.emitracker.core.AppInfo
import com.emitracker.core.BackupException
import com.emitracker.core.MergeStats
import com.emitracker.core.Snapshot
import com.emitracker.core.SnapshotCodec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.security.KeyStore
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Base64
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** A flat folder of text files: an SAF tree on the device, a plain directory in tests. */
interface Folder {
    val label: String
    fun list(): List<String>
    fun read(name: String): String
    fun write(name: String, text: String)
    fun delete(name: String)
}

class FileFolder(private val dir: File) : Folder {
    override val label: String get() = dir.absolutePath
    override fun list() = dir.listFiles()?.filter { it.isFile }?.map { it.name } ?: emptyList()
    override fun read(name: String) = File(dir, name).readText()
    override fun write(name: String, text: String) {
        dir.mkdirs()
        val tmp = File(dir, "$name.tmp")
        tmp.writeText(text)
        if (!tmp.renameTo(File(dir, name))) { File(dir, name).delete(); tmp.renameTo(File(dir, name)) }
    }
    override fun delete(name: String) { File(dir, name).delete() }
}

/** Storage Access Framework folder chosen by the user (Documents, SD card, USB, any provider). */
class SafFolder(private val context: Context, val uri: Uri) : Folder {
    private val tree get() = DocumentFile.fromTreeUri(context, uri) ?: throw IllegalStateException("Folder is no longer available")
    override val label: String get() = tree.name ?: uri.toString()
    override fun list() = tree.listFiles().filter { it.isFile }.mapNotNull { it.name }
    override fun read(name: String): String {
        val f = tree.findFile(name) ?: throw IllegalStateException("$name not found")
        return context.contentResolver.openInputStream(f.uri)!!.use { it.readBytes().toString(Charsets.UTF_8) }
    }
    override fun write(name: String, text: String) {
        val f = tree.findFile(name) ?: tree.createFile("application/octet-stream", name) ?: throw IllegalStateException("Cannot create $name")
        context.contentResolver.openOutputStream(f.uri, "wt")!!.use { it.write(text.toByteArray(Charsets.UTF_8)) }
    }
    override fun delete(name: String) { tree.findFile(name)?.delete() }
}

data class RestorePreview(val snapshot: Snapshot, val current: Map<String, Int>, val encrypted: Boolean)
data class RestoreReport(val restored: Map<String, Int>, val recoveryBackup: String, val checksumVerified: Boolean, val integrity: String)
data class SyncPeer(val file: String, val deviceName: String, val ok: Boolean, val message: String, val stats: MergeStats?)
data class SyncReport(val at: String, val peers: List<SyncPeer>, val totals: MergeStats)

class BackupService(private val context: Context, private val repo: Repository) {
    val app = AppInfo("EMI Tracker", BuildConfig.VERSION_NAME, "android")
    val recoveryDir = File(context.filesDir, "recovery-backups")
    private val syncRe = Regex("^emi-tracker-sync-([A-Za-z0-9-]+)\\.(json|emisync)$")

    fun fileName(label: String, encrypted: Boolean): String =
        "emi-tracker-$label-${LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss"))}${if (encrypted) ".emibackup" else ".json"}"

    suspend fun buildText(kind: String, passphrase: String?): Pair<Snapshot, String> = withContext(Dispatchers.IO) {
        val local = repo.local()
        val snap = SnapshotCodec.build(repo.snapshotData(), kind, app, local.deviceId, local.deviceName)
        snap to SnapshotCodec.serialize(snap, passphrase)
    }

    /** Write a backup to a document the user created with SAF, verify it by reading it back. */
    suspend fun backupTo(uri: Uri, passphrase: String?): Snapshot = withContext(Dispatchers.IO) { backupToInternal(uri, passphrase) }

    private suspend fun backupToInternal(uri: Uri, passphrase: String?): Snapshot {
        val (snap, text) = buildText("backup", passphrase)
        withContext(Dispatchers.IO) {
            context.contentResolver.openOutputStream(uri, "wt")!!.use { it.write(text.toByteArray(Charsets.UTF_8)) }
            val back = context.contentResolver.openInputStream(uri)!!.use { it.readBytes().toString(Charsets.UTF_8) }
            if (SnapshotCodec.parse(back, passphrase).checksum != snap.checksum) throw BackupException("checksum_mismatch", "Verification after writing failed")
        }
        recordBackup(snap, uri.lastPathSegment ?: uri.toString(), text.length.toLong(), passphrase != null)
        return snap
    }

    /** Write into a folder (automatic backups, recovery backups, tests). */
    suspend fun backupToFolder(folder: Folder, kind: String = "backup", label: String = kind, passphrase: String? = null): String = withContext(Dispatchers.IO) { backupToFolderInternal(folder, kind, label, passphrase) }

    private suspend fun backupToFolderInternal(folder: Folder, kind: String, label: String, passphrase: String?): String {
        val (snap, text) = buildText(kind, passphrase)
        val name = fileName(label, passphrase != null)
        withContext(Dispatchers.IO) {
            folder.write(name, text)
            if (SnapshotCodec.parse(folder.read(name), passphrase).checksum != snap.checksum) throw BackupException("checksum_mismatch", "Verification after writing failed")
        }
        recordBackup(snap, "${folder.label}/$name", text.length.toLong(), passphrase != null, label)
        return name
    }

    private suspend fun recordBackup(snap: Snapshot, path: String, size: Long, encrypted: Boolean, label: String = snap.kind) {
        repo.addBackupHistory(BackupHistoryEntity(UUID.randomUUID().toString(), java.time.Instant.now().toString(), label, path, size, encrypted, snap.checksum,
            SnapshotCodec.json.encodeToString(kotlinx.serialization.serializer<Map<String, Int>>(), snap.counts), true, "Verified"))
        if (snap.kind == "backup") repo.setLocal { it.copy(lastBackupAt = java.time.Instant.now().toString()) }
        repo.addAuditEntry("backup", null, "create", "Created ${if (encrypted) "encrypted " else ""}${snap.kind} (${snap.counts["loans"]} loans, ${snap.counts["payments"]} payments)")
    }

    fun pruneAuto(folder: Folder, keep: Int): Int {
        val re = Regex("^emi-tracker-auto-\\d{8}-\\d{6}\\.(json|emibackup)$")
        val old = folder.list().filter { re.matches(it) }.sortedDescending().drop(maxOf(1, keep))
        old.forEach(folder::delete)
        return old.size
    }

    fun readUri(uri: Uri): String = context.contentResolver.openInputStream(uri)!!.use { it.readBytes().toString(Charsets.UTF_8) }

    suspend fun preview(text: String, passphrase: String?): RestorePreview = withContext(Dispatchers.IO) {
        RestorePreview(SnapshotCodec.parse(text, passphrase), SnapshotCodec.counts(repo.snapshotData()), SnapshotCodec.isEncrypted(text))
    }

    /** Destructive restore with recovery backup, verification and rollback. */
    suspend fun restore(text: String, passphrase: String?): RestoreReport = withContext(Dispatchers.IO) { restoreInternal(text, passphrase) }

    private suspend fun restoreInternal(text: String, passphrase: String?): RestoreReport {
        val snap = withContext(Dispatchers.IO) { SnapshotCodec.parse(text, passphrase) }
        val recovery = backupToFolder(FileFolder(recoveryDir), kind = "recovery", label = "before-restore")
        val previous = withContext(Dispatchers.IO) { repo.snapshotData() }
        try {
            repo.replaceAll(snap.data)
            val after = withContext(Dispatchers.IO) { repo.snapshotData() }
            val counts = SnapshotCodec.counts(after)
            val verified = SnapshotCodec.checksumOf(SnapshotCodec.normalizeData(after)) == snap.checksum
            val (ok, msg) = withContext(Dispatchers.IO) { repo.integrity() }
            if (counts != snap.counts || !verified || !ok) throw IllegalStateException("Post-restore verification failed")
            repo.addAuditEntry("backup", null, "restore", "Restored backup from ${snap.createdAt} (${counts["loans"]} loans, ${counts["payments"]} payments). Recovery backup: $recovery")
            return RestoreReport(counts, File(recoveryDir, recovery).absolutePath, verified, msg)
        } catch (e: Exception) {
            repo.replaceAll(previous)
            throw BackupException("invalid", "Restore failed and was rolled back: ${e.message}")
        }
    }

    // ------------------------------------------------------------------ sync
    fun syncFileName(deviceId: String, encrypted: Boolean) = "emi-tracker-sync-$deviceId.${if (encrypted) "emisync" else "json"}"

    suspend fun syncNow(folder: Folder, passphrase: String?): SyncReport = withContext(Dispatchers.IO) { syncInternal(folder, passphrase) }

    private suspend fun syncInternal(folder: Folder, passphrase: String?): SyncReport {
        val local = repo.local()
        val totals = MergeStats()
        val peers = mutableListOf<SyncPeer>()
        var changed = false
        var merged = withContext(Dispatchers.IO) { SnapshotCodec.normalizeData(repo.snapshotData()) }
        withContext(Dispatchers.IO) {
            for (file in folder.list().sorted()) {
                val m = syncRe.matchEntire(file) ?: continue
                if (m.groupValues[1] == local.deviceId) continue
                try {
                    val snap = SnapshotCodec.parse(folder.read(file), passphrase)
                    if (snap.kind != "sync") throw IllegalStateException("Not a sync file")
                    val (data, stats) = SnapshotCodec.merge(merged, snap.data)
                    merged = data
                    totals.added += stats.added; totals.updated += stats.updated; totals.deleted += stats.deleted; totals.unchanged += stats.unchanged
                    totals.preferencesUpdated = totals.preferencesUpdated || stats.preferencesUpdated
                    if (stats.added + stats.updated + stats.deleted > 0 || stats.preferencesUpdated) changed = true
                    peers.add(SyncPeer(file, snap.deviceName, true, "Merged", stats))
                } catch (e: Exception) {
                    peers.add(SyncPeer(file, "", false, e.message ?: "Unreadable", null))
                }
            }
        }
        if (changed) {
            repo.applyMerged(merged)
            repo.addAuditEntry("sync", null, "merge", "Synced from ${peers.count { it.ok }} device(s): +${totals.added} new, ${totals.updated} updated, ${totals.deleted} deleted")
        }
        val (_, text) = buildText("sync", passphrase)
        withContext(Dispatchers.IO) {
            folder.delete(syncFileName(local.deviceId, passphrase == null))
            folder.write(syncFileName(local.deviceId, passphrase != null), text)
        }
        val at = java.time.Instant.now().toString()
        val failed = peers.count { !it.ok }
        repo.setLocal { it.copy(lastSyncAt = at, lastSyncResult = if (failed > 0) "$failed device file(s) could not be read" else "OK — ${peers.size} other device(s)") }
        return SyncReport(at, peers, totals)
    }
}

/**
 * Keeps the sync passphrase encrypted with a non-exportable AES key in the Android Keystore,
 * so automatic background sync can run without ever storing the passphrase in plaintext.
 */
object SecretBox {
    private const val ALIAS = "emi-tracker-sync"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        return gen.generateKey()
    }

    fun seal(plain: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        val b64 = Base64.getEncoder()
        return b64.encodeToString(c.iv) + ":" + b64.encodeToString(c.doFinal(plain.toByteArray(Charsets.UTF_8)))
    }

    fun open(sealed: String): String? = runCatching {
        val (iv, ct) = sealed.split(":").let { it[0] to it[1] }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.getDecoder().decode(iv)))
        String(c.doFinal(Base64.getDecoder().decode(ct)), Charsets.UTF_8)
    }.getOrNull()
}
