package com.nunes.callcollector.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "recordings",
    indices = [
        Index(value = ["sourceCallId", "sha256"], unique = true)
    ]
)
data class RecordingEntity(
    @PrimaryKey(autoGenerate = true) val localId: Long = 0,
    val sourceCallId: String?,
    val sha256: String?,
    val filePath: String?,
    val fileSizeBytes: Long,
    val durationMs: Long,
    val recordingSource: String,
    val audioScope: String,
    val capability: String,
    val employeeNoticeStatus: String,
    val customerConsentStatus: String,
    val consentBasis: String,
    val uploadStatus: String = "PENDING", // PENDING, UPLOADING, SUCCESS, FAILED
    val createdAtEpochMs: Long = System.currentTimeMillis(),
    val startedAtEpochMs: Long = 0,
    val endedAtEpochMs: Long = 0,
    val mimeType: String = "audio/mp4"
)
