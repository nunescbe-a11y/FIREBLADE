package com.nunes.callcollector.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "calls",
    indices = [
        Index(value = ["sourceCallId"], unique = true),
        Index(value = ["startedAtEpochMs"]),
        Index(value = ["simSlotIndex"]),
        Index(value = ["synced"]),
        Index(value = ["startedAtEpochMs", "simSlotIndex"]),
        Index(value = ["startedAtEpochMs", "direction"])
    ]
)
data class CallEntity(
    @PrimaryKey(autoGenerate = true) val localId: Long = 0,
    val sourceCallId: String,
    val numberRaw: String,
    val numberNormalized: String,
    val contactName: String?,
    val direction: String,
    val startedAtEpochMs: Long,
    val durationSeconds: Long,
    val phoneAccountId: String? = null,
    val phoneAccountComponent: String? = null,
    val subscriptionId: Int? = null,
    val simSlotIndex: Int? = null,
    val synced: Boolean = false,
    val createdAtEpochMs: Long = System.currentTimeMillis()
)
