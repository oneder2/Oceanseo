package com.tideplan.mobile

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.MessageDigest
import java.util.UUID

// Explicit opt-in; never edits a daily installation or an existing profile.
@RunWith(AndroidJUnit4::class)
class ReminderAuthorizationTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private val prefs get() = context.getSharedPreferences("tideplan-reminders", Context.MODE_PRIVATE)
    private val notifications get() = context.applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    private val root get() = File(context.applicationInfo.dataDir)
    private val selection get() = File(root, "profile-selection.json")

    private fun isolated(block: () -> Unit) {
        assumeTrue(InstrumentationRegistry.getArguments().getString("qaReminderPolicy") == "true")
        assertEquals("com.tideplan.mobile.uiuxqa", context.packageName)
        assertTrue(Build.HARDWARE in listOf("ranchu", "goldfish"))
        assertTrue("An existing test notification must not be overwritten", notifications.activeNotifications.none { it.id in 9100..9101 })
        val previousSelection = if (selection.exists()) selection.readBytes() else null
        val previousPrefs = prefs.all.toMap()
        try { block() } finally {
            if (previousSelection == null) selection.delete() else selection.writeBytes(previousSelection)
            val edit = prefs.edit().clear()
            previousPrefs.forEach { (key, value) -> when (value) {
                is String -> edit.putString(key, value)
                is Boolean -> edit.putBoolean(key, value)
                is Long -> edit.putLong(key, value)
                is Int -> edit.putInt(key, value)
                is Float -> edit.putFloat(key, value)
            } }
            check(edit.commit())
            notifications.cancel(9100); notifications.cancel(9101)
            Reminders.reschedule(context)
            // Notification cancellation is asynchronous in the OS service.
            val deadline = System.currentTimeMillis() + 3000
            while (System.currentTimeMillis() < deadline && notifications.activeNotifications.any { it.id in 9100..9101 }) Thread.sleep(25)
            assertTrue("Own test notifications were not cancelled: " + notifications.activeNotifications.joinToString { "${it.packageName}:${it.id}:${it.tag}" }, notifications.activeNotifications.none { it.id in 9100..9101 })
        }
    }

    private fun select(key: String) = selection.writeText(JSONObject().put("version", 1).put("key", key).toString())

    private fun alarm(owner: String? = null): Intent = Intent(context, ReminderReceiver::class.java)
        .setAction("com.tideplan.mobile.DAILY_REMINDER").putExtra("slot", 0).apply {
            if (owner != null) putExtra("profileKey", owner)
        }

    private fun receive(intent: Intent) = instrumentation.runOnMainSync { ReminderReceiver().onReceive(context, intent) }

    @Test fun encryptedAccountRevocationLogoutExpiryAndDamagedCachePauseColdReceiver() = isolated {
        val now = System.currentTimeMillis() / 1000
        val user = UUID.randomUUID().toString()
        val endpoint = "https://example.invalid/v2"
        val owner = MessageDigest.getInstance("SHA-256").digest("$endpoint\n$user".toByteArray()).joinToString("") { "%02x".format(it) }
        val directory = File(root, "profiles/$owner")
        check(!directory.exists() && directory.mkdirs())
        val account = JSONObject().put("endpoint", endpoint).put("userId", user).put("username", "qa-reminder")
            .put("vaultId", UUID.randomUUID().toString()).put("sessionId", UUID.randomUUID().toString())
            .put("deviceName", "isolated reminder test").put("expiresAt", now - 1).put("token", "q".repeat(43))
        val doc = ReminderFixtures.document(now)
        val cache = JSONObject().put("version", 1).put("profileKey", owner).put("fetchedAt", now)
            .put("blocked", false).put("legacy", false).put("document", doc)
        fun saveCache() = File(directory, "module-capabilities.json").writeText(cache.toString())
        fun saveAccount() = File(directory, "account-session.json").writeText(ReminderFixtures.encrypt(account))
        fun assertPaused() {
            assertFalse(ReminderAuthorization.allowed(context, owner))
            receive(alarm(owner))
            assertFalse(Reminders.status(context).getBoolean("scheduled"))
            assertFalse(prefs.contains(Reminders.receiptKey(owner, 0)))
            assertTrue(notifications.activeNotifications.none { it.id == 9100 })
        }
        try {
            select(owner); saveAccount(); saveCache()
            // Session expiry does not override a valid local offline grant.
            assertTrue(ReminderAuthorization.allowed(context, owner))
            assertTrue(Reminders.configure(context, true, listOf("00:00"), profileKey = owner).getBoolean("scheduled"))
            cache.put("blocked", true); saveCache(); assertPaused()
            cache.put("blocked", false); saveCache()
            account.put("token", ""); saveAccount(); assertPaused()
            account.put("token", "q".repeat(43)); saveAccount()
            cache.put("fetchedAt", now - 86_401); saveCache(); assertPaused()
            // Keep outside the five-minute clock tolerance throughout the test.
            cache.put("fetchedAt", now + 600); saveCache(); assertPaused()
            cache.put("fetchedAt", now).put("profileKey", "f".repeat(64)); saveCache(); assertPaused()
            cache.put("profileKey", owner); saveCache()
            doc.getJSONObject("modules").getJSONObject("tasks").put("write", "true"); saveCache(); assertPaused()
            doc.getJSONObject("modules").getJSONObject("tasks").put("write", true)
            doc.getJSONObject("modules").remove("travel"); saveCache(); assertPaused()
            doc.getJSONObject("modules").put("travel", ReminderFixtures.document(now).getJSONObject("modules").getJSONObject("travel"))
            doc.put("unknownField", true); saveCache(); assertPaused()
            doc.remove("unknownField")
            cache.put("version", 1.5); saveCache(); assertPaused()
            cache.put("version", 1)
            doc.getJSONObject("management").put("policies", true); saveCache(); assertPaused()
            doc.getJSONObject("management").put("policies", false)
            doc.getJSONObject("modules").getJSONObject("tasks").put("write", false); saveCache(); assertPaused()
            doc.getJSONObject("modules").getJSONObject("tasks").put("write", true)
            doc.put("edition", "commercial-beads"); saveCache(); assertPaused()
            doc.put("edition", "personal"); saveCache()
            File(directory, "module-capabilities.json").writeText("broken"); assertPaused()
            saveCache()
            account.put("userId", UUID.randomUUID().toString()); saveAccount(); assertPaused()
            account.put("userId", user); saveAccount()
            assertTrue(Reminders.configure(context, true, listOf("00:00"), profileKey = owner).getBoolean("scheduled"))
            context.sendBroadcast(alarm(owner))
            val deadline = System.currentTimeMillis() + 4000
            while (System.currentTimeMillis() < deadline && notifications.activeNotifications.none { it.id == 9100 }) Thread.sleep(25)
            assertTrue("Manifest receiver must deliver an authorized reminder", notifications.activeNotifications.any { it.id == 9100 })
            assertTrue(prefs.contains(Reminders.receiptKey(owner, 0)))
            receive(alarm(owner))
            assertEquals(1, notifications.activeNotifications.count { it.id == 9100 })
        } finally { check(directory.deleteRecursively()) }
    }

    @Test fun staleOwnersAndUnboundOldAlarmsCannotTouchNewLocalSchedule() = isolated {
        select("local")
        prefs.edit().remove("last-0").commit()
        assertTrue(Reminders.configure(context, true, listOf("00:00"), profileKey = "local").getBoolean("scheduled"))
        val next = prefs.getLong("next-0", 0)
        receive(alarm("a".repeat(64))); receive(alarm())
        assertEquals(next, prefs.getLong("next-0", 0))
        assertFalse(prefs.contains("last-0"))
        assertTrue(notifications.activeNotifications.none { it.id == 9100 })
        select("b".repeat(64))
        // App never reopened: the OS boot receiver still rejects the old owner.
        receive(Intent(context, ReminderReceiver::class.java).setAction(Intent.ACTION_BOOT_COMPLETED))
        assertFalse(Reminders.status(context).getBoolean("scheduled"))
        select("local")
        receive(Intent(context, ReminderReceiver::class.java).setAction(Intent.ACTION_TIMEZONE_CHANGED))
        assertTrue(Reminders.status(context).getBoolean("scheduled"))
        receive(alarm("local"))
        assertTrue(notifications.activeNotifications.any { it.id == 9100 })
        assertTrue(prefs.contains("last-0"))
    }

    @Test fun missingLocalSelectionRemainsCompatibleButDamagedSelectionFailsClosed() = isolated {
        selection.delete()
        assertTrue(ReminderAuthorization.allowed(context, "local"))
        selection.writeText("broken")
        assertFalse(ReminderAuthorization.allowed(context, "local"))
        selection.writeText("{\"version\":2,\"key\":\"local\"}")
        assertFalse(ReminderAuthorization.allowed(context, "local"))
        select("local")
        assertFalse(ReminderAuthorization.allowed(context, "../local"))
        assertFalse(ReminderAuthorization.allowed(context, "a".repeat(64)))
    }

    @Test fun workspaceSourceAndLegacyCacheCannotSubstituteEachOther() = isolated {
        val now = System.currentTimeMillis() / 1000
        val space = JSONObject().put("version", 1).put("environment", "preview").put("edition", "personal")
            .put("id", UUID.randomUUID().toString()).put("vaultId", UUID.randomUUID().toString())
        val account = ReminderFixtures.account(now, space)
        val owner = ReminderFixtures.key(account)
        val directory = File(root, "profiles/$owner")
        check(!directory.exists() && directory.mkdirs())
        val cache = ReminderFixtures.cache(owner, now, space)
        fun save() {
            File(directory, "account-session.json").writeText(ReminderFixtures.encrypt(account))
            File(directory, "module-capabilities.json").writeText(cache.toString())
        }
        try {
            select(owner); save()
            assertTrue(ReminderAuthorization.allowed(context, owner))
            cache.getJSONObject("document").put("environment", "live"); save()
            assertFalse(ReminderAuthorization.allowed(context, owner))
            cache.getJSONObject("document").put("environment", "preview").put("workspaceId", UUID.randomUUID().toString()); save()
            assertFalse(ReminderAuthorization.allowed(context, owner))
            cache.put("document", JSONObject.NULL).put("legacy", true); save()
            assertFalse(ReminderAuthorization.allowed(context, owner))
            account.remove("workspace")
            val legacyOwner = ReminderFixtures.key(account)
            val legacyDirectory = File(root, "profiles/$legacyOwner")
            check(!legacyDirectory.exists() && legacyDirectory.mkdirs())
            try {
                select(legacyOwner)
                File(legacyDirectory, "account-session.json").writeText(ReminderFixtures.encrypt(account))
                cache.put("profileKey", legacyOwner)
                File(legacyDirectory, "module-capabilities.json").writeText(cache.toString())
                assertTrue(ReminderAuthorization.allowed(context, legacyOwner))
            } finally { check(legacyDirectory.deleteRecursively()) }
        } finally { check(directory.deleteRecursively()) }
    }
}
