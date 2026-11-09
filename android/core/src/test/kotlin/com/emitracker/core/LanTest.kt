package com.emitracker.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.net.InetAddress
import java.security.KeyFactory
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Base64

/** Wi-Fi sync protocol; the vector file is written by the desktop unit tests (tests/unit/lan.test.ts). */
class LanTest {
    private val dir = generateSequence(File("").absoluteFile) { it.parentFile }.map { File(it, "fixtures") }.first { it.isDirectory }
    private val b64 = Base64.getDecoder()

    @Test fun reproducesDesktopVector() {
        val v = Json.parseToJsonElement(File(dir, "lan-vector.json").readText()).jsonObject
        fun s(k: String) = v[k]!!.jsonPrimitive.content
        val priv = KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(b64.decode(s("phonePrivatePkcs8"))))
        val key = Lan.deriveKey(priv, b64.decode(s("pcPub")), s("code"), b64.decode(s("phonePub")), b64.decode(s("pcPub")))
        assertArrayEquals(b64.decode(s("key")), key)
        assertEquals(s("phoneProof"), Lan.proof(key, "phone"))
        assertTrue(Lan.proofMatches(key, "pc", s("pcProof")))
        assertFalse(Lan.proofMatches(key, "phone", s("pcProof")))
        val sealed = v["sealed"]!!.jsonObject.let { Lan.Sealed(it["iv"]!!.jsonPrimitive.content, it["data"]!!.jsonPrimitive.content) }
        assertEquals(s("plaintext"), Lan.open(key, sealed, Lan.requestAad(s("deviceId"))))
        assertTrue(runCatching { Lan.open(key, sealed, Lan.responseAad(s("deviceId"))) }.isFailure)
        val wrong = Lan.deriveKey(priv, b64.decode(s("pcPub")), "000000", b64.decode(s("phonePub")), b64.decode(s("pcPub")))
        assertFalse(wrong.contentEquals(key))

        // a message for the desktop tests to open
        val plaintext = "{\"from\":\"android\",\"amount\":\"₹5,000\"}"
        val out = Lan.seal(key, plaintext, Lan.responseAad(s("deviceId")))
        File(dir, "lan-vector-android.json").writeText(buildJsonObject {
            put("key", s("key")); put("deviceId", s("deviceId")); put("plaintext", plaintext); put("phoneProof", Lan.proof(key, "phone"))
            put("sealed", buildJsonObject { put("iv", out.iv); put("data", out.data) })
        }.toString())
    }

    @Test fun pairingRoundTripInKotlin() {
        val phone = Lan.newKeyPair(); val pc = Lan.newKeyPair()
        val a = Lan.deriveKey(phone.private, pc.pub, "123456", phone.pub, pc.pub)
        val b = Lan.deriveKey(pc.private, phone.pub, "123456", phone.pub, pc.pub)
        assertArrayEquals(a, b)
        val sealed = Lan.seal(a, "hello", Lan.requestAad("d1"))
        assertEquals("hello", Lan.open(b, sealed, Lan.requestAad("d1")))
    }

    @Test fun hkdfMatchesRfc5869Case1() {
        val ikm = ByteArray(22) { 0x0b }
        val salt = ByteArray(13) { it.toByte() }
        val info = ByteArray(10) { (0xf0 + it).toByte() }
        val okm = Lan.hkdf(ikm, salt, info, 42).joinToString("") { "%02x".format(it) }
        assertEquals("3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865", okm)
    }

    @Test fun addresses() {
        assertEquals("192.168.1.50" to 47830, Lan.parseAddress(" 192.168.1.50 "))
        assertEquals("192.168.1.50" to 5000, Lan.parseAddress("192.168.1.50:5000"))
        assertEquals("my-pc" to 47830, Lan.parseAddress("http://my-pc/"))
        assertEquals("fe80::1" to 47830, Lan.parseAddress("[fe80::1]"))
        assertNull(Lan.parseAddress("192.168.1.2:99999"))
        assertNull(Lan.parseAddress("a b"))
        assertNull(Lan.parseAddress(""))
        for (a in listOf("192.168.1.20", "10.0.2.2", "172.16.0.5", "169.254.1.1", "127.0.0.1", "fd00::1", "fe80::1")) assertTrue(a, Lan.isLocalNetwork(InetAddress.getByName(a)))
        for (a in listOf("8.8.8.8", "172.32.0.1", "2001:4860::8888")) assertFalse(a, Lan.isLocalNetwork(InetAddress.getByName(a)))
    }
}
