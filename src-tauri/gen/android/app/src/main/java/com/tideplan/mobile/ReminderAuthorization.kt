package com.tideplan.mobile

import android.content.Context
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.net.URI
import java.nio.file.Files
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// A cold BroadcastReceiver has no Rust runtime. Read the same persisted source
// and 24-hour offline policy as capabilities.rs; never create a credential key
// or grant a new permit merely because an alarm was previously scheduled.
internal object ReminderAuthorization {
    private fun read(root: File, path: String, limit: Long): String {
        val file = File(root.canonicalFile, path)
        require(file.canonicalFile == file && file.isFile && file.length() in 1..limit)
        return file.readText()
    }

    private fun JSONObject.fields(required: Set<String>, optional: Set<String> = emptySet()) {
        val actual = keys().asSequence().toSet()
        require(actual.containsAll(required) && actual.all { it in required || it in optional })
    }
    private fun JSONObject.text(name: String) = get(name) as? String ?: error("Invalid string")
    private fun JSONObject.flag(name: String) = get(name) as? Boolean ?: error("Invalid boolean")
    private fun JSONObject.integer(name: String): Long = when (val value = get(name)) {
        is Long -> value
        is Int -> value.toLong()
        else -> error("Invalid integer")
    }

    private fun validateDocument(doc: JSONObject, space: JSONObject?, now: Long): Boolean {
        doc.fields(setOf("schemaVersion", "environment", "edition", "role", "modules", "management", "policyRevisions", "checkedAt"), setOf("workspaceId"))
        require(doc.integer("schemaVersion") == 1L && doc.text("edition") == "personal")
        require(doc.text("environment") in listOf("preview", "live"))
        require(doc.integer("checkedAt") > 0 && doc.integer("checkedAt") <= now + 300)
        if (space == null) require(doc.isNull("workspaceId")) else {
            require(doc.text("workspaceId") == space.text("id") && doc.text("environment") == space.text("environment"))
        }
        val role = doc.text("role")
        require(role in listOf("member", "operator", "owner"))
        val management = doc.getJSONObject("management")
        management.fields(setOf("policies", "cohorts"))
        require(management.flag("policies") == (role != "member") && management.flag("cohorts") == (role == "owner"))
        val revisions = doc.getJSONArray("policyRevisions")
        require(revisions.length() <= 1024)
        for (index in 0 until revisions.length()) {
            val revision = revisions.getJSONObject(index)
            revision.fields(setOf("scope", "subject", "revision"))
            require(revision.text("scope") in listOf("edition", "cohort", "user"))
            require(revision.text("subject").toByteArray(Charsets.UTF_8).size in 1..80)
            require(revision.integer("revision") in 1..9_007_199_254_740_991L)
        }
        val modules = doc.getJSONObject("modules")
        modules.fields(setOf("overview", "goals", "tasks", "calendar", "countdowns", "people", "infrastructure", "work-monitor", "bead-studio", "meal-planner", "shopping-list", "fitness", "travel"))
        modules.keys().forEach { name ->
            val actions = modules.getJSONObject(name)
            actions.fields(setOf("visible", "read", "write", "ai"))
            actions.flag("visible")
            require(actions.flag("read") || !(actions.flag("write") || actions.flag("ai")))
            // Validate even the fields on a module which is not read-enabled.
            actions.flag("write"); actions.flag("ai")
        }
        val tasks = modules.getJSONObject("tasks")
        if (!tasks.flag("write")) require(listOf("goals", "calendar", "overview").all {
            val actions = modules.getJSONObject(it)
            !actions.flag("write") && !actions.flag("ai")
        })
        return tasks.flag("read") && tasks.flag("write")
    }

    private fun digest(text: String) = MessageDigest.getInstance("SHA-256")
        .digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    private fun canonicalId(id: String): String {
        require(UUID.fromString(id).toString() == id)
        return id
    }

    private fun decode(raw: String): String {
        if (!raw.startsWith("tideplan-keystore-v1:")) return raw // Historical plaintext compatibility.
        val bytes = Base64.decode(raw.removePrefix("tideplan-keystore-v1:"), Base64.NO_WRAP)
        require(bytes.size > 28)
        val key = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            .getKey("tideplan.credentials.v1", null) as? SecretKey ?: error("No existing credential key")
        return String(Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        }.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
    }

    fun allowed(context: Context, owner: String, now: Long = System.currentTimeMillis() / 1000): Boolean = try {
        require(Reminders.validProfile(owner))
        val root = File(context.applicationInfo.dataDir).canonicalFile
        val selectionFile = File(root, "profile-selection.json")
        val selected = if (!selectionFile.exists() && !Files.isSymbolicLink(selectionFile.toPath())) "local" else {
            val selection = JSONObject(read(root, "profile-selection.json", 4096))
            selection.fields(setOf("version", "key"))
            require(selection.integer("version") == 1L)
            selection.text("key")
        }
        require(selected == owner)
        if (owner == "local") true else {
            val account = JSONObject(decode(read(root, "profiles/$owner/account-session.json", 32768)))
            account.fields(setOf("endpoint", "userId", "username", "vaultId", "sessionId", "expiresAt", "deviceName", "token"), setOf("workspace"))
            val endpoint = account.text("endpoint")
            val uri = URI(endpoint)
            require(endpoint.toByteArray(Charsets.UTF_8).size <= 2000 && endpoint == endpoint.trim() && !endpoint.endsWith('/'))
            require(!uri.host.isNullOrEmpty() && uri.host == uri.host.lowercase() && uri.userInfo == null && uri.query == null && uri.fragment == null)
            require(uri.scheme == "https" || (uri.scheme == "http" && uri.host in listOf("localhost", "127.0.0.1", "[::1]")))
            UUID.fromString(account.text("vaultId")); UUID.fromString(account.text("sessionId"))
            require(Regex("^[a-z0-9][a-z0-9_.-]{2,63}$").matches(account.text("username")))
            val device = account.text("deviceName")
            require(device.trim().isNotEmpty() && device.codePointCount(0, device.length) <= 80 && device.none { Character.isISOControl(it) })
            val legacy = digest("$endpoint\n${canonicalId(account.text("userId"))}")
            require(!account.has("workspace") || account.isNull("workspace") || account.get("workspace") is JSONObject)
            val space = account.optJSONObject("workspace")
            val expected = if (space == null) legacy else {
                space.fields(setOf("version", "environment", "edition", "id", "vaultId"))
                require(space.integer("version") == 1L && space.text("environment") in listOf("preview", "live"))
                require(space.text("edition") == "personal")
                require(canonicalId(space.text("vaultId")) != account.text("vaultId"))
                digest("oceanseo-workspace-v1\n$legacy\n${space.text("environment")}\n${space.text("edition")}\n${canonicalId(space.text("id"))}")
            }
            require(expected == owner && Regex("^[A-Za-z0-9_-]{43}$").matches(account.text("token")))
            // Match local cached editing: an expired online session may retain
            // a valid offline grant, but logout (empty token) never does.
            require(account.integer("expiresAt") > 0)
            val cache = JSONObject(read(root, "profiles/$owner/module-capabilities.json", 65536))
            cache.fields(setOf("version", "profileKey", "fetchedAt", "legacy", "blocked"), setOf("document"))
            require(cache.integer("version") == 1L && cache.text("profileKey") == owner && !cache.flag("blocked"))
            val fetched = cache.integer("fetchedAt")
            require(fetched > 0 && now - fetched in -300L..86_400L)
            if (cache.flag("legacy")) {
                require(space == null && cache.isNull("document"))
                true
            } else {
                validateDocument(cache.getJSONObject("document"), space, now)
            }
        }
    } catch (_: Exception) {
        // Damaged cache, inaccessible Keystore or changed selection: pause.
        // Never include account contents or ciphertext in logs.
        false
    }
}
