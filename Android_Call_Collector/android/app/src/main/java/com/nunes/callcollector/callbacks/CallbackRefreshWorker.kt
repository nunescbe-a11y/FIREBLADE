package com.nunes.callcollector.callbacks

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.nunes.callcollector.data.AppDatabase
import com.nunes.callcollector.widgets.CallbackWidgetUpdater
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class CallbackRefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            val previousKeys = CallbackSnapshotStore.activeKeys(applicationContext)
            val trackingStart = CallbackSnapshotStore.trackingStart(applicationContext)
            val calls = AppDatabase.get(applicationContext).callDao().latest(10_000)
                .filter { it.startedAtEpochMs >= trackingStart }
            val summary = CallbackEngine.compute(calls)
            FollowUpNotifier.sync(applicationContext, previousKeys, summary)
            CallbackSnapshotStore.save(applicationContext, summary)
            CallbackWidgetUpdater.updateAll(applicationContext)
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }

    companion object {
        fun enqueue(context: Context) {
            val request = OneTimeWorkRequestBuilder<CallbackRefreshWorker>().build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                "fireblade-callback-refresh",
                ExistingWorkPolicy.REPLACE,
                request
            )
        }
    }
}
