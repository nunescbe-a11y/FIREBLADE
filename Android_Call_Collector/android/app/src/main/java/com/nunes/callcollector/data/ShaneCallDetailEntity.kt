package com.nunes.callcollector.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import java.util.UUID

@Entity(
    tableName = "shane_call_details",
    indices = [
        Index(value = ["detailId"], unique = true),
        Index(value = ["sourceCallId"]),
        Index(value = ["phoneNumberNormalized"]),
        Index(value = ["callStartedAtEpochMs"])
    ]
)
data class ShaneCallDetailEntity(
    @PrimaryKey(autoGenerate = true) val localId: Long = 0,
    val detailId: String = UUID.randomUUID().toString(),
    val sourceCallId: String? = null,
    val phoneNumberRaw: String,
    val phoneNumberNormalized: String,
    val callStartedAtEpochMs: Long,
    val customerName: String = "",
    val productAsked: String = "",
    val location: String = "",
    val notes: String = "",
    val veryUrgent: Boolean = false,
    val synced: Boolean = false,
    val createdAtEpochMs: Long = System.currentTimeMillis(),
    val updatedAtEpochMs: Long = System.currentTimeMillis()
)
