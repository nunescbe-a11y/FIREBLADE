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
            com.nunes.callcollector.ShaneCallReconciler.reconcile(applicationContext, rows)
            com.nunes.callcollector.LiveCallStore.clearIfMatched(applicationContext, rows)
            val pending = dao.pendingCount()
            val pendingShane = AppDatabase.get(applicationContext).shaneCallDetailDao().pendingCount()
            com.nunes.callcollector.callbacks.CallbackRefreshWorker.enqueue(applicationContext)
            try {
                com.nunes.callcollector.widgets.CallbackWidgetUpdater.updateAll(applicationContext)
            } catch (_: Exception) { }

            val pendingRecordings = AppDatabase.get(applicationContext).recordingDao().pending(100)
            if (pendingRecordings.isNotEmpty()) {
                val latestCalls = dao.latest(50)
                for (recording in pendingRecordings) {
                    if (recording.sourceCallId == null) {
                        val recordingStartMs = recording.startedAtEpochMs
                        
                        val candidates = latestCalls.filter { call ->
                            val timeMatch = Math.abs(call.startedAtEpochMs - recordingStartMs) < 60000 // within 60s
                            val numberMatch = recording.phoneNumber == null || 
                                              call.numberRaw == recording.phoneNumber || 
                                              call.numberNormalized == recording.phoneNumber ||
                                              (recording.phoneNumber != null && call.numberNormalized.endsWith(recording.phoneNumber.takeLast(7)))
                            
                            val directionMatch = recording.direction == null || call.direction.equals(recording.direction, ignoreCase = true)
                            
                            timeMatch && numberMatch && directionMatch
                        }
                        
                        if (candidates.size == 1) {
                            val matchedCall = candidates.first()
                            val updated = recording.copy(sourceCallId = matchedCall.sourceCallId)
                            AppDatabase.get(applicationContext).recordingDao().update(updated)
                        }
                    }
                }
            }

            if (pending > 0 || pendingRecordings.isNotEmpty() || pendingShane > 0) {
                state.set(
                    "QUEUED",
                    pending.toString() + " call(s), " +
                        pendingRecordings.size + " recording(s), and " +
                        pendingShane + " Shane detail(s) waiting."
                )
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
