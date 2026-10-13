package com.tideplan.mobile

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

// The host harness kills the target process after prepare, then waits for an
// actual AlarmManager delivery before starting verify or restore instrumentation.
@RunWith(AndroidJUnit4::class)
class ReminderColdStartTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val root get() = File(context.applicationInfo.dataDir)
    private val stateFile get() = File(context.cacheDir, "qa-reminder-cold.json")
    private val prefs get() = context.getSharedPreferences("tideplan-reminders", Context.MODE_PRIVATE)
    private val notifications get() = context.applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    @Test fun coldAlarmPhase() {
        val args = InstrumentationRegistry.getArguments()
        val phase = args.getString("qaColdPhase")
        assumeTrue(phase != null)
        assertEquals("com.tideplan.mobile.uiuxqa", context.packageName)
        assertTrue(Build.HARDWARE in listOf("ranchu", "goldfish"))
        when (phase) {
            "prepare" -> prepare(args.getString("qaColdMode")!!)
            "verify" -> verify()
            "restore" -> restore()
            else -> error("Unsupported cold-alarm phase")
        }
    }

    private fun pending(owner: String) = PendingIntent.getBroadcast(context, 9100,
        Intent(context, ReminderReceiver::class.java).setAction("com.tideplan.mobile.DAILY_REMINDER")
            .setData(Uri.Builder().scheme("oceanseo-reminder").authority("daily").appendPath(owner).appendPath("0").build())
            .putExtra("slot", 0).putExtra("profileKey", owner), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun prepare(mode: String) {
        require(mode in listOf("account", "revoked", "switch"))
        check(!stateFile.exists())
        assertTrue(notifications.activeNotifications.none { it.id in 9100..9101 })
        val now = System.currentTimeMillis() / 1000
        val account = ReminderFixtures.account(now)
        val owner = ReminderFixtures.key(account)
        val directory = File(root, "profiles/$owner")
        check(!directory.exists())
        val before = JSONObject()
        prefs.all.forEach { (key, value) ->
            require(value is String || value is Boolean || value is Long || value is Int || value is Float)
            before.put(key, JSONObject().put("type", value!!.javaClass.simpleName).put("value", value))
        }
        val selection = File(root, "profile-selection.json")
        val due = System.currentTimeMillis() + 20_000
        val state = JSONObject().put("version", 1).put("owner", owner).put("mode", mode).put("due", due)
            .put("prefs", before).put("selection", if (selection.exists()) Base64.encodeToString(selection.readBytes(), Base64.NO_WRAP) else JSONObject.NULL)
        stateFile.writeText(state.toString())
        check(directory.mkdirs())
        File(directory, "account-session.json").writeText(ReminderFixtures.encrypt(account))
        val cache = ReminderFixtures.cache(owner, now)
        val policyFile = File(directory, "module-capabilities.json")
        policyFile.writeText(cache.toString())
        selection.writeText(JSONObject().put("version", 1).put("key", owner).toString())
        assertTrue(Reminders.configure(context, true, listOf("00:00"), profileKey = owner).getBoolean("scheduled"))
        prefs.edit().putLong("next-0", due).commit()
        (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager)
            .setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, due, pending(owner))
        // Withdraw authorization only after Android has accepted the alarm.
        if (mode == "revoked") policyFile.writeText(cache.put("blocked", true).toString())
        if (mode == "switch") selection.writeText("{\"version\":1,\"key\":\"local\"}")
    }

    private fun verify() {
        val state = JSONObject(stateFile.readText())
        val owner = state.getString("owner")
        if (state.getString("mode") == "account") {
            assertTrue(prefs.contains(Reminders.receiptKey(owner, 0)))
            assertTrue(notifications.activeNotifications.any { it.id == 9100 })
            assertTrue(prefs.getLong("next-0", 0) > state.getLong("due"))
        } else {
            assertFalse(prefs.contains(Reminders.receiptKey(owner, 0)))
            assertFalse(prefs.contains("next-0")) // The OS receiver ran and cancelled scheduling.
            assertTrue(notifications.activeNotifications.none { it.id == 9100 })
        }
    }

    private fun restore() {
        val state = JSONObject(stateFile.readText())
        require(state.getInt("version") == 1)
        val owner = state.getString("owner")
        require(owner.matches(Regex("^[a-f0-9]{64}$")))
        (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(pending(owner))
        val selection = File(root, "profile-selection.json")
        if (state.isNull("selection")) selection.delete() else selection.writeBytes(Base64.decode(state.getString("selection"), Base64.NO_WRAP))
        val edit = prefs.edit().clear()
        val previous = state.getJSONObject("prefs")
        previous.keys().forEach { key ->
            val field = previous.getJSONObject(key)
            when (field.getString("type")) {
                "String" -> edit.putString(key, field.getString("value"))
                "Boolean" -> edit.putBoolean(key, field.getBoolean("value"))
                "Long" -> edit.putLong(key, field.getLong("value"))
                "Integer" -> edit.putInt(key, field.getInt("value"))
                "Float" -> edit.putFloat(key, field.getDouble("value").toFloat())
                else -> error("Unknown saved preference type")
            }
        }
        check(edit.commit())
        notifications.cancel(9100); notifications.cancel(9101)
        check(File(root, "profiles/$owner").deleteRecursively())
        check(stateFile.delete())
        Reminders.reschedule(context)
        val deadline = System.currentTimeMillis() + 3000
        while (System.currentTimeMillis() < deadline && notifications.activeNotifications.any { it.id in 9100..9101 }) Thread.sleep(25)
        assertTrue(notifications.activeNotifications.none { it.id in 9100..9101 })
    }
}
