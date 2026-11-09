package com.emitracker.core

import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Wi-Fi sync protocol v1, identical to the desktop app (desktop/src/main/lanProtocol.ts and
 * docs/BACKUP_AND_RESTORE.md#wi-fi-sync).
 *  - Pairing key K = HKDF-SHA256(P-256 ECDH secret, salt = SHA-256(code), info = "emi-tracker-pair-v1" || phonePub || pcPub).
 *  - Proofs: HMAC-SHA256(K, "emi-tracker-pair-v1:phone" / ":pc").
 *  - Messages: AES-256-GCM under K with the direction and device id as associated data.
 */
object Lan {
    const val PROTOCOL = 1
    const val DEFAULT_PORT = 47830
    private const val INFO = "emi-tracker-pair-v1"
    private val b64 = Base64.getEncoder()
    private val unb64 = Base64.getDecoder()

    data class Sealed(val iv: String, val data: String)
    class KeyPair(val private: PrivateKey, val pub: ByteArray)

    fun newKeyPair(): KeyPair {
        val g = KeyPairGenerator.getInstance("EC")
        g.initialize(ECGenParameterSpec("secp256r1"))
        val kp = g.generateKeyPair()
        return KeyPair(kp.private, kp.public.encoded) // X.509 SubjectPublicKeyInfo DER, same as Node's "spki"
    }

    fun deriveKey(private: PrivateKey, peerPub: ByteArray, code: String, phonePub: ByteArray, pcPub: ByteArray): ByteArray {
        val ka = KeyAgreement.getInstance("ECDH")
        ka.init(private)
        ka.doPhase(KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(peerPub)), true)
        val shared = ka.generateSecret()
        val salt = MessageDigest.getInstance("SHA-256").digest(code.toByteArray(Charsets.UTF_8))
        return hkdf(shared, salt, INFO.toByteArray(Charsets.UTF_8) + phonePub + pcPub, 32)
    }

    /** RFC 5869 HKDF with HMAC-SHA256. */
    fun hkdf(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
        val prk = hmac(salt, ikm)
        val out = java.io.ByteArrayOutputStream()
        var t = ByteArray(0)
        var i = 1
        while (out.size() < length) {
            t = hmac(prk, t + info + byteArrayOf(i.toByte()))
            out.write(t)
            i++
        }
        return out.toByteArray().copyOf(length)
    }

    private fun hmac(key: ByteArray, data: ByteArray): ByteArray = Mac.getInstance("HmacSHA256").run { init(SecretKeySpec(key, "HmacSHA256")); doFinal(data) }

    fun proof(key: ByteArray, who: String): String = b64.encodeToString(hmac(key, "$INFO:$who".toByteArray(Charsets.UTF_8)))

    fun proofMatches(key: ByteArray, who: String, proofB64: String): Boolean =
        runCatching { MessageDigest.isEqual(unb64.decode(proofB64), unb64.decode(proof(key, who))) }.getOrDefault(false)

    fun seal(key: ByteArray, plaintext: String, aad: String): Sealed {
        val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        c.updateAAD(aad.toByteArray(Charsets.UTF_8))
        return Sealed(b64.encodeToString(iv), b64.encodeToString(c.doFinal(plaintext.toByteArray(Charsets.UTF_8))))
    }

    /** Throws when the key is wrong or the message was altered. */
    fun open(key: ByteArray, s: Sealed, aad: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, unb64.decode(s.iv)))
        c.updateAAD(aad.toByteArray(Charsets.UTF_8))
        return String(c.doFinal(unb64.decode(s.data)), Charsets.UTF_8)
    }

    fun requestAad(deviceId: String) = "emi-sync-req:$deviceId"
    fun responseAad(deviceId: String) = "emi-sync-res:$deviceId"

    /** Home-network addresses only: private IPv4 ranges, link-local, loopback and IPv6 unique-local. */
    fun isLocalNetwork(a: InetAddress): Boolean = when (a) {
        is Inet4Address -> a.isSiteLocalAddress || a.isLinkLocalAddress || a.isLoopbackAddress
        is Inet6Address -> a.isLinkLocalAddress || a.isLoopbackAddress || (a.address[0].toInt() and 0xFE) == 0xFC
        else -> false
    }

    /** "192.168.1.10", "192.168.1.10:5000" or "my-pc:5000" → host and port. */
    fun parseAddress(input: String): Pair<String, Int>? {
        val t = input.trim().removePrefix("http://").trimEnd('/')
        if (t.isEmpty() || t.any { it.isWhitespace() || it == '/' || it == '@' }) return null
        val bracket = Regex("^\\[([0-9a-fA-F:.]+)](?::(\\d{1,5}))?$").matchEntire(t)
        if (bracket != null) return bracket.groupValues[1] to (bracket.groupValues[2].toIntOrNull() ?: DEFAULT_PORT)
        if (t.count { it == ':' } > 1) return t to DEFAULT_PORT // bare IPv6
        val host = t.substringBefore(':')
        val port = if (':' in t) t.substringAfter(':').toIntOrNull() ?: return null else DEFAULT_PORT
        if (host.isEmpty() || port !in 1..65535) return null
        return host to port
    }
}
