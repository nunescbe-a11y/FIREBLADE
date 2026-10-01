package com.nunes.callcollector.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.nunes.callcollector.AutomationScheduler
import com.nunes.callcollector.health.HealthReporter

class HealthWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val eventType = inputData.getString("event_type") ?: "HEARTBEAT"
        val isHeartbeat = eventType.equals("HEARTBEAT", ignoreCase = true)
        try {
            HealthReporter.upload(applicationContext, eventType)
        } finally {
            // A one-time work chain gives a roughly five-minute health pulse on many
            // devices. Android may defer background work under Doze/battery policies,
            // so Fireblade treats stale data conservatively rather than claiming a
            // phone is definitely off immediately.
            if (isHeartbeat) AutomationScheduler.scheduleNextHealthPulse(applicationContext)
        }
        return Result.success()
    }
}
