package com.tideplan.mobile

import android.os.Build
import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// Read-only compatibility check, explicitly invoked on the disposable emulator.
// It never exports a key or reads an arbitrary profile supplied by an app user.
@RunWith(AndroidJUnit4::class)
class MobileUpgradeCredentialTest {
    @Test fun originalSyntheticCredentialsDecryptAfterInPlaceUpgrade() {
        val args = InstrumentationRegistry.getArguments()
        val profile = args.getString("qaProfile")
        assumeTrue("Requires the explicit isolated upgrade harness", profile != null)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assertEquals("com.tideplan.mobile.debug", context.packageName)
        assertTrue("Only the disposable emulator is supported", Build.HARDWARE in listOf("ranchu", "goldfish"))
        require(profile!!.matches(Regex("local|[a-f0-9]{64}")))
        val root = File(context.applicationInfo.dataDir)
        assertEquals(profile, JSONObject(File(root, "profile-selection.json").readText()).getString("key"))
        val directory = if (profile == "local") root else File(root, "profiles/$profile")
        val key = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            .getKey("tideplan.credentials.v1", null) as SecretKey
        fun readCredential(name: String): String {
            val raw = File(directory, name).readText()
            assertTrue(raw.startsWith("tideplan-keystore-v1:"))
            assertFalse(raw.contains("Synthetic-upgrade"))
            val bytes = Base64.decode(raw.removePrefix("tideplan-keystore-v1:"), Base64.NO_WRAP)
            require(bytes.size > 28)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            }
            return String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
        }
        val kind = if (profile == "local") "local" else "account"
        val ai = JSONObject(readCredential("ai-settings.json"))
        assertEquals("Synthetic-upgrade-ai-$kind-key", ai.getString("apiKey"))
        assertEquals("synthetic-$kind-model", ai.getString("model"))
        assertEquals("https://example.invalid/v1", ai.getString("baseUrl"))
        assertEquals("Synthetic-upgrade-map-$kind-key", JSONTokener(readCredential("map-settings.json")).nextValue())
        if (profile != "local") {
            val account = JSONObject(readCredential("account-session.json"))
            assertEquals("qa-owner", account.getString("username"))
            assertTrue(account.getString("endpoint").matches(Regex("http://127\\.0\\.0\\.1:[0-9]+")))
            assertFalse(account.getString("token").isEmpty())
        }
    }
}
