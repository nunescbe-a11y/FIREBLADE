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

            // Events are uploaded only after their parent detail is confirmed in Supabase.
            // A failed event remains in Room and is retried with the same event UUID.
            val assignmentDao = AppDatabase.get(applicationContext).shaneAssignmentEventDao()
            var assignmentSyncFailed = false
            var assignmentSyncMessage = ""
            for (event in assignmentDao.pendingReady(50)) {
                state.set("SYNCING", "Uploading Shane employee assignments...")
                val upload = ApiClient.uploadShaneAssignment(config, event)
                if (upload.ok) {
                    assignmentDao.markSynced(event.eventId)
                } else {
                    assignmentSyncFailed = true
                    assignmentSyncMessage = upload.message
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

            // Sync Assigned Customers for employee inbox and push pending follow-up responses
            val assignedDao = AppDatabase.get(applicationContext).assignedCustomerDao()
            val pendingSaves = assignedDao.getPendingSaves()
            for (assigned in pendingSaves) {
                state.set("SYNCING", "Uploading employee follow-up details...")
                val saveRes = ApiClient.saveAssignedCustomerDetails(config, assigned)
                if (saveRes.ok) {
                    assignedDao.markSynced(assigned.detailId)
                }
            }

            // Pull latest assigned customers in background
            try {
                val fetchedAssigned = ApiClient.getAssignedCustomers(config)
                if (fetchedAssigned.isNotEmpty()) {
                    fetchedAssigned.forEach { remote ->
                        val localExisting = assignedDao.getByDetailId(remote.detailId)
                        if (localExisting == null) {
                            assignedDao.insert(remote)
                            ApiClient.sendAssignmentReceipt(config, remote.detailId, "RECEIVED_ON_APP")
                        } else if (localExisting.syncState == "SYNCED") {
                            assignedDao.update(
                                localExisting.copy(
                                    customerName = remote.customerName,
                                    customerPhoneRaw = remote.customerPhoneRaw,
                                    customerPhoneNormalized = remote.customerPhoneNormalized,
                                    productAsked = remote.productAsked,
                                    location = remote.location,
                                    shaneNotes = remote.shaneNotes,
                                    veryUrgent = remote.veryUrgent,
                                    assignedAtEpochMs = remote.assignedAtEpochMs,
                                    status = remote.status,
                                    quotation = remote.quotation,
                                    catalogue = remote.catalogue,
                                    image = remote.image,
                                    commonRemarks = remote.commonRemarks,
                                    savedAtEpochMs = remote.savedAtEpochMs
                                )
                            )
                        }
                    }
                }
            } catch (_: Exception) { }

            if (assignmentSyncFailed) {
                state.set("RETRYING", assignmentSyncMessage.ifBlank { "Shane assignments will retry." })
                CallbackRefreshWorker.enqueue(applicationContext)
                return@withContext Result.retry()
            }

            if (shaneSyncFailed) {
                state.set("RETRYING", shaneSyncMessage.ifBlank { "Shane detail sync will retry." })
                CallbackRefreshWorker.enqueue(applicationContext)
                return@withContext Result.retry()
            }

            if (
                dao.pendingCount() > 0 ||
                shaneDao.pendingCount() > 0 ||
                assignmentDao.pendingCount() > 0 ||
                assignedDao.getPendingSaves().isNotEmpty() ||
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
