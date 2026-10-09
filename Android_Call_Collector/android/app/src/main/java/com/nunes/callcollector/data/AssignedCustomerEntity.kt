package com.nunes.callcollector.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "assigned_customers",
    indices = [
        Index(value = ["detailId"], unique = true),
        Index(value = ["assignedAtEpochMs"]),
        Index(value = ["syncState"]),
        Index(value = ["status"])
    ]
)
data class AssignedCustomerEntity(
    @PrimaryKey
    val detailId: String,
    val assignmentEventId: String? = null,
    val sourceDeviceId: String = "",
    val sourceEmployeeId: String = "",
    val sourceKind: String = "ORIGINAL", // "ORIGINAL" or "TEST"
    val sourceTitle: String = "Original Shane's Handover",
    val customerName: String = "",
    val customerPhoneRaw: String = "",
    val customerPhoneNormalized: String = "",
    val productAsked: String = "",
    val location: String = "",
    val shaneNotes: String = "",
    val veryUrgent: Boolean = false,
    val callStartedAtEpochMs: Long = 0L,
    val assignedAtEpochMs: Long = 0L,
    val status: String = "PENDING", // "PENDING" or "SAVED"
    val quotation: Boolean = false,
    val catalogue: Boolean = false,
    val image: Boolean = false,
    val commonRemarks: String = "",
    val savedAtEpochMs: Long? = null, // Single Save Details timestamp
    val syncState: String = "SYNCED", // "SYNCED", "PENDING_SAVE", "FAILED"
    val syncError: String? = null,
    val receivedAtEpochMs: Long = System.currentTimeMillis(),
    val clientUpdatedAtEpochMs: Long = System.currentTimeMillis()
)
