package com.tideplan.mobile

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.tauri.plugin.JSObject
import java.util.Calendar
import java.util.TimeZone
import org.json.JSONArray

internal object Reminders {
    private const val CHANNEL = "tideplan.daily.v1"
    private const val ACTION = "com.tideplan.mobile.DAILY_REMINDER"
    private const val FIRST_ID = 9100
    private fun prefs(context: Context) = context.getSharedPreferences("tideplan-reminders", Context.MODE_PRIVATE)
    private fun manager(context: Context) = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    private fun times(context: Context) = prefs(context).getString("times", "")!!.split(',').filter { it.isNotEmpty() }
    private fun profile(context: Context) = prefs(context).getString("profileKey", "local")!!

    internal fun validProfile(key: String) = key == "local" || Regex("^[a-f0-9]{64}$").matches(key)
    internal fun receiptKey(key: String, slot: Int): String {
        require(validProfile(key) && slot in 0..1)
        // Preserve the original local-mode ledger, without sharing it with accounts.
        return if (key == "local") "last-$slot" else "last-$key-$slot"
    }

    fun permitted(context: Context): Boolean {
        val notifications = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        return (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            NotificationManagerCompat.from(context).areNotificationsEnabled() &&
            notifications.getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
    }

    private fun intent(context: Context, slot: Int): PendingIntent = PendingIntent.getBroadcast(
        context, FIRST_ID + slot,
        Intent(context, ReminderReceiver::class.java).setAction(ACTION).putExtra("slot", slot),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    internal fun nextTime(time: String, now: Calendar = Calendar.getInstance()): Long {
        val parts = time.split(':').map { it.toInt() }
        val next = (now.clone() as Calendar).apply {
            set(Calendar.HOUR_OF_DAY, parts[0]); set(Calendar.MINUTE, parts[1])
            set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
            if (timeInMillis <= now.timeInMillis) add(Calendar.DAY_OF_YEAR, 1)
        }
        return next.timeInMillis
    }

    internal fun restoredTime(time: String, saved: Long, now: Calendar = Calendar.getInstance()): Long {
        val candidate = (now.clone() as Calendar).apply { timeInMillis = saved }
        val parts = time.split(':').map { it.toInt() }
        val dueToday = saved > 0 && saved <= now.timeInMillis &&
            candidate.get(Calendar.YEAR) == now.get(Calendar.YEAR) &&
            candidate.get(Calendar.DAY_OF_YEAR) == now.get(Calendar.DAY_OF_YEAR) &&
            candidate.get(Calendar.HOUR_OF_DAY) == parts[0] && candidate.get(Calendar.MINUTE) == parts[1]
        return if (dueToday) saved else nextTime(time, now)
    }

    fun configure(context: Context, enabled: Boolean, times: List<String>, restore: Boolean = false, profileKey: String = profile(context)): JSObject {
        require(validProfile(profileKey))
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "每日计划提醒", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "按你设定的早晚时间，提醒查看计划与生活安排"
            lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
        })
        val changed = profile(context) != profileKey || prefs(context).getBoolean("enabled", false) != enabled || times(context) != times
        check(prefs(context).edit().putBoolean("enabled", enabled).putString("times", times.joinToString(",")).putString("profileKey", profileKey).commit())
        // Reopening the app must not discard an inexact alarm that is already
        // due but still waiting for Android's delivery window.
        if (restore || changed || !enabled || !permitted(context) || times.indices.any { prefs(context).getLong("next-$it", 0) == 0L }) {
            // Cold launch also restores alarms removed by force-stop. Keep a
            // pending slot from today, but never replay older days.
            reschedule(context, preservePending = restore && !changed)
        }
        return status(context)
    }

    fun status(context: Context): JSObject {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val allowed = permitted(context)
        val planned = if (allowed && prefs(context).getBoolean("enabled", false)) {
            times(context).indices.map { prefs(context).getLong("next-$it", 0) }.filter { it > 0 }
        } else emptyList()
        return JSObject().apply {
            put("permission", allowed)
            put("scheduled", planned.isNotEmpty())
            put("appNotifications", NotificationManagerCompat.from(context).areNotificationsEnabled())
            put("channelEnabled", nm.getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE)
            put("batteryOptimized", !power.isIgnoringBatteryOptimizations(context.packageName))
            put("powerSaveMode", power.isPowerSaveMode)
            put("nextTimes", JSONArray(planned))
            put("timeZone", TimeZone.getDefault().id)
            put("profileKey", profile(context))
        }
    }

    fun reschedule(context: Context, preservePending: Boolean = false) {
        val previous = (0..1).map { prefs(context).getLong("next-$it", 0) }
        for (slot in 0..1) manager(context).cancel(intent(context, slot))
        prefs(context).edit().remove("next-0").remove("next-1").apply()
        if (!prefs(context).getBoolean("enabled", false) || !permitted(context)) {
            for (slot in 0..1) NotificationManagerCompat.from(context).cancel(FIRST_ID + slot)
            return
        }
        times(context).take(2).forEachIndexed { slot, time ->
            // No exact-alarm special permission: allow Doze delivery, with an
            // explicitly disclosed system scheduling tolerance. Recalculate each
            // local calendar day rather than adding 24h (DST/timezone changes).
            val next = if (preservePending) restoredTime(time, previous[slot]) else nextTime(time)
            manager(context).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, intent(context, slot))
            prefs(context).edit().putLong("next-$slot", next).apply()
        }
    }

    fun receive(context: Context, intent: Intent) {
        if (intent.action != ACTION) { reschedule(context); return }
        val slot = intent.getIntExtra("slot", -1)
        val time = times(context).getOrNull(slot) ?: return
        if (!prefs(context).getBoolean("enabled", false) || !permitted(context)) return
        val now = Calendar.getInstance()
        val receipt = "${now.get(Calendar.YEAR)}-${now.get(Calendar.DAY_OF_YEAR)}:$time"
        try {
            if (prefs(context).getString(receiptKey(profile(context), slot), "") == receipt) return
            // A repeat/timezone broadcast must never become a burst of notifications.
            val parts = time.split(':').map { it.toInt() }
            if (now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE) < parts[0] * 60 + parts[1]) return
            val open = PendingIntent.getActivity(context, FIRST_ID + slot,
                Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val notification = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Oceanseo · $time 提醒")
                .setContentText("打开看看今天的任务、训练和关键日期，选择下一件值得完成的事。")
                .setContentIntent(open).setAutoCancel(true)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build()
            NotificationManagerCompat.from(context).notify(FIRST_ID + slot, notification)
            prefs(context).edit().putString(receiptKey(profile(context), slot), receipt).apply()
        } finally {
            reschedule(context)
        }
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        try { Reminders.receive(context, intent) }
        catch (_: SecurityException) { /* Permissions may be revoked between checks. */ }
    }
}
