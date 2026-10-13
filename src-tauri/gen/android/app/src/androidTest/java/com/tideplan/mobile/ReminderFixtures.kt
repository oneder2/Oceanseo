package com.tideplan.mobile

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.SecretKey

internal object ReminderFixtures {
    fun document(now: Long, space: JSONObject? = null): JSONObject {
        val modules = JSONObject()
        for (name in listOf("overview", "goals", "tasks", "calendar", "countdowns", "people", "infrastructure", "work-monitor", "bead-studio", "meal-planner", "shopping-list", "fitness", "travel")) {
            modules.put(name, JSONObject().put("visible", true).put("read", true).put("write", name == "tasks").put("ai", false))
        }
        return JSONObject().put("schemaVersion", 1).put("edition", "personal").put("environment", "preview")
            .put("workspaceId", space?.getString("id") ?: JSONObject.NULL).put("checkedAt", now)
            .put("role", "member").put("management", JSONObject().put("policies", false).put("cohorts", false))
            .put("policyRevisions", JSONArray()).put("modules", modules)
    }

    fun account(now: Long, space: JSONObject? = null): JSONObject = JSONObject()
        .put("endpoint", "https://example.invalid/v2").put("userId", UUID.randomUUID().toString()).put("username", "qa-reminder")
        .put("vaultId", UUID.randomUUID().toString()).put("sessionId", UUID.randomUUID().toString())
        .put("deviceName", "isolated reminder test").put("expiresAt", now + 3600).put("token", "q".repeat(43)).apply {
            if (space != null) put("workspace", space)
        }

    fun key(account: JSONObject): String {
        fun digest(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
        val legacy = digest("${account.getString("endpoint")}\n${account.getString("userId")}")
        val space = account.optJSONObject("workspace") ?: return legacy
        return digest("oceanseo-workspace-v1\n$legacy\n${space.getString("environment")}\n${space.getString("edition")}\n${space.getString("id")}")
    }

    fun cache(owner: String, now: Long, space: JSONObject? = null): JSONObject = JSONObject()
        .put("version", 1).put("profileKey", owner).put("fetchedAt", now).put("blocked", false).put("legacy", false)
        .put("document", document(now, space))

    fun encrypt(account: JSONObject): String {
        val key = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.getKey("tideplan.credentials.v1", null) as SecretKey
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key) }
        return "tideplan-keystore-v1:" + Base64.encodeToString(cipher.iv + cipher.doFinal(account.toString().toByteArray()), Base64.NO_WRAP)
    }
}
