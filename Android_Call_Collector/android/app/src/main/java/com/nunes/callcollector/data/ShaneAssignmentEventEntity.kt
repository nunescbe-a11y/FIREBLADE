package com.nunes.callcollector.data

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import java.util.UUID

@Entity(
    tableName = "shane_assignment_events",
    indices = [Index(value = ["detailId"]), Index(value = ["synced", "occurredAtEpochMs"])]
)
data class ShaneAssignmentEventEntity(
    @PrimaryKey val eventId: String = UUID.randomUUID().toString(),
    val detailId: String,
    val assignedToEmployeeId: String,
    val eventType: String,
    val occurredAtEpochMs: Long,
    val whatsappRecipientNumber: String = "",
    val formSnapshotJson: String = "{}",
    val synced: Boolean = false
)
