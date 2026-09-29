package com.nunes.callcollector

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.nunes.callcollector.health.HealthReporter
import kotlinx.coroutines.runBlocking

class ShutdownReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_SHUTDOWN) return
        val pending = goAsync()
        Thread {
            try {
                runBlocking { HealthReporter.upload(context.applicationContext, "SHUTDOWN", fast = true) }
            } catch (_: Exception) {
                // If the network is already gone, the server will fall back to
                // heartbeat timeout logic and will not falsely claim a confirmed shutdown.
            } finally {
                pending.finish()
            }
        }.start()
    }
}
