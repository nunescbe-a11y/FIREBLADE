package com.nunes.callcollector.callbacks

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.nunes.callcollector.ConfigStore
import com.nunes.callcollector.FirebladeDatePolicy
import com.nunes.callcollector.control.DeviceHttpError
import com.nunes.callcollector.control.EmployeeWorkspaceApi
import com.nunes.callcollector.data.AppDatabase
import com.nunes.callcollector.widgets.CallbackWidgetUpdater
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

class CallbackRefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            val previousKeys = CallbackSnapshotStore.activeKeys(applicationContext)
            val calls = AppDatabase.get(applicationContext).callDao().latest(10_000)
            val today = FirebladeDatePolicy.todayStart()
            val localSummary = CallbackEngine.computeForDay(calls, today)
            val config = ConfigStore(applicationContext)

            val summary = if (
                config.deviceToken.isNotBlank() &&
                config.deviceId.isNotBlank() &&
                config.apiUrl.startsWith("https://")
            ) {
                try {
                    EmployeeWorkspaceApi.load(config, today).summary
                } catch (e: DeviceHttpError) {
                    if (e.status in listOf(401, 403, 409)) {
                        CallbackSummary(
                            pending = emptyList(),
                            resolvedToday = 0,
                            generatedAt = System.currentTimeMillis(),
                            selectedDayStart = today
                        )
                    } else {
                        EmployeeWorkspaceApi.loadCached(config, today)?.summary ?: localSummary
                    }
                } catch (_: Exception) {
                    EmployeeWorkspaceApi.loadCached(config, today)?.summary ?: localSummary
                }
            } else {
                localSummary
            }

            FollowUpNotifier.sync(applicationContext, previousKeys, summary)
            CallbackSnapshotStore.save(applicationContext, summary)
            CallbackWidgetUpdater.updateAll(applicationContext)
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }

    companion object {
        private const val PERIODIC = "fireblade-callback-refresh-periodic"

        fun enqueue(context: Context) {
            val request = OneTimeWorkRequestBuilder<CallbackRefreshWorker>().build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                "fireblade-callback-refresh",
                ExistingWorkPolicy.REPLACE,
                request
            )
        }

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<CallbackRefreshWorker>(15, TimeUnit.MINUTES).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PERIODIC,
                ExistingPeriodicWorkPolicy.UPDATE,
                request
            )
        }
    }
}
