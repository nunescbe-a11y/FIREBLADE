package com.nunes.callcollector

import android.content.Context
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.nunes.callcollector.work.CallCaptureWorker
import com.nunes.callcollector.work.HealthWorker
import com.nunes.callcollector.work.SyncWorker
import java.util.concurrent.TimeUnit

object AutomationScheduler {
    private const val RECONCILE_WORK = "nunes-call-reconciliation"
    private const val SYNC_WORK_PREFIX = "nunes-cloud-sync-v2"
    private const val PERIODIC_SYNC_WORK = "nunes-cloud-sync-periodic-v2"
    private const val HEALTH_PULSE_WORK = "nunes-device-health-pulse"

    fun schedulePeriodicReconciliation(context: Context) {
        val request = PeriodicWorkRequestBuilder<CallCaptureWorker>(15, TimeUnit.MINUTES)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            RECONCILE_WORK,
            ExistingPeriodicWorkPolicy.KEEP,
            request
        )
    }

    fun enqueueCapture(context: Context, delaySeconds: Long = 0L) {
        val builder = OneTimeWorkRequestBuilder<CallCaptureWorker>()
        if (delaySeconds > 0) builder.setInitialDelay(delaySeconds, TimeUnit.SECONDS)
        val request = builder.build()
        val bucket = System.currentTimeMillis() / 5000L
        WorkManager.getInstance(context).enqueueUniqueWork(
            "nunes-call-capture-$bucket-$delaySeconds",
            ExistingWorkPolicy.KEEP,
            request
        )
    }

    fun enqueueSync(context: Context) {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            .build()
        // Do not let an old retry/backoff instance head-of-line block all future sync attempts.
        // A minute bucket deduplicates bursts while allowing a fresh worker on later capture/network events.
        val bucket = System.currentTimeMillis() / TimeUnit.MINUTES.toMillis(1)
        WorkManager.getInstance(context).enqueueUniqueWork(
            "$SYNC_WORK_PREFIX-$bucket",
            ExistingWorkPolicy.KEEP,
            request
        )
    }

    fun schedulePeriodicSync(context: Context) {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            PERIODIC_SYNC_WORK,
            ExistingPeriodicWorkPolicy.KEEP,
            request
        )
    }

    fun enqueueHealth(context: Context, eventType: String = "HEARTBEAT", delaySeconds: Long = 0L) {
        val builder = OneTimeWorkRequestBuilder<HealthWorker>()
            .setInputData(Data.Builder().putString("event_type", eventType).build())
        if (delaySeconds > 0) builder.setInitialDelay(delaySeconds, TimeUnit.SECONDS)
        val request = builder.build()
        val name = if (eventType.equals("HEARTBEAT", ignoreCase = true)) {
            "$HEALTH_PULSE_WORK-now-${System.currentTimeMillis() / 60000L}"
        } else {
            "nunes-device-health-${eventType.lowercase()}-${System.currentTimeMillis() / 5000L}"
        }
        WorkManager.getInstance(context).enqueueUniqueWork(name, ExistingWorkPolicy.KEEP, request)
    }

    fun scheduleNextHealthPulse(context: Context) {
        val request = OneTimeWorkRequestBuilder<HealthWorker>()
            .setInitialDelay(5, TimeUnit.MINUTES)
            .setInputData(Data.Builder().putString("event_type", "HEARTBEAT").build())
            .build()
        val futureBucket = (System.currentTimeMillis() + TimeUnit.MINUTES.toMillis(5)) / TimeUnit.MINUTES.toMillis(5)
        WorkManager.getInstance(context).enqueueUniqueWork(
            "$HEALTH_PULSE_WORK-$futureBucket",
            ExistingWorkPolicy.KEEP,
            request
        )
    }
}
