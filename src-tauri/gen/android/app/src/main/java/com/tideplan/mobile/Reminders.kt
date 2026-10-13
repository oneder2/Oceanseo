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
import android.net.Uri
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
    // Android 16 tracks/rate-limits repeated notify/cancel calls per manager.
    // Use one application Context so receiver/activity instances agree about a
    // notification's last state and cannot discard a necessary cancellation.
    private fun notifications(context: Context) = context.applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    private fun notificationCompat(context: Context) = NotificationManagerCompat.from(context.applicationContext)
    private fun times(context: Context) = prefs(context).getString("times", "")!!.split(',').filter { it.isNotEmpty() }
    private fun profile(context: Context) = prefs(context).getString("profileKey", "local")!!

    internal fun validProfile(key: String) = key == "local" || Regex("^[a-f0-9]{64}$").matches(key)
    internal fun receiptKey(key: String, slot: Int): String {
        require(validProfile(key) && slot in 0..1)
        // Preserve the original local-mode ledger, without sharing it with accounts.
        return if (key == "local") "last-$slot" else "last-$key-$slot"
    }

    fun permitted(context: Context): Boolean {
        val notifications = notifications(context)
        return (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            notificationCompat(context).areNotificationsEnabled() &&
            notifications.getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
    }

    private fun intent(context: Context, slot: Int, owner: String = profile(context)): PendingIntent = PendingIntent.getBroadcast(
        context, FIRST_ID + slot,
        Intent(context, ReminderReceiver::class.java).setAction(ACTION)
            .setData(Uri.Builder().scheme("oceanseo-reminder").authority("daily").appendPath(owner).appendPath(slot.toString()).build())
            .putExtra("slot", slot).putExtra("profileKey", owner),
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
        val nm = notifications(context)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "每日计划提醒", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "按你设定的早晚时间，提醒查看计划与生活安排"
            lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
        })
        val previousOwner = profile(context)
        val changed = previousOwner != profileKey || prefs(context).getBoolean("enabled", false) != enabled || times(context) != times
        check(prefs(context).edit().putBoolean("enabled", enabled).putString("times", times.joinToString(",")).putString("profileKey", profileKey).commit())
        // Reopening the app must not discard an inexact alarm that is already
        // due but still waiting for Android's delivery window.
        if (restore || changed || !enabled || !permitted(context) || !ReminderAuthorization.allowed(context, profileKey) || times.indices.any { prefs(context).getLong("next-$it", 0) == 0L }) {
            // Cold launch also restores alarms removed by force-stop. Keep a
            // pending slot from today, but never replay older days.
            reschedule(context, preservePending = restore && !changed, previousOwner = previousOwner)
        }
        return status(context)
    }

    fun status(context: Context): JSObject {
        val nm = notifications(context)
        val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val allowed = permitted(context)
        val profileAllowed = ReminderAuthorization.allowed(context, profile(context))
        val planned = if (allowed && profileAllowed && prefs(context).getBoolean("enabled", false)) {
            times(context).indices.map { prefs(context).getLong("next-$it", 0) }.filter { it > 0 }
        } else emptyList()
        return JSObject().apply {
            put("permission", allowed)
            put("profileAllowed", profileAllowed)
            put("scheduled", planned.isNotEmpty())
            put("appNotifications", notificationCompat(context).areNotificationsEnabled())
            put("channelEnabled", nm.getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE)
            put("batteryOptimized", !power.isIgnoringBatteryOptimizations(context.packageName))
            put("powerSaveMode", power.isPowerSaveMode)
            put("nextTimes", JSONArray(planned))
            put("timeZone", TimeZone.getDefault().id)
            put("profileKey", profile(context))
        }
    }

    fun reschedule(context: Context, preservePending: Boolean = false, previousOwner: String = profile(context)) {
        val previous = (0..1).map { prefs(context).getLong("next-$it", 0) }
        for (slot in 0..1) {
            manager(context).cancel(intent(context, slot))
            if (previousOwner != profile(context)) manager(context).cancel(intent(context, slot, previousOwner))
            // Remove pre-owner-binding alarms on the first post-upgrade pass.
            manager(context).cancel(PendingIntent.getBroadcast(context, FIRST_ID + slot,
                Intent(context, ReminderReceiver::class.java).setAction(ACTION),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            if (previousOwner != profile(context)) notificationCompat(context).cancel(FIRST_ID + slot)
        }
        prefs(context).edit().remove("next-0").remove("next-1").apply()
        if (!prefs(context).getBoolean("enabled", false) || !permitted(context) || !ReminderAuthorization.allowed(context, profile(context))) {
            for (slot in 0..1) notificationCompat(context).cancel(FIRST_ID + slot)
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
        // Stale delivery must not cancel or change the next profile's alarms.
        val owner = intent.getStringExtra("profileKey") ?: return
        if (owner != profile(context) || !validProfile(owner)) return
        val slot = intent.getIntExtra("slot", -1)
        if (slot !in 0..1) return
        val time = times(context).getOrNull(slot) ?: return
        if (!prefs(context).getBoolean("enabled", false) || !permitted(context) || !ReminderAuthorization.allowed(context, owner)) {
            reschedule(context)
            return
        }
        val now = Calendar.getInstance()
        val receipt = "${now.get(Calendar.YEAR)}-${now.get(Calendar.DAY_OF_YEAR)}:$time"
        try {
            if (prefs(context).getString(receiptKey(owner, slot), "") == receipt) return
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
            if (profile(context) != owner || !ReminderAuthorization.allowed(context, owner)) return
            notificationCompat(context).notify(FIRST_ID + slot, notification)
            prefs(context).edit().putString(receiptKey(owner, slot), receipt).apply()
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
