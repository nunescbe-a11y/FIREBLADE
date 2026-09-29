package com.nunes.callcollector.work

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.nunes.callcollector.AutomationScheduler
import com.nunes.callcollector.BackfillPolicy
import com.nunes.callcollector.CallLogScanner
import com.nunes.callcollector.SyncStateStore
import com.nunes.callcollector.data.AppDatabase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class CallCaptureWorker(appContext: Context, params: WorkerParameters) :
    CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        if (ContextCompat.checkSelfPermission(
                applicationContext,
                Manifest.permission.READ_CALL_LOG
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            return@withContext Result.success()
        }

        val state = SyncStateStore(applicationContext)
        return@withContext try {
            val dao = AppDatabase.get(applicationContext).callDao()
            // V1.2 rollout rule: keep the collector queue/history scoped to 01-Aug-2026 onward.
            // This does not edit/delete cloud records; it only prevents pre-August phone history
            // from being re-queued during installation/reconciliation.
            dao.deleteBefore(BackfillPolicy.START_EPOCH_MS)
            val rows = CallLogScanner(applicationContext).scan(10000)
            val inserted = dao.insertAll(rows).count { it > 0L }
            val pending = dao.pendingCount()
            com.nunes.callcollector.callbacks.CallbackRefreshWorker.enqueue(applicationContext)

            if (pending > 0) {
                state.set("QUEUED", "$pending call${if (pending == 1) "" else "s"} waiting for cloud upload.")
                AutomationScheduler.enqueueSync(applicationContext)
            } else if (inserted > 0) {
                state.synced("Call log checked. Nothing pending.")
            }
            Result.success()
        } catch (e: Exception) {
            state.set("CAPTURE_ERROR", e.message ?: e.javaClass.simpleName)
            Result.retry()
        }
    }
}
