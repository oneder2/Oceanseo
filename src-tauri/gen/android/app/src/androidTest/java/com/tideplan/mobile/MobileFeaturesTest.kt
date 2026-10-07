package com.tideplan.mobile

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

// Run only on an isolated QA installation: reminder tests temporarily change its
// schedule. The previous preference values are restored after each test.
@RunWith(AndroidJUnit4::class)
class MobileFeaturesTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun sharingCreatesReadableScopedUriAndPreservesEarlierShare() {
        val content = "物品,数量,来源\n鸡蛋,6 个,AI 食谱\n"
        val chooser = ShoppingShare.prepare(context, "csv", content)
        assertEquals(Intent.ACTION_CHOOSER, chooser.action)
        @Suppress("DEPRECATION")
        val send = chooser.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)!!
        assertEquals(Intent.ACTION_SEND, send.action)
        assertEquals("text/csv", send.type)
        @Suppress("DEPRECATION")
        val uri = send.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)!!
        assertEquals("content", uri.scheme)
        assertEquals("${context.packageName}.shopping-share", uri.authority)
        assertTrue(send.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
        assertEquals(uri, send.clipData!!.getItemAt(0).uri)
        ShoppingShare.prepare(context, "markdown", "# 另一次分享")
        assertEquals(content, context.contentResolver.openInputStream(uri)!!.bufferedReader().use { it.readText() })
        assertThrows(IllegalArgumentException::class.java) {
            FileProvider.getUriForFile(context, "${context.packageName}.shopping-share", File(context.filesDir, "private.json"))
        }
        assertThrows(IllegalArgumentException::class.java) { ShoppingShare.prepare(context, "../../bad", content) }
        assertThrows(IllegalArgumentException::class.java) { ShoppingShare.prepare(context, "csv", "a".repeat(2 * 1024 * 1024 + 1)) }
    }

    @Test fun returningToAppPreservesPendingDeliveryAndDisablingClearsSchedule() {
        val prefs = context.getSharedPreferences("tideplan-reminders", Context.MODE_PRIVATE)
        val previous = prefs.all.toMap()
        try {
            val status = Reminders.configure(context, true, listOf("09:00", "19:00"))
            assertTrue("Grant notification permission on the QA device first", status.getBoolean("permission"))
            // Model an alarm waiting in Android's inexact delivery window.
            val due = System.currentTimeMillis() - 60_000
            prefs.edit().putLong("next-0", due).commit()
            val resumed = Reminders.configure(context, true, listOf("09:00", "19:00"))
            assertEquals(due, resumed.getJSONArray("nextTimes").getLong(0))
            assertTrue(resumed.getBoolean("scheduled"))
            val disabled = Reminders.configure(context, false, listOf("09:00", "19:00"))
            assertFalse(disabled.getBoolean("scheduled"))
            assertEquals(0, disabled.getJSONArray("nextTimes").length())
            assertFalse(prefs.contains("next-0"))
        } finally {
            val edit = prefs.edit().clear()
            previous.forEach { (key, value) -> when (value) {
                is String -> edit.putString(key, value)
                is Boolean -> edit.putBoolean(key, value)
                is Long -> edit.putLong(key, value)
                is Int -> edit.putInt(key, value)
            } }
            edit.commit()
            Reminders.reschedule(context)
        }
    }
}
