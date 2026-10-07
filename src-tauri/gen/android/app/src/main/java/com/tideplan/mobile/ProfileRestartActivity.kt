package com.tideplan.mobile

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Process

// A separate, non-exported process ensures a new Rust runtime and SQLite handles.
// Recreating only MainActivity would keep the previous native profile alive.
class ProfileRestartActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val previous = intent.getIntExtra("previousPid", -1)
        if (previous <= 0 || previous == Process.myPid()) { finish(); return }
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        if (launch == null) { finish(); return }
        Process.killProcess(previous)
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        startActivity(launch)
        finish()
        Process.killProcess(Process.myPid())
    }
}
