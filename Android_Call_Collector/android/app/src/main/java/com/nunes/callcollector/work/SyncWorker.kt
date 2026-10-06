package com.nunes.callcollector.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.nunes.callcollector.ConfigStore
import com.nunes.callcollector.SyncStateStore
import com.nunes.callcollector.callbacks.CallbackRefreshWorker
import com.nunes.callcollector.data.AppDatabase
import com.nunes.callcollector.network.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class SyncWorker(appContext: Context, params: WorkerParameters) :
    CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val dao = AppDatabase.get(applicationContext).callDao()
        val config = ConfigStore(applicationContext)
        val state = SyncStateStore(applicationContext)

        if (config.apiUrl.isBlank() || config.deviceId.isBlank()) {
            state.set("CONFIG_REQUIRED", "Device ID and API URL must be configured once.")
            return@withContext Result.success()
        }

        if (config.deviceAccessState == "BLOCKED") {
            state.set("BLOCKED", config.deviceAccessMessage.ifBlank { "Device assignment requires Fireblade Admin attention." })
            return@withContext Result.success()
        }

        try {
            var batches = 0
            while (batches < 20) {
                val pending = dao.pending(200)
                if (pending.isEmpty()) {
                    break
                }

                state.set("SYNCING", "Uploading ${pending.size} pending call${if (pending.size == 1) "" else "s"}...")
                val result = ApiClient.upload(config, pending)
                if (!result.ok) {
                    state.set("RETRYING", result.message)
                    return@withContext Result.retry()
                }

                val accepted = pending
                    .filter { it.sourceCallId in result.acceptedSourceIds }
                    .map { it.localId }

                if (accepted.isEmpty()) {
                    state.set("RETRYING", "Cloud response did not confirm any pending records.")
                    return@withContext Result.retry()
                }

                dao.markSynced(accepted)
                batches++
            }

            // Shane details are local-first. Cloud upload never blocks the form or WhatsApp.
            val shaneDao = AppDatabase.get(applicationContext).shaneCallDetailDao()
            val pendingShane = shaneDao.pending(50)
            var shaneSyncFailed = false
            var shaneSyncMessage = ""
            for (detail in pendingShane) {
                state.set("SYNCING", "Uploading Shane customer details...")
                val detailResult = ApiClient.uploadShaneDetail(config, detail)
                if (detailResult.ok) {
                    shaneDao.markSynced(listOf(detail.detailId))
                } else if (detailResult.isPermanentRejection) {
                    shaneDao.markRejected(detail.detailId, detailResult.message)
                    // Head-of-line blocking prevented: continue to next pending detail
                } else {
                    shaneSyncFailed = true
                    shaneSyncMessage = detailResult.message
                    break
                }
            }

            // Upload recordings (runs whether calls were pending or not)
            val recordingDao = AppDatabase.get(applicationContext).recordingDao()
            val pendingRecordings = recordingDao.pending(20)
            var recordingsUploaded = 0
            for (recording in pendingRecordings) {
                state.set("SYNCING", "Uploading recording ${recording.recordingId}...")
                val recResult = ApiClient.uploadRecording(config, recording)
                if (recResult.ok) {
                    recordingDao.updateStatus(listOf(recording.localId), "SUCCESS")
                    val file = recording.filePath?.let { java.io.File(it) }
                    if (file?.exists() == true) file.delete()
                    recordingsUploaded++
                } else {
                    recordingDao.updateStatus(listOf(recording.localId), "FAILED")
                    state.set("RETRYING", recResult.message)
                    CallbackRefreshWorker.enqueue(applicationContext)
                    return@withContext Result.retry()
                }
            }

            if (shaneSyncFailed) {
                state.set("RETRYING", shaneSyncMessage.ifBlank { "Shane detail sync will retry." })
                CallbackRefreshWorker.enqueue(applicationContext)
                return@withContext Result.retry()
            }

            if (
                dao.pendingCount() > 0 ||
                shaneDao.pendingCount() > 0 ||
                pendingRecordings.size > recordingsUploaded
            ) {
                state.set("QUEUED", "More records remain; another automatic sync will continue.")
                com.nunes.callcollector.AutomationScheduler.enqueueSync(applicationContext)
            } else {
                state.synced()
                com.nunes.callcollector.AutomationScheduler.enqueueHealth(applicationContext, "CALL_SYNC")
            }
            CallbackRefreshWorker.enqueue(applicationContext)
            try {
                com.nunes.callcollector.widgets.CallbackWidgetUpdater.updateAll(applicationContext)
            } catch (_: Exception) { }
            Result.success()
        } catch (e: Exception) {
            state.set("RETRYING", e.message ?: e.javaClass.simpleName)
            CallbackRefreshWorker.enqueue(applicationContext)
            Result.retry()
        }
    }
}
