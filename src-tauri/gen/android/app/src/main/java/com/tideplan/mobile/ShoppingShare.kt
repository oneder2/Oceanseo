package com.tideplan.mobile

import android.content.ClipData
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File
import java.util.UUID

// A dedicated provider exposes only disposable shopping-list exports.
class ShoppingShareProvider : FileProvider()

internal object ShoppingShare {
    internal fun mime(format: String): String = when (format) {
        "csv" -> "text/csv"
        "markdown" -> "text/markdown"
        else -> throw IllegalArgumentException("Unsupported format")
    }

    fun prepare(context: Context, format: String, content: String): Intent {
        val type = mime(format)
        val bytes = content.toByteArray(Charsets.UTF_8)
        require(bytes.isNotEmpty() && bytes.size <= 2 * 1024 * 1024)
        val directory = File(context.cacheDir, "shopping-shares").apply { mkdirs() }
        // Keep recent files alive for receiving apps. Never sweep other caches.
        val cutoff = System.currentTimeMillis() - 24 * 60 * 60 * 1000L
        directory.listFiles()?.filter { it.isFile && it.lastModified() < cutoff }?.forEach { it.delete() }
        val file = File(directory, "采购清单-${UUID.randomUUID()}.${if (format == "csv") "csv" else "md"}")
        file.writeBytes(bytes)
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.shopping-share", file)
        val send = Intent(Intent.ACTION_SEND).apply {
            this.type = type
            putExtra(Intent.EXTRA_SUBJECT, "潮汐计划 · 采购清单")
            putExtra(Intent.EXTRA_STREAM, uri)
            clipData = ClipData.newUri(context.contentResolver, "采购清单", uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        return Intent.createChooser(send, "分享采购清单").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
}
