package com.tideplan.mobile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import app.tauri.plugin.JSObject
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class ReminderArgs {
    var enabled: Boolean = false
    var times: List<String> = emptyList()
    lateinit var profileKey: String
}

@InvokeArg
class CredentialArgs { lateinit var value: String }

@InvokeArg
class SystemSettingsArgs { lateinit var destination: String }

@InvokeArg
class ShareListArgs {
    lateinit var format: String
    lateinit var content: String
}

@TauriPlugin
class MobilePlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun restartForProfile(invoke: Invoke) {
        activity.runOnUiThread {
            try {
                // Stop the previous profile's OS schedule before the process changes.
                Reminders.configure(activity, false, emptyList())
                val intent = Intent(activity, ProfileRestartActivity::class.java)
                    .putExtra("previousPid", android.os.Process.myPid())
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
                activity.startActivity(intent)
                invoke.resolve()
            } catch (_: Exception) {
                invoke.reject("资料库已选定，请完全关闭后重新打开应用")
            }
        }
    }

    @Command
    fun openHostUrl(invoke: Invoke) {
        try {
            val value = invoke.parseArgs(CredentialArgs::class.java).value
            val uri = Uri.parse(value)
            require(value.length <= 2000 && uri.scheme in listOf("https", "http") && !uri.host.isNullOrBlank() && uri.userInfo == null)
            activity.runOnUiThread {
                try { activity.startActivity(Intent(Intent.ACTION_VIEW, uri)); invoke.resolve() }
                catch (_: Exception) { invoke.reject("无法打开系统浏览器") }
            }
        } catch (_: Exception) { invoke.reject("网址无效") }
    }
    private var remindersInitialized = false
    @Command
    fun reminderStatus(invoke: Invoke) {
        try { invoke.resolve(Reminders.status(activity)) }
        catch (_: Exception) { invoke.reject("无法读取系统提醒状态，请重试。") }
    }

    @Command
    fun openReminderSettings(invoke: Invoke) {
        try {
            val destination = invoke.parseArgs(SystemSettingsArgs::class.java).destination
            val target = when (destination) {
                "notifications" -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
                "channel" -> Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName).putExtra(Settings.EXTRA_CHANNEL_ID, "tideplan.daily.v1")
                "battery" -> Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                else -> throw IllegalArgumentException()
            }
            activity.runOnUiThread {
                try {
                    try { activity.startActivity(target) }
                    catch (_: android.content.ActivityNotFoundException) {
                        activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${activity.packageName}")))
                    }
                    invoke.resolve()
                } catch (_: Exception) { invoke.reject("无法打开系统设置，请从 Android 设置中找到潮汐计划。") }
            }
        } catch (_: Exception) { invoke.reject("无法打开系统设置。") }
    }

    @Command
    fun shareShoppingList(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(ShareListArgs::class.java)
            val chooser = ShoppingShare.prepare(activity, args.format, args.content)
            activity.runOnUiThread {
                try { activity.startActivity(chooser); invoke.resolve() }
                catch (_: Exception) { invoke.reject("无法打开系统分享，请使用“导出到…”保存文件。") }
            }
        } catch (_: Exception) { invoke.reject("无法准备分享文件，请减少清单内容或使用导出。") }
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val alias = "tideplan.credentials.v1"
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build())
        }.generateKey()
    }

    @Command
    fun encryptCredential(invoke: Invoke) {
        try {
            val value = invoke.parseArgs(CredentialArgs::class.java).value
            require(value.length <= 16384)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
            val bytes = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
            invoke.resolve(JSObject().apply { put("value", "tideplan-keystore-v1:" + Base64.encodeToString(bytes, Base64.NO_WRAP)) })
        } catch (_: Exception) { invoke.reject("安全存储加密失败") }
    }

    @Command
    fun decryptCredential(invoke: Invoke) {
        try {
            val value = invoke.parseArgs(CredentialArgs::class.java).value
            require(value.startsWith("tideplan-keystore-v1:") && value.length <= 32768)
            val bytes = Base64.decode(value.removePrefix("tideplan-keystore-v1:"), Base64.NO_WRAP)
            require(bytes.size > 28)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12))) }
            invoke.resolve(JSObject().apply { put("value", String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)) })
        } catch (_: Exception) { invoke.reject("安全存储解密失败；原配置未修改") }
    }

    @Command
    fun configureReminders(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(ReminderArgs::class.java)
            require(args.times.size <= 2 && args.times.all { Regex("^([01][0-9]|2[0-3]):[0-5][0-9]$").matches(it) })
            val status = Reminders.configure(activity, args.enabled, args.times.distinct().sorted(), restore = !remindersInitialized, profileKey = args.profileKey)
            remindersInitialized = true
            invoke.resolve(status)
        } catch (_: Exception) {
            invoke.reject("无法安排系统提醒，请检查通知权限后重试。")
        }
    }
}
